import { beforeEach, describe, expect, test } from "bun:test";
import type { FullConfig, TestCase } from "@playwright/test/reporter";
import { GitHubReporter, type GitHubReporterOptions } from "../src/reporter.ts";
import { preserveEnv } from "./env.ts";
import { FakeCore } from "./fakes.ts";
import { count, createRunners } from "./harness.ts";
import {
	createStubConfig,
	createStubFullResult,
	createStubSuite,
	createStubTestCase,
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

	const { runTests, runTestCases } = createRunners(
		() => core,
		() => reporter,
	);

	describe("Summary", () => {
		test("displays a level 2 report heading", async () => {
			const { summary } = await runTests({
				config: createStubConfig(),
				suite: createStubSuite(),
			});

			expect(summary).toContain("<h2>🎭 Playwright Test Report</h2>");
		});

		test("displays a level 3 summary heading", async () => {
			const { summary } = await runTests({
				config: createStubConfig(),
				suite: createStubSuite(),
			});

			expect(summary).toContain("<h3>Summary</h3>");
		});

		test("displays an unordered list", async () => {
			const { summary } = await runTests({
				config: createStubConfig(),
				suite: createStubSuite(),
			});

			expect(summary).toMatch(/<ul><li>.+<\/li><\/ul>/);
		});

		test("displays total number of test files", async () => {
			const { summary } = await runTests({
				config: createStubConfig(),
				suite: createStubSuite({
					type: "root",
					title: "Tests",
					suites: [
						createStubSuite({
							type: "project",
							title: "Playwright",
							suites: [
								createStubSuite({ type: "file", title: "example1.spec.ts" }),
								createStubSuite({ type: "file", title: "example2.spec.ts" }),
							],
						}),
					],
				}),
			});

			expect(summary).toContain("<li>📁 <strong>2</strong> test files total</li>");
		});

		test("displays total number of test cases", async () => {
			const { summary } = await runTests({
				config: createStubConfig(),
				suite: createStubSuite({
					allTests(): TestCase[] {
						return [createStubTestCase(), createStubTestCase()];
					},
				}),
			});

			expect(summary).toContain("<li>🧪 <strong>2</strong> test cases total</li>");
		});

		test("displays number of passed tests", async () => {
			const { summary } = await runTests({
				config: createStubConfig(),
				suite: createStubSuite({
					allTests(): TestCase[] {
						return [
							createStubTestCase({ title: "first passing test" }),
							createStubTestCase({ title: "second passing test" }),
						];
					},
				}),
			});

			expect(summary).toContain("<li>🧪 <strong>2</strong> test cases total</li>");
			expect(summary).toContain("<li>✅ <strong>2</strong> tests passed</li>");
		});

		test("displays number of failed tests", async () => {
			const { summary } = await runTests({
				config: createStubConfig(),
				suite: createStubSuite({
					allTests(): TestCase[] {
						return [
							createStubTestCase({ title: "first passing test" }),
							createStubTestCase({
								title: "first failing test",
								results: [
									createStubTestResult({
										status: "failed",
									}),
								],
							}),
						];
					},
				}),
			});

			expect(summary).toContain("<li>🧪 <strong>2</strong> test cases total</li>");
			expect(summary).toContain("<li>✅ <strong>1</strong> tests passed</li>");
			expect(summary).toContain("<li>❌ <strong>1</strong> tests failed</li>");
		});

		test("counts timed out tests as failed", async () => {
			const { summary } = await runTests({
				config: createStubConfig(),
				suite: createStubSuite({
					allTests(): TestCase[] {
						return [
							createStubTestCase({ title: "first passing test" }),
							createStubTestCase({
								title: "first failing test",
								results: [
									createStubTestResult({
										status: "failed",
									}),
								],
							}),
							createStubTestCase({
								title: "first timed out test",
								results: [
									createStubTestResult({
										status: "timedOut",
									}),
								],
							}),
						];
					},
				}),
			});

			expect(summary).toContain("<li>🧪 <strong>3</strong> test cases total</li>");
			expect(summary).toContain("<li>✅ <strong>1</strong> tests passed</li>");
			expect(summary).toContain("<li>❌ <strong>2</strong> tests failed</li>");
			expect(summary).not.toContain("tests timed out");
		});

		test("displays number of flaky tests", async () => {
			const { summary } = await runTests({
				config: createStubConfig(),
				suite: createStubSuite({
					allTests(): TestCase[] {
						return [
							createStubTestCase({ title: "first passing test" }),
							createStubTestCase({
								title: "first flaky test",
								results: [
									createStubTestResult({ status: "failed", retry: 0 }),
									createStubTestResult({ status: "passed", retry: 1 }),
								],
							}),
						];
					},
				}),
			});

			expect(summary).toContain("<li>🧪 <strong>2</strong> test cases total</li>");
			expect(summary).toContain("<li>✅ <strong>1</strong> tests passed</li>");
			expect(summary).toContain("<li>❌ <strong>0</strong> tests failed</li>");
			expect(summary).toContain("<li>🔁 <strong>1</strong> tests flaky</li>");
		});

		test("counts a retried test once by its final outcome", async () => {
			const { summary } = await runTests({
				config: createStubConfig(),
				suite: createStubSuite({
					allTests(): TestCase[] {
						return [
							createStubTestCase({
								title: "first retried failing test",
								results: [
									createStubTestResult({ status: "failed", retry: 0 }),
									createStubTestResult({ status: "failed", retry: 1 }),
								],
							}),
						];
					},
				}),
			});

			expect(summary).toContain("<li>❌ <strong>1</strong> tests failed</li>");
			expect(summary).toContain("<li>🔁 <strong>0</strong> tests flaky</li>");
		});

		test("does not count tests that fail as expected as failed", async () => {
			const { summary } = await runTests({
				config: createStubConfig(),
				suite: createStubSuite({
					allTests(): TestCase[] {
						return [
							createStubTestCase({
								title: "first expected failure",
								expectedStatus: "failed",
								results: [createStubTestResult({ status: "failed" })],
							}),
						];
					},
				}),
			});

			expect(summary).toContain("<li>✅ <strong>1</strong> tests passed</li>");
			expect(summary).toContain("<li>❌ <strong>0</strong> tests failed</li>");
		});

		test("counts tests that never ran as skipped", async () => {
			const { summary } = await runTests({
				config: createStubConfig(),
				suite: createStubSuite({
					allTests(): TestCase[] {
						return [
							createStubTestCase({ title: "first passing test" }),
							createStubTestCase({ title: "first test that never ran", results: [] }),
						];
					},
				}),
			});

			expect(summary).toContain("<li>🧪 <strong>2</strong> test cases total</li>");
			expect(summary).toContain("<li>⚠️ <strong>1</strong> tests skipped</li>");
		});

		test("counts skipped tests regardless of their expected status", async () => {
			const { summary } = await runTests({
				config: createStubConfig(),
				suite: createStubSuite({
					allTests(): TestCase[] {
						return [
							createStubTestCase({
								title: "first skipped test",
								expectedStatus: "skipped",
								results: [createStubTestResult({ status: "skipped" })],
							}),
							createStubTestCase({
								title: "first test that did not run",
								expectedStatus: "passed",
								results: [createStubTestResult({ status: "skipped" })],
							}),
						];
					},
				}),
			});

			expect(summary).toContain("<li>⚠️ <strong>2</strong> tests skipped</li>");
		});

		test("counts interrupted tests as interrupted (not skipped)", async () => {
			const { summary } = await runTests({
				config: createStubConfig(),
				suite: createStubSuite({
					allTests(): TestCase[] {
						return [
							createStubTestCase({ title: "first passing test" }),
							createStubTestCase({
								title: "first interrupted test",
								results: [createStubTestResult({ status: "interrupted" })],
							}),
						];
					},
				}),
			});

			expect(summary).toContain(
				"<li>⚠️ <strong>0</strong> tests skipped</li><li>🛑 <strong>1</strong> tests interrupted</li>",
			);
		});

		test("omits the interrupted count when no tests were interrupted", async () => {
			const { summary } = await runTests({
				config: createStubConfig(),
				suite: createStubSuite(),
			});

			expect(summary).not.toContain("tests interrupted");
		});

		test("counts that add up to total", async () => {
			const { summary } = await runTests({
				config: createStubConfig(),
				suite: createStubSuite({
					allTests(): TestCase[] {
						return [
							createStubTestCase({ title: "first passing test" }),
							createStubTestCase({
								title: "first failing test",
								results: [createStubTestResult({ status: "failed" })],
							}),
							createStubTestCase({
								title: "first flaky test",
								results: [
									createStubTestResult({ status: "failed", retry: 0 }),
									createStubTestResult({ status: "passed", retry: 1 }),
								],
							}),
							createStubTestCase({
								title: "first skipped test",
								results: [createStubTestResult({ status: "skipped" })],
							}),
							createStubTestCase({ title: "first test that never ran", results: [] }),
							createStubTestCase({
								title: "first interrupted test",
								results: [createStubTestResult({ status: "interrupted" })],
							}),
						];
					},
				}),
			});

			expect(
				count(summary, "tests passed") +
					count(summary, "tests failed") +
					count(summary, "tests flaky") +
					count(summary, "tests skipped") +
					count(summary, "tests interrupted"),
			).toBe(count(summary, "test cases total"));
		});

		describe("When flaky tests fail the run", () => {
			const failOnFlakyTestsNote =
				"<p>🔁 Flaky tests fail the run because <code>failOnFlakyTests</code> is enabled.</p>";

			const flakySuite = () =>
				createStubSuite({
					allTests(): TestCase[] {
						return [
							createStubTestCase({
								results: [
									createStubTestResult({ status: "failed", retry: 0 }),
									createStubTestResult({ status: "passed", retry: 1 }),
								],
							}),
						];
					},
				});

			test("displays a note under the list", async () => {
				const { summary } = await runTests({
					config: createStubConfig({ failOnFlakyTests: true }),
					suite: flakySuite(),
				});

				expect(summary).toContain(`</ul>${failOnFlakyTestsNote}`);
			});

			test("omits the note when there are no flaky tests", async () => {
				const { summary } = await runTests({
					config: createStubConfig({ failOnFlakyTests: true }),
					suite: createStubSuite(),
				});

				expect(summary).not.toContain(failOnFlakyTestsNote);
			});

			test("omits the note when flaky tests are allowed", async () => {
				const { summary } = await runTests({
					config: createStubConfig({ failOnFlakyTests: false }),
					suite: flakySuite(),
				});

				expect(summary).not.toContain(failOnFlakyTestsNote);
			});
		});

		test("displays number of skipped tests", async () => {
			const { summary } = await runTests({
				config: createStubConfig(),
				suite: createStubSuite({
					allTests(): TestCase[] {
						return [
							createStubTestCase({ title: "first passing test" }),
							createStubTestCase({
								title: "first failing test",
								results: [
									createStubTestResult({
										status: "failed",
									}),
								],
							}),
							createStubTestCase({
								title: "first timed out test",
								results: [
									createStubTestResult({
										status: "timedOut",
									}),
								],
							}),
							createStubTestCase({
								title: "first skipped test",
								results: [
									createStubTestResult({
										status: "skipped",
									}),
								],
							}),
						];
					},
				}),
			});

			expect(summary).toContain("<li>🧪 <strong>4</strong> test cases total</li>");
			expect(summary).toContain("<li>✅ <strong>1</strong> tests passed</li>");
			expect(summary).toContain("<li>❌ <strong>2</strong> tests failed</li>");
			expect(summary).toContain("<li>⚠️ <strong>1</strong> tests skipped</li>");
		});
	});

	describe("Reporter options", () => {
		const shard = { current: 2, total: 3 };
		const headerRow = "<tr><th>Test</th><th>Result</th><th>Duration</th><th>Retries</th></tr>";

		const configure = (options: GitHubReporterOptions) => {
			reporter = new GitHubReporter(core, options);
		};

		const runEmptySuite = (config: FullConfig = createStubConfig()) => runTests({ config, suite: createStubSuite() });

		test("uses default heading when no title option", async () => {
			configure({});

			const { summary } = await runEmptySuite();

			expect(summary).toContain("<h2>🎭 Playwright Test Report</h2>");
		});

		test("uses custom title when provided", async () => {
			configure({ title: "E2E tests" });

			const { summary } = await runEmptySuite();

			expect(summary).toContain("<h2>E2E tests</h2>");
			expect(summary).not.toContain("🎭 Playwright Test Report");
		});

		test("escapes HTML in custom title", async () => {
			configure({ title: "<E2E> & more" });

			const { summary } = await runEmptySuite();

			expect(summary).toContain("<h2>&lt;E2E&gt; &amp; more</h2>");
		});

		test("appends shard suffix when config.shard is set (default heading)", async () => {
			configure({});

			const { summary } = await runEmptySuite(createStubConfig({ shard }));

			expect(summary).toContain("<h2>🎭 Playwright Test Report (shard 2/3)</h2>");
		});

		test("appends shard suffix when config.shard is set (custom title)", async () => {
			configure({ title: "E2E tests" });

			const { summary } = await runEmptySuite(createStubConfig({ shard }));

			expect(summary).toContain("<h2>E2E tests (shard 2/3)</h2>");
		});

		test("does not append shard suffix when config.shard is null", async () => {
			configure({ title: "E2E tests" });

			const { summary } = await runEmptySuite(createStubConfig({ shard: null }));

			expect(summary).toContain("<h2>E2E tests</h2>");
			expect(summary).not.toContain("(shard");
		});

		test("omits Tags column when omitTags: true", async () => {
			configure({ omitTags: true });

			const { summary } = await runEmptySuite();

			expect(summary).toContain(`<table>${headerRow}`);
			expect(summary).not.toContain("<th>Tags</th>");
		});

		test("includes Tags column when omitTags: false (default)", async () => {
			configure({ omitTags: false });

			const { summary } = await runEmptySuite();

			expect(summary).toContain("<th>Retries</th><th>Tags</th></tr>");
		});

		test("omits Tags column data when omitTags: true", async () => {
			configure({ omitTags: true });

			const { summary } = await runTestCases(
				createStubTestCase({
					titlePath(): string[] {
						return ["Tests", "example.spec.ts", "example test"];
					},
					tags: ["@E2E"],
				}),
			);

			expect(summary).toContain(
				"<tr><td>Tests » example.spec.ts » example test</td><td>✅ Passed</td><td>0.0s</td><td>None</td></tr>",
			);
			expect(summary).not.toContain("@E2E");
		});
	});

	describe("Logging", () => {
		test("logs info when test suite begins", async () => {
			await runTests({
				config: createStubConfig({ workers: 2 }),
				suite: createStubSuite({
					allTests(): TestCase[] {
						return [createStubTestCase(), createStubTestCase()];
					},
				}),
			});

			expect(core.infos).toContainEqual(expect.stringContaining("Starting a test run with 2 workers and 2 tests"));
		});

		test("logs debug when a single test begins and ends", async () => {
			core.setDebug(true);

			await runTests({
				config: createStubConfig(),
				suite: createStubSuite({
					allTests(): TestCase[] {
						return [
							createStubTestCase({
								titlePath(): string[] {
									return ["example test"];
								},
								results: [
									createStubTestResult({
										status: "passed",
									}),
								],
							}),
						];
					},
				}),
			});

			expect(core.debugs).toContainEqual(expect.stringContaining("Starting test 'example test'"));
			expect(core.debugs).toContainEqual(expect.stringContaining("Finished test 'example test' with result 'passed'"));
		});

		test("logs notice when test suite finishes", async () => {
			await runTests({
				config: createStubConfig(),
				suite: createStubSuite({
					allTests(): TestCase[] {
						return [
							createStubTestCase({
								results: [
									createStubTestResult({
										status: "passed",
									}),
								],
							}),
							createStubTestCase({
								results: [
									createStubTestResult({
										status: "failed",
									}),
								],
							}),
						];
					},
				}),
				fullResult: createStubFullResult({
					duration: 10_000,
				}),
			});

			expect(core.notices).toContainEqual(expect.stringContaining("🎭  1 out of 2 test(s) passed (10.0s)"));
		});

		test("logs notice without counting flaky tests as passed", async () => {
			await runTests({
				config: createStubConfig(),
				suite: createStubSuite({
					allTests(): TestCase[] {
						return [
							createStubTestCase(),
							createStubTestCase({
								results: [
									createStubTestResult({ status: "failed", retry: 0 }),
									createStubTestResult({ status: "passed", retry: 1 }),
								],
							}),
						];
					},
				}),
				fullResult: createStubFullResult({
					duration: 10_000,
				}),
			});

			expect(core.notices).toContainEqual(expect.stringContaining("🎭  1 out of 2 test(s) passed (10.0s)"));
		});

		test("forwards standard output string to info log", () => {
			reporter.onStdOut("stdout");

			expect(core.infos).toContain("stdout");
		});

		test("forwards standard output buffer to info log", () => {
			reporter.onStdOut(Buffer.from("stdout"));

			expect(core.infos).toContain("stdout");
		});

		test("forwards standard error string to info log", () => {
			reporter.onStdErr("stderr");

			expect(core.infos).toContain("stderr");
		});

		test("marks the workflow job as failed when the test suite fails", async () => {
			await runTests({
				config: createStubConfig(),
				suite: createStubSuite({
					allTests(): TestCase[] {
						return [createStubTestCase({ results: [createStubTestResult({ status: "failed" })] })];
					},
				}),
				fullResult: createStubFullResult({ status: "failed" }),
			});

			expect(core.failures).toContain("Test run failed. See the job summary for detailed information.");
			expect(core.isFailed).toBe(true);
		});
	});
});
