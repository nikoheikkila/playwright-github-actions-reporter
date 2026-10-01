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
