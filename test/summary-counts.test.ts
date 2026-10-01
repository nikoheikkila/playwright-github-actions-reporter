import { beforeEach, describe, expect, test } from "bun:test";
import type { TestCase } from "@playwright/test/reporter";
import { GitHubReporter } from "../src/reporter.ts";
import { preserveEnv } from "./env.ts";
import { FakeCore } from "./fakes.ts";
import { count, createRunners } from "./harness.ts";
import { createStubConfig, createStubSuite, createStubTestCase, createStubTestResult } from "./stubs.ts";

describe("Playwright GitHub Actions Reporter", () => {
	preserveEnv("GITHUB_WORKSPACE");
	let core: FakeCore;
	let reporter: GitHubReporter;

	beforeEach(() => {
		process.env.GITHUB_WORKSPACE = "/path/to";
		core = new FakeCore();
		reporter = new GitHubReporter(core);
	});

	const { runTests } = createRunners(
		() => core,
		() => reporter,
	);

	describe("Summary", () => {
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
});
