import { beforeEach, describe, expect, test } from "bun:test";
import type { FullConfig, Suite, TestCase, TestResult } from "@playwright/test/reporter";
import type { Core } from "../src/interface.ts";
import { GitHubReporter } from "../src/reporter.ts";
import { FakeCore } from "./fakes.ts";
import { createStubConfig, createStubSuite, createStubTestCase, createStubTestResult } from "./stubs.ts";

type Status = TestResult["status"];

describe("Playwright GitHub Actions Reporter", () => {
	let core: Core;
	let reporter: GitHubReporter;

	interface RunDependencies {
		config: FullConfig;
		suite: Suite;
	}

	beforeEach(() => {
		core = new FakeCore();
		reporter = new GitHubReporter(core);
	});

	const runTests = async ({ config, suite }: RunDependencies) => {
		reporter.onBegin(config, suite);

		for (const testCase of suite.allTests()) {
			const result = testCase.results.at(0) ?? createStubTestResult();

			reporter.onTestEnd(testCase, result);
		}

		reporter.onEnd();
		await reporter.onExit();

		return {
			summary: core.summary.stringify(),
		};
	};

	describe("Full Report Snapshot", () => {
		test("matches expected structure", async () => {
			const { summary } = await runTests({
				config: createStubConfig(),
				suite: createStubSuite({
					type: "root",
					title: "Tests",
					suites: [
						createStubSuite({
							type: "project",
							title: "Chromium",
							suites: [
								createStubSuite({ type: "file", title: "auth.spec.ts" }),
								createStubSuite({ type: "file", title: "checkout.spec.ts" }),
							],
						}),
					],
					allTests(): TestCase[] {
						return [
							createStubTestCase({
								titlePath(): string[] {
									return ["Tests", "auth.spec.ts", "login succeeds"];
								},
								results: [createStubTestResult({ status: "passed", duration: 1200, retry: 1 })],
								tags: ["@smoke"],
							}),
							createStubTestCase({
								titlePath(): string[] {
									return ["Tests", "auth.spec.ts", "login fails with wrong password"];
								},
								results: [createStubTestResult({ status: "failed", duration: 3400, retry: 1 })],
								tags: ["@auth"],
							}),
							createStubTestCase({
								titlePath(): string[] {
									return ["Tests", "auth.spec.ts", "login is retried and passes"];
								},
								results: [createStubTestResult({ status: "passed", duration: 2100, retry: 2 })],
								tags: ["@auth", "@smoke"],
							}),
							createStubTestCase({
								titlePath(): string[] {
									return ["Tests", "checkout.spec.ts", "checkout completes"];
								},
								results: [createStubTestResult({ status: "passed", duration: 5600, retry: 1 })],
								tags: ["@E2E", "@smoke"],
							}),
							createStubTestCase({
								titlePath(): string[] {
									return ["Tests", "checkout.spec.ts", "checkout times out"];
								},
								results: [createStubTestResult({ status: "timedOut", duration: 30000, retry: 2 })],
								tags: ["@E2E"],
							}),
							createStubTestCase({
								titlePath(): string[] {
									return ["Tests", "checkout.spec.ts", "checkout is skipped"];
								},
								results: [createStubTestResult({ status: "skipped", duration: 0, retry: 1 })],
								tags: ["@checkout"],
							}),
							createStubTestCase({
								titlePath(): string[] {
									return ["Tests", "checkout.spec.ts", "checkout is interrupted"];
								},
								results: [createStubTestResult({ status: "interrupted", duration: 1500, retry: 1 })],
								tags: ["@E2E"],
							}),
						];
					},
				}),
			});

			expect(summary).toMatchSnapshot();
		});
	});

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

		test("displays number of timed out tests", async () => {
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
			expect(summary).toContain("<li>❌ <strong>1</strong> tests failed</li>");
			expect(summary).toContain("<li>⏰ <strong>1</strong> tests timed out</li>");
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
			expect(summary).toContain("<li>❌ <strong>1</strong> tests failed</li>");
			expect(summary).toContain("<li>⏰ <strong>1</strong> tests timed out</li>");
			expect(summary).toContain("<li>⚠️ <strong>1</strong> tests skipped</li>");
		});
	});

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
		});

		describe("When displaying test duration", () => {
			test("milliseconds are converted to fractional seconds and rounded up", async () => {
				const { summary } = await runTests({
					config: createStubConfig(),
					suite: createStubSuite({
						allTests(): TestCase[] {
							return [
								createStubTestCase({
									results: [
										createStubTestResult({
											duration: 10_550,
										}),
									],
								}),
							];
						},
					}),
				});

				expect(summary).toMatch(/<td>10.6s<\/td>/);
			});
		});

		describe("When displaying test retries", () => {
			test("zero number is displayed as 'None'", async () => {
				const { summary } = await runTests({
					config: createStubConfig(),
					suite: createStubSuite({
						allTests(): TestCase[] {
							return [
								createStubTestCase({
									results: [
										createStubTestResult({
											retry: 1,
										}),
									],
								}),
							];
						},
					}),
				});

				expect(summary).toMatch(/<td>None<\/td>/);
			});

			test("non-zero number is displayed as is", async () => {
				const { summary } = await runTests({
					config: createStubConfig(),
					suite: createStubSuite({
						allTests(): TestCase[] {
							return [
								createStubTestCase({
									results: [
										createStubTestResult({
											retry: 1,
										}),
									],
								}),
							];
						},
					}),
				});

				expect(summary).toMatch(/<td>1<\/td>/);
			});
		});

		describe("When displaying test tags", () => {
			test("empty tags are displayed as 'None'", async () => {
				const { summary } = await runTests({
					config: createStubConfig(),
					suite: createStubSuite({
						allTests(): TestCase[] {
							return [
								createStubTestCase({
									tags: [],
								}),
							];
						},
					}),
				});

				expect(summary).toMatch(/<td>None<\/td>/);
			});

			test("populated tags are displayed as is", async () => {
				const { summary } = await runTests({
					config: createStubConfig(),
					suite: createStubSuite({
						allTests(): TestCase[] {
							return [
								createStubTestCase({
									tags: ["@E2E"],
								}),
							];
						},
					}),
				});

				expect(summary).toMatch(/<td>@E2E<\/td>/);
			});
		});
	});
});
