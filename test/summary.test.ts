import { beforeEach, describe, expect, test } from "bun:test";
import type { TestCase } from "@playwright/test/reporter";
import { GitHubReporter } from "../src/reporter.ts";
import { preserveEnv } from "./env.ts";
import { FakeCore } from "./fakes.ts";
import { createRunners } from "./harness.ts";
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
	});
});
