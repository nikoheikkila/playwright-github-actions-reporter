import { beforeEach, describe, expect, test } from "bun:test";
import type { TestCase } from "@playwright/test/reporter";
import { GitHubReporter } from "../src/reporter.ts";
import { preserveEnv, setRunEnvironment } from "./env.ts";
import { FakeCore } from "./fakes.ts";
import { createRunners } from "./harness.ts";
import { section } from "./helpers.ts";
import {
	createStubAttachment,
	createStubConfig,
	createStubFailingTestCase,
	createStubFullResult,
	createStubSuite,
	createStubTestCase,
	createStubTestError,
	createStubTestResult,
} from "./stubs.ts";

describe("Playwright GitHub Actions Reporter", () => {
	preserveEnv("GITHUB_WORKSPACE");
	let core: FakeCore;
	let reporter: GitHubReporter;

	beforeEach(() => {
		process.env.GITHUB_WORKSPACE = "/path/to";
		core = new FakeCore();
		reporter = new GitHubReporter(core);
	});

	const { runTestCases } = createRunners(
		() => core,
		() => reporter,
	);

	describe("Screenshots", () => {
		// Real artifact upload is verified only on GitHub Actions; this test uses the FakeCore mock.
		preserveEnv("GITHUB_RUN_ID", "GITHUB_REPOSITORY", "GITHUB_SERVER_URL");

		test("uploads screenshots under unique, file-name-safe names derived from the test", async () => {
			reporter = new GitHubReporter(core, { screenshots: true });

			await runTestCases(
				createStubFailingTestCase(
					{ id: "a1", title: "logs in / out" },
					{ attachments: [createStubAttachment({ name: "screenshot.png", path: "/tmp/a1/screenshot.png" })] },
				),
				createStubFailingTestCase(
					{ id: "b2", title: "logs in / out" },
					{ attachments: [createStubAttachment({ name: "screenshot.png", path: "/tmp/b2/screenshot.png" })] },
				),
				createStubFailingTestCase(
					{ id: "c3", title: "other: test?" },
					{ attachments: [createStubAttachment({ name: "screenshot.png", path: "/tmp/c3/screenshot.png" })] },
				),
			);

			const names = core.uploadedArtifacts[0]?.files.map(({ name }) => name) ?? [];
			expect(names).toHaveLength(3);
			expect(new Set(names).size).toBe(3);
			for (const name of names) {
				expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
			}
		});

		test("indexes screenshot names only when a test has several PNG attachments", async () => {
			reporter = new GitHubReporter(core, { screenshots: true });

			await runTestCases(
				createStubFailingTestCase(
					{ id: "a1" },
					{ attachments: ["/tmp/one.png", "/tmp/two.png"].map((path) => createStubAttachment({ path })) },
				),
				createStubFailingTestCase({ id: "b2" }, { attachments: [createStubAttachment({ path: "/tmp/solo.png" })] }),
			);

			expect(core.uploadedArtifacts[0]?.files.map(({ name }) => name)).toStrictEqual([
				"a1-0.png",
				"a1-1.png",
				"b2.png",
			]);
		});

		test("links the uploaded screenshot artifact in the Failures section", async () => {
			setRunEnvironment();
			reporter = new GitHubReporter(core, { screenshots: true });

			const { summary } = await runTestCases(
				createStubTestCase({
					title: "fails with a screenshot",
					results: [
						createStubTestResult({
							status: "failed",
							errors: [createStubTestError()],
							attachments: [createStubAttachment()],
						}),
					],
				}),
			);

			const url = "https://github.com/owner/repo/actions/runs/999/artifacts/42";
			expect(core.uploadedArtifacts.map(({ name }) => name)).toStrictEqual(["playwright-screenshots"]);
			const link = `<a href="${url}">Screenshots</a>`;
			const failures = section(summary, "<h3>Failures</h3>");
			const beforeFirstDetails = failures.slice(0, failures.indexOf("<details>"));
			expect(beforeFirstDetails).toContain(link);
			expect(summary.split(link)).toHaveLength(2);
		});
		test("uploads webm videos of failing tests and links the artifact once in the Failures section", async () => {
			setRunEnvironment();
			reporter = new GitHubReporter(core, { videos: true });

			const { summary } = await runTestCases(
				createStubTestCase({
					id: "a1",
					title: "fails with a video",
					results: [
						createStubTestResult({
							status: "failed",
							errors: [createStubTestError()],
							attachments: [
								createStubAttachment({ name: "video", path: "/tmp/a1/video.webm", contentType: "video/webm" }),
							],
						}),
					],
				}),
			);

			expect(core.uploadedArtifacts.map(({ name }) => name)).toStrictEqual(["playwright-videos"]);
			expect(core.uploadedArtifacts[0]?.files.map(({ name }) => name)).toStrictEqual(["a1.webm"]);
			const link = '<a href="https://github.com/owner/repo/actions/runs/999/artifacts/42">Videos</a>';
			const failures = section(summary, "<h3>Failures</h3>");
			expect(failures.slice(0, failures.indexOf("<details>"))).toContain(link);
			expect(summary.split(link)).toHaveLength(2);
		});

		test("gives several videos of one failing test unique file names", async () => {
			reporter = new GitHubReporter(core, { videos: true });

			await runTestCases(
				createStubTestCase({
					id: "a1",
					title: "fails with two videos",
					results: [
						createStubTestResult({
							status: "failed",
							errors: [createStubTestError()],
							attachments: [
								createStubAttachment({ name: "video", path: "/tmp/a1/one.webm", contentType: "video/webm" }),
								createStubAttachment({ name: "video", path: "/tmp/a1/two.webm", contentType: "video/webm" }),
							],
						}),
					],
				}),
			);

			expect(core.uploadedArtifacts[0]?.files.map(({ name }) => name)).toStrictEqual(["a1-0.webm", "a1-1.webm"]);
		});

		test.each(["GITHUB_SERVER_URL", "GITHUB_REPOSITORY", "GITHUB_RUN_ID"] as const)(
			"renders no link and warns when %s is missing",
			async (missing) => {
				setRunEnvironment();
				delete process.env[missing];
				reporter = new GitHubReporter(core, { screenshots: true });

				const { summary } = await runTestCases(
					createStubTestCase({
						title: "fails with a screenshot",
						results: [
							createStubTestResult({
								status: "failed",
								errors: [createStubTestError()],
								attachments: [createStubAttachment()],
							}),
						],
					}),
				);

				expect(summary).not.toContain("Screenshots</a>");
				expect(summary).not.toContain("undefined");
				expect(core.warningAnnotations).toHaveLength(1);
				expect(core.warningAnnotations[0]?.message).toContain("screenshot");
			},
		);

		test("continues rendering failures when uploadArtifact throws", async () => {
			setRunEnvironment();
			core.setUploadArtifactThrow(new Error("Upload failed: network error"));
			reporter = new GitHubReporter(core, { screenshots: true });

			const run = runTestCases(
				createStubTestCase({
					title: "fails with a screenshot",
					results: [
						createStubTestResult({
							status: "failed",
							errors: [createStubTestError()],
							attachments: [createStubAttachment()],
						}),
					],
				}),
			);

			await expect(run).resolves.toBeDefined();
			const { summary } = await run;

			expect(summary).toContain("<h3>Failures</h3>");
			expect(summary).toContain("Error message");
			expect(summary).not.toContain("Screenshots</a>");
			expect(core.warningAnnotations).toHaveLength(1);
			expect(core.warningAnnotations[0]?.message).toContain("Upload failed: network error");
		});

		test("continues rendering failures and warns once when the video upload throws", async () => {
			setRunEnvironment();
			core.setUploadArtifactThrow(new Error("Upload failed: network error"));
			reporter = new GitHubReporter(core, { videos: true });

			const run = runTestCases(
				createStubTestCase({
					id: "a1",
					title: "fails with a video",
					results: [
						createStubTestResult({
							status: "failed",
							errors: [createStubTestError()],
							attachments: [
								createStubAttachment({ name: "video", path: "/tmp/a1/video.webm", contentType: "video/webm" }),
							],
						}),
					],
				}),
			);

			await expect(run).resolves.toBeDefined();
			const { summary } = await run;

			expect(summary).toContain("<h3>Failures</h3>");
			expect(summary).toContain("Error message");
			expect(summary).not.toContain("Videos</a>");
			expect(core.warningAnnotations).toHaveLength(1);
			expect(core.warningAnnotations[0]?.message).toContain("Upload failed: network error");
			expect(core.errors).toStrictEqual(["Error message"]);
		});

		test.each([
			["unset", undefined],
			["false", { screenshots: false }],
		])("uploads nothing, links nothing and warns about nothing when screenshots is %s", async (_label, options) => {
			setRunEnvironment();
			reporter = new GitHubReporter(core, options);

			const { summary } = await runTestCases(
				createStubTestCase({
					title: "fails with a screenshot",
					results: [
						createStubTestResult({
							status: "failed",
							errors: [createStubTestError()],
							attachments: [createStubAttachment()],
						}),
					],
				}),
			);

			expect(core.uploadedArtifacts).toStrictEqual([]);
			expect(summary).not.toContain("Screenshots");
			expect(core.warningAnnotations).toStrictEqual([]);
		});

		test("excludes flaky, skipped, passed, earlier retries, non-PNG, and missing-path attachments", async () => {
			setRunEnvironment();
			reporter = new GitHubReporter(core, { screenshots: true });
			const png = (path: string) => createStubAttachment({ path });
			const failed = (path?: string, contentType = "image/png") =>
				createStubTestResult({
					status: "failed",
					errors: [createStubTestError()],
					attachments: [
						path === undefined
							? createStubAttachment({ path: undefined, contentType })
							: createStubAttachment({ path, contentType }),
					],
				});

			const unexpected = createStubTestCase({ id: "unexpected", results: [failed("/tmp/unexpected.png")] });
			const flaky = createStubTestCase({
				id: "flaky",
				results: [failed("/tmp/flaky-1.png"), createStubTestResult({ attachments: [png("/tmp/flaky-2.png")] })],
			});
			const skipped = createStubTestCase({
				id: "skipped",
				results: [createStubTestResult({ status: "skipped", attachments: [png("/tmp/skipped.png")] })],
			});
			const passed = createStubTestCase({
				id: "passed",
				results: [createStubTestResult({ attachments: [png("/tmp/passed.png")] })],
			});
			const retried = createStubTestCase({
				id: "retried",
				results: [failed("/tmp/retried-1.png"), failed("/tmp/retried-2.png")],
			});
			const nonPng = createStubTestCase({ id: "non-png", results: [failed("/tmp/trace.zip", "application/zip")] });
			const noPath = createStubTestCase({ id: "no-path", results: [failed(undefined)] });

			const { summary } = await runTestCases(unexpected, flaky, skipped, passed, retried, nonPng, noPath);

			expect(core.uploadedArtifacts).toHaveLength(1);
			expect(core.uploadedArtifacts[0]?.files.map(({ path }) => path).sort()).toStrictEqual([
				"/tmp/retried-2.png",
				"/tmp/unexpected.png",
			]);
			expect(summary).toContain(
				'<a href="https://github.com/owner/repo/actions/runs/999/artifacts/42">Screenshots</a>',
			);
		});

		test("escapes special characters in GITHUB_REPOSITORY in the screenshot link href", async () => {
			setRunEnvironment();
			process.env.GITHUB_REPOSITORY = "owner/repo<script>";
			reporter = new GitHubReporter(core, { screenshots: true });

			const { summary } = await runTestCases(
				createStubTestCase({
					title: "fails with a screenshot",
					results: [
						createStubTestResult({
							status: "failed",
							errors: [createStubTestError()],
							attachments: [createStubAttachment()],
						}),
					],
				}),
			);

			expect(summary).toContain(
				'<a href="https://github.com/owner/repo&lt;script&gt;/actions/runs/999/artifacts/42">Screenshots</a>',
			);
			expect(summary).not.toContain("<script>");
		});

		test("appears exactly once in Failures section across multiple failing tests", async () => {
			setRunEnvironment();
			reporter = new GitHubReporter(core, { screenshots: true });

			const { summary } = await runTestCases(
				...["a1", "b2", "c3"].map((id) =>
					createStubFailingTestCase(
						{ id, title: `fails ${id}` },
						{ attachments: [createStubAttachment({ path: `/tmp/${id}.png` })] },
					),
				),
			);

			const link = '<a href="https://github.com/owner/repo/actions/runs/999/artifacts/42">Screenshots</a>';
			const failures = section(summary, "<h3>Failures</h3>");
			expect(summary.split(link)).toHaveLength(2);
			expect(failures).toContain(link);
			expect(summary.replace(failures, "")).not.toContain(link);
		});

		test("escapes quotes in GITHUB_REPOSITORY in the screenshot link href", async () => {
			setRunEnvironment();
			process.env.GITHUB_REPOSITORY = 'owner/repo"';
			reporter = new GitHubReporter(core, { screenshots: true });

			const { summary } = await runTestCases(
				createStubTestCase({
					title: "fails with a screenshot",
					results: [
						createStubTestResult({
							status: "failed",
							errors: [createStubTestError()],
							attachments: [createStubAttachment()],
						}),
					],
				}),
			);

			expect(summary).toContain(
				'<a href="https://github.com/owner/repo&quot;/actions/runs/999/artifacts/42">Screenshots</a>',
			);
			expect(summary).not.toContain('repo"/actions');
		});

		test("treats empty GITHUB_SERVER_URL like missing and renders no link", async () => {
			setRunEnvironment();
			process.env.GITHUB_SERVER_URL = "";
			reporter = new GitHubReporter(core, { screenshots: true });

			const { summary } = await runTestCases(
				createStubTestCase({
					title: "fails with a screenshot",
					results: [
						createStubTestResult({
							status: "failed",
							errors: [createStubTestError()],
							attachments: [createStubAttachment()],
						}),
					],
				}),
			);

			expect(summary).not.toContain("Screenshots</a>");
			expect(summary).not.toContain('href="/owner/repo');
			expect(core.warningAnnotations).toHaveLength(1);
			expect(core.warningAnnotations[0]?.message).toContain("screenshot");
		});

		test("has the screenshot link in the Failures section after onEnd, before onExit", async () => {
			setRunEnvironment();
			reporter = new GitHubReporter(core, { screenshots: true });
			const testCase = createStubTestCase({
				title: "fails with a screenshot",
				results: [
					createStubTestResult({
						status: "failed",
						errors: [createStubTestError()],
						attachments: [createStubAttachment()],
					}),
				],
			});
			const suite = createStubSuite({
				allTests(): TestCase[] {
					return [testCase];
				},
			});

			reporter.onBegin(createStubConfig(), suite);
			for (const result of testCase.results) {
				reporter.onTestEnd(testCase, result);
			}
			await reporter.onEnd(createStubFullResult());

			const summary = core.summary.stringify();
			expect(summary).toContain("<h3>Failures</h3>");
			expect(summary).toContain(
				'<a href="https://github.com/owner/repo/actions/runs/999/artifacts/42">Screenshots</a>',
			);
		});

		test("uploads nothing with zero unexpected tests when screenshots is true", async () => {
			setRunEnvironment();
			reporter = new GitHubReporter(core, { screenshots: true });

			const { summary } = await runTestCases(
				createStubTestCase({
					title: "passes without screenshot",
					results: [createStubTestResult({ status: "passed" })],
				}),
			);

			expect(core.uploadedArtifacts).toStrictEqual([]);
			expect(summary).not.toContain("Screenshots");
			expect(core.warningAnnotations).toStrictEqual([]);
		});

		test("uploads nothing for unexpected tests with no PNG attachments", async () => {
			setRunEnvironment();
			reporter = new GitHubReporter(core, { screenshots: true });

			const { summary } = await runTestCases(
				createStubTestCase({
					title: "fails without attachments",
					results: [
						createStubTestResult({
							status: "failed",
							errors: [createStubTestError()],
							attachments: [],
						}),
					],
				}),
			);

			expect(core.uploadedArtifacts).toStrictEqual([]);
			expect(summary).not.toContain("Screenshots");
			expect(core.warningAnnotations).toStrictEqual([]);
		});
	});
});
