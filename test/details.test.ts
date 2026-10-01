import { beforeEach, describe, expect, test } from "bun:test";
import type { TestCase, TestResult } from "@playwright/test/reporter";
import { GitHubReporter } from "../src/reporter.ts";
import { preserveEnv } from "./env.ts";
import { FakeCore } from "./fakes.ts";
import { createRunners } from "./harness.ts";
import { createStubConfig, createStubSuite, createStubTestCase, createStubTestResult } from "./stubs.ts";

type Status = TestResult["status"];

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

	describe("Test details", () => {
		test("displays a relevant heading", async () => {
			const { summary } = await runTests({
				config: createStubConfig(),
				suite: createStubSuite(),
			});

			expect(summary).toContain("<h3>Details</h3>");
		});

		test("displays a table with headers", async () => {
			const { summary } = await runTests({
				config: createStubConfig(),
				suite: createStubSuite(),
			});

			expect(summary).toMatch(
				/<table><tr><th>Test<\/th><th>Result<\/th><th>Duration<\/th><th>Retries<\/th><th>Tags<\/th><\/tr>.+<\/table>/,
			);
		});

		test("wraps details into a collapsible element", async () => {
			const { summary } = await runTests({
				config: createStubConfig(),
				suite: createStubSuite(),
			});

			expect(summary).toMatch(/<details><summary>Show Test Cases<\/summary>.+<\/details>/);
		});

		describe("When displaying test title path", () => {
			test("segments are joined by a separator", async () => {
				const { summary } = await runTests({
					config: createStubConfig(),
					suite: createStubSuite({
						allTests(): TestCase[] {
							return [
								createStubTestCase({
									titlePath(): string[] {
										return ["Tests", "example.spec.ts", "example test"];
									},
								}),
							];
						},
					}),
				});

				expect(summary).toMatch(/<td>Tests » example.spec.ts » example test<\/td>/);
			});

			test("multi-line title is collapsed to a single line", async () => {
				const { summary } = await runTestCases(
					createStubTestCase({
						titlePath(): string[] {
							return ["Tests", "example.spec.ts", "multi\r\nline\rexample\ntest"];
						},
					}),
				);

				expect(summary).toContain("<td>Tests » example.spec.ts » multi line example test</td>");
			});

			test("whitespace around line breaks is collapsed to a single space", async () => {
				const { summary } = await runTestCases(
					createStubTestCase({
						titlePath(): string[] {
							return ["Tests", "example.spec.ts", "multi \n  line\t\r\n\texample"];
						},
					}),
				);

				expect(summary).toContain("<td>Tests » example.spec.ts » multi line example</td>");
			});
		});

		describe("When displaying test results", () => {
			const resultMap: [Status, string][] = [
				["passed", "✅ Passed"],
				["failed", "❌ Failed"],
				["timedOut", "⏰ Timed out"],
				["skipped", "⚠️ Skipped"],
				["interrupted", "🛑 Interrupted"],
			];

			test.each(resultMap)("%s test displays as  %s", async (status: Status, expected: string) => {
				const { summary } = await runTests({
					config: createStubConfig(),
					suite: createStubSuite({
						allTests(): TestCase[] {
							return [
								createStubTestCase({
									titlePath(): string[] {
										return ["Tests", "example.spec.ts", "example test"];
									},
									results: [
										createStubTestResult({
											status,
										}),
									],
								}),
							];
						},
					}),
				});

				expect(summary).toMatch(new RegExp(`<td>${expected}</td>`));
			});

			test.each([1, 2])("flaky test passing on retry %d displays the number of attempts", async (retry: number) => {
				const { summary } = await runTests({
					config: createStubConfig(),
					suite: createStubSuite({
						allTests(): TestCase[] {
							return [
								createStubTestCase({
									results: [
										...Array.from({ length: retry }, (_, attempt) =>
											createStubTestResult({ status: "failed", retry: attempt }),
										),
										createStubTestResult({ status: "passed", retry }),
									],
								}),
							];
						},
					}),
				});

				expect(summary).toContain(`<td>🔁 Flaky (${retry + 1} attempts)</td>`);
			});

			test("flaky test expected to fail displays the number of attempts", async () => {
				const { summary } = await runTests({
					config: createStubConfig(),
					suite: createStubSuite({
						allTests(): TestCase[] {
							return [
								createStubTestCase({
									expectedStatus: "failed",
									results: [
										createStubTestResult({ status: "passed", retry: 0 }),
										createStubTestResult({ status: "failed", retry: 1 }),
									],
								}),
							];
						},
					}),
				});

				expect(summary).toContain("<td>🔁 Flaky (2 attempts)</td>");
			});

			const expectedFailureResultMap: [Status, string][] = [
				["failed", "✅ Failed as expected"],
				["timedOut", "⏰ Timed out"],
			];

			test.each(expectedFailureResultMap)(
				"test expected to fail that ends as %s displays as %s",
				async (status: Status, expected: string) => {
					const { summary } = await runTests({
						config: createStubConfig(),
						suite: createStubSuite({
							allTests(): TestCase[] {
								return [
									createStubTestCase({
										expectedStatus: "failed",
										results: [createStubTestResult({ status })],
									}),
								];
							},
						}),
					});

					expect(summary).toContain(`<td>${expected}</td>`);
				},
			);

			test("test expected to be skipped displays as skipped", async () => {
				const { summary } = await runTests({
					config: createStubConfig(),
					suite: createStubSuite({
						allTests(): TestCase[] {
							return [
								createStubTestCase({
									expectedStatus: "skipped",
									results: [createStubTestResult({ status: "skipped" })],
								}),
							];
						},
					}),
				});

				expect(summary).toContain("<td>⚠️ Skipped</td>");
			});
		});
	});
});
