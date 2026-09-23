import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join, relative } from "node:path";
import type {
	FullConfig,
	FullResult,
	Suite,
	TestCase,
	TestError,
	TestResult,
	WorkerInfo,
} from "@playwright/test/reporter";
import { GitHubReporter, type GitHubReporterOptions } from "../src/reporter.ts";
import { FakeCore } from "./fakes.ts";
import {
	createStubConfig,
	createStubFullResult,
	createStubProject,
	createStubSuite,
	createStubTestCase,
	createStubTestError,
	createStubTestResult,
	createStubTestStep,
	createStubWorkerInfo,
} from "./stubs.ts";

type Status = TestResult["status"];

describe("Playwright GitHub Actions Reporter", () => {
	const originalWorkspace = process.env.GITHUB_WORKSPACE;
	let core: FakeCore;
	let reporter: GitHubReporter;

	interface RunDependencies {
		config: FullConfig;
		suite: Suite;
		fullResult?: FullResult;
	}

	beforeEach(() => {
		process.env.GITHUB_WORKSPACE = "/path/to";
		core = new FakeCore();
		reporter = new GitHubReporter(core);
	});

	afterEach(() => {
		if (originalWorkspace === undefined) {
			delete process.env.GITHUB_WORKSPACE;
		} else {
			process.env.GITHUB_WORKSPACE = originalWorkspace;
		}
	});

	const count = (summary: string, label: string): number =>
		Number(summary.match(new RegExp(`<strong>(\\d+)</strong> ${label}`))?.[1]);

	const runTests = async ({ config, suite, fullResult }: RunDependencies) => {
		reporter.onBegin(config, suite);

		for (const testCase of suite.allTests()) {
			for (const result of testCase.results) {
				reporter.onTestBegin(testCase);
				reporter.onTestEnd(testCase, result);
			}
		}

		try {
			reporter.onEnd(fullResult ?? createStubFullResult());
		} finally {
			await reporter.onExit();
		}

		return {
			summary: core.summary.stringify(),
		};
	};

	const runTestCases = (...testCases: TestCase[]) =>
		runTests({
			config: createStubConfig(),
			suite: createStubSuite({
				allTests(): TestCase[] {
					return testCases;
				},
			}),
		});

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
								expectedStatus: "failed",
								results: [createStubTestResult({ status: "failed", duration: 3400, retry: 1 })],
								tags: ["@auth"],
							}),
							createStubTestCase({
								titlePath(): string[] {
									return ["Tests", "auth.spec.ts", "login is retried and passes"];
								},
								results: [
									createStubTestResult({ status: "failed", duration: 1800, retry: 0 }),
									createStubTestResult({ status: "passed", duration: 2100, retry: 1 }),
								],
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

			expect(
				count(summary, "tests passed") +
					count(summary, "tests failed") +
					count(summary, "tests flaky") +
					count(summary, "tests skipped") +
					count(summary, "tests interrupted"),
			).toBe(count(summary, "test cases total"));
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

		describe("When displaying HTML characters", () => {
			test("title path is escaped", async () => {
				const { summary } = await runTests({
					config: createStubConfig(),
					suite: createStubSuite({
						allTests(): TestCase[] {
							return [
								createStubTestCase({
									titlePath(): string[] {
										return ["Tests", "example.spec.ts", "renders <b>bold</b> & more"];
									},
								}),
							];
						},
					}),
				});

				expect(summary).toContain("<td>Tests » example.spec.ts » renders &lt;b&gt;bold&lt;/b&gt; &amp; more</td>");
			});

			test("tags are escaped", async () => {
				const { summary } = await runTests({
					config: createStubConfig(),
					suite: createStubSuite({
						allTests(): TestCase[] {
							return [
								createStubTestCase({
									tags: ["@<script>", "@R&D"],
								}),
							];
						},
					}),
				});

				expect(summary).toContain("<td>@&lt;script&gt;, @R&amp;D</td>");
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

	describe("Annotations", () => {
		const titlePath = ["Tests", "example.spec.ts", "example test"];
		const location = { file: "/path/to/example.spec.ts", line: 3, column: 7 };

		const createFailingTestCase = (error: TestError) =>
			createStubTestCase({
				location,
				titlePath(): string[] {
					return titlePath;
				},
				results: [createStubTestResult({ status: "failed", errors: [error] })],
			});

		test("emits error annotation for unexpected test with error location", async () => {
			await runTestCases(
				createFailingTestCase(
					createStubTestError({
						message: "Expected 1 to be 2",
						location: { file: "/path/to/test.ts", line: 10, column: 5 },
					}),
				),
			);

			expect(core.errorAnnotations).toEqual([
				{
					message: "Expected 1 to be 2",
					properties: {
						title: "Tests » example.spec.ts » example test",
						file: "test.ts",
						startLine: 10,
						startColumn: 5,
					},
				},
			]);
		});

		test("falls back to test location when error has no location", async () => {
			await runTestCases(createFailingTestCase(createStubTestError({ location: undefined })));

			expect(core.errorAnnotations).toEqual([
				{
					message: "Error message",
					properties: {
						title: "Tests » example.spec.ts » example test",
						file: "example.spec.ts",
						startLine: 3,
						startColumn: 7,
					},
				},
			]);
		});

		test("strips ANSI escape sequences from error message", async () => {
			await runTestCases(createFailingTestCase(createStubTestError({ message: "\x1b[31mRed\x1b[0m" })));

			expect(core.errorAnnotations).toContainEqual(expect.objectContaining({ message: "Red" }));
		});

		test("falls back to the unexpected status when error has neither message nor value", async () => {
			await runTestCases(createFailingTestCase(createStubTestError({ message: undefined, value: undefined })));

			expect(core.errorAnnotations).toContainEqual(expect.objectContaining({ message: "Unexpected status: failed" }));
		});

		test("emits one annotation per error when result has multiple errors", async () => {
			await runTestCases(
				createStubTestCase({
					location,
					titlePath(): string[] {
						return titlePath;
					},
					results: [
						createStubTestResult({
							status: "failed",
							errors: [
								createStubTestError({
									message: "First error",
									location: { file: "/path/to/first.ts", line: 1, column: 2 },
								}),
								createStubTestError({
									message: undefined,
									value: "Second error",
									location: { file: "/path/to/second.ts", line: 3, column: 4 },
								}),
							],
						}),
					],
				}),
			);

			expect(core.errorAnnotations).toEqual([
				{
					message: "First error",
					properties: {
						title: "Tests » example.spec.ts » example test",
						file: "first.ts",
						startLine: 1,
						startColumn: 2,
					},
				},
				{
					message: "Second error",
					properties: {
						title: "Tests » example.spec.ts » example test",
						file: "second.ts",
						startLine: 3,
						startColumn: 4,
					},
				},
			]);
		});

		test("emits error annotation with 'Expected to fail, but passed' when test.fail() unexpectedly passes (no errors)", async () => {
			await runTestCases(
				createStubTestCase({
					location,
					titlePath(): string[] {
						return titlePath;
					},
					expectedStatus: "failed",
					results: [createStubTestResult({ status: "passed", errors: [] })],
				}),
			);

			expect(core.errorAnnotations).toEqual([
				{
					message: "Expected to fail, but passed.",
					properties: {
						title: "Tests » example.spec.ts » example test",
						file: "example.spec.ts",
						startLine: 3,
						startColumn: 7,
					},
				},
			]);
		});

		test("emits error annotation with 'Unexpected status' when outcome is unexpected with no errors and status is not a caught failure", async () => {
			await runTestCases(
				createStubTestCase({
					outcome: () => "unexpected",
					results: [createStubTestResult({ status: "interrupted", errors: [] })],
				}),
			);

			expect(core.errorAnnotations).toEqual([
				expect.objectContaining({ message: expect.stringMatching(/^Unexpected status:/) }),
			]);
		});

		test("emits warning annotation for flaky test", async () => {
			await runTestCases(
				createStubTestCase({
					location,
					titlePath(): string[] {
						return titlePath;
					},
					results: [
						createStubTestResult({ status: "failed", retry: 0 }),
						createStubTestResult({ status: "passed", retry: 1 }),
					],
				}),
			);

			expect(core.warningAnnotations).toEqual([
				{
					message: "🔁 Flaky (2 attempts)",
					properties: {
						title: "Tests » example.spec.ts » example test",
						file: "example.spec.ts",
						startLine: 3,
						startColumn: 7,
					},
				},
			]);
		});

		const unannotatedTestCases: [string, Partial<TestCase>][] = [
			["expected", { expectedStatus: "failed", results: [createStubTestResult({ status: "failed" })] }],
			["passed", { results: [createStubTestResult({ status: "passed" })] }],
			["skipped", { results: [createStubTestResult({ status: "skipped" })] }],
			["interrupted", { results: [createStubTestResult({ status: "interrupted" })] }],
		];

		test.each(unannotatedTestCases)("does not emit annotation for %s test", async (_, overrides) => {
			await runTestCases(createStubTestCase(overrides));

			expect(core.errorAnnotations).toBeEmpty();
			expect(core.warningAnnotations).toBeEmpty();
		});

		test("emits warning only for a test that failed then passed on retry", async () => {
			await runTestCases(
				createStubTestCase({
					results: [
						createStubTestResult({ status: "failed", retry: 0, errors: [createStubTestError()] }),
						createStubTestResult({ status: "passed", retry: 1 }),
					],
				}),
			);

			expect(core.errorAnnotations).toBeEmpty();
			expect(core.warningAnnotations).toHaveLength(1);
		});

		test("makes file paths relative to GITHUB_WORKSPACE", async () => {
			process.env.GITHUB_WORKSPACE = "/home/user/project";

			await runTestCases(
				createFailingTestCase(
					createStubTestError({ location: { file: "/home/user/project/src/test.ts", line: 1, column: 1 } }),
				),
			);

			expect(core.errorAnnotations).toContainEqual(
				expect.objectContaining({ properties: expect.objectContaining({ file: "src/test.ts" }) }),
			);
		});

		test("makes file paths relative to process.cwd() when GITHUB_WORKSPACE is not set", async () => {
			delete process.env.GITHUB_WORKSPACE;
			const file = join(process.cwd(), "src", "test.ts");

			await runTestCases(createFailingTestCase(createStubTestError({ location: { file, line: 1, column: 1 } })));

			expect(core.errorAnnotations).toContainEqual(
				expect.objectContaining({ properties: expect.objectContaining({ file: relative(process.cwd(), file) }) }),
			);
		});
	});

	describe("Failure details", () => {
		const failuresHeading = "<h3>Failures</h3>";

		const createFailingTestCase = (result: Partial<TestResult> = {}, title = "example test") =>
			createStubTestCase({
				titlePath(): string[] {
					return ["Tests", "example.spec.ts", title];
				},
				results: [createStubTestResult({ status: "failed", errors: [createStubTestError()], ...result })],
			});

		const failureDetails = (summary: string): string => summary.slice(summary.indexOf(failuresHeading));

		test("does not render failure details when no tests failed", async () => {
			const { summary } = await runTestCases(
				createStubTestCase(),
				createStubTestCase({
					expectedStatus: "failed",
					results: [createStubTestResult({ status: "failed", errors: [createStubTestError()] })],
				}),
				createStubTestCase({
					results: [
						createStubTestResult({ status: "failed", retry: 0, errors: [createStubTestError()] }),
						createStubTestResult({ status: "passed", retry: 1 }),
					],
				}),
			);

			expect(summary).not.toContain(failuresHeading);
		});

		test("renders one details block per unexpected test", async () => {
			const { summary } = await runTestCases(
				createStubTestCase(),
				createFailingTestCase({}, "first failing test"),
				createFailingTestCase({ status: "timedOut" }, "first timed out test"),
			);

			expect(summary).toContain(`</details>${failuresHeading}`);
			expect(failureDetails(summary).match(/<details>/g)).toHaveLength(2);
			expect(failureDetails(summary)).toContain(
				"<details><summary>❌ Tests » example.spec.ts » first failing test</summary><div><pre>Error message</pre></div></details>",
			);
			expect(failureDetails(summary)).toContain(
				"<details><summary>❌ Tests » example.spec.ts » first timed out test</summary><div><pre>Error message</pre></div></details>",
			);
		});

		test("renders step chain with subtitle when present", async () => {
			const { summary } = await runTestCases(
				createFailingTestCase({
					steps: [
						createStubTestStep({ title: "Open cart" }),
						createStubTestStep({
							title: "Add to cart",
							subtitle: "SKU 42",
							error: createStubTestError(),
							steps: [createStubTestStep({ title: 'Expect "toBe"', error: createStubTestError() })],
						}),
					],
				}),
			);

			expect(failureDetails(summary)).toContain(
				'<div><p><strong>Step:</strong> <code>Add to cart (SKU 42) » Expect "toBe"</code></p><pre>Error message</pre></div>',
			);
		});

		test("renders step chain without subtitle when absent", async () => {
			const { summary } = await runTestCases(
				createFailingTestCase({
					steps: [createStubTestStep({ title: "Add to cart", error: createStubTestError() })],
				}),
			);

			expect(failureDetails(summary)).toContain("<p><strong>Step:</strong> <code>Add to cart</code></p>");
		});

		test("renders multiple errors from the same result", async () => {
			const { summary } = await runTestCases(
				createFailingTestCase({
					errors: [
						createStubTestError({ message: "First error" }),
						createStubTestError({ message: undefined, value: "Second error" }),
					],
				}),
			);

			expect(failureDetails(summary)).toContain("<div><pre>First error</pre><pre>Second error</pre></div>");
		});

		test("includes snippet when present", async () => {
			const { summary } = await runTestCases(
				createFailingTestCase({
					errors: [createStubTestError({ snippet: "  10 | expect(1 + 1).toBe(3);" })],
				}),
			);

			expect(failureDetails(summary)).toContain(
				"<div><pre>Error message</pre><pre>  10 | expect(1 + 1).toBe(3);</pre></div>",
			);
		});

		test("omits snippet when not present", async () => {
			const { summary } = await runTestCases(
				createFailingTestCase({ errors: [createStubTestError({ snippet: undefined })] }),
			);

			expect(failureDetails(summary)).toContain("<div><pre>Error message</pre></div>");
		});

		test("strips ANSI and escapes HTML in message and snippet", async () => {
			const { summary } = await runTestCases(
				createFailingTestCase({
					errors: [
						createStubTestError({
							message: "\x1b[31mExpected <div> & more\x1b[0m",
							snippet: "\x1b[2m> 10 | render(<div />);\x1b[0m",
						}),
					],
				}),
			);

			expect(failureDetails(summary)).toContain(
				"<pre>Expected &lt;div&gt; &amp; more</pre><pre>&gt; 10 | render(&lt;div /&gt;);</pre>",
			);
		});

		test("encodes newlines in message and snippet so each block stays on one Markdown line", async () => {
			const { summary } = await runTestCases(
				createFailingTestCase({
					errors: [
						createStubTestError({
							message: "Error: expect(received).toBe(expected)\n\nExpected: 3\nReceived: 2",
							snippet: "  10 | test(() => {\n> 11 |   expect(1 + 1).toBe(3);",
						}),
					],
				}),
			);

			expect(failureDetails(summary)).toContain(
				"<pre>Error: expect(received).toBe(expected)&#10;&#10;Expected: 3&#10;Received: 2</pre><pre>  10 | test(() =&gt; {&#10;&gt; 11 |   expect(1 + 1).toBe(3);</pre>",
			);
		});

		test("HTML-escapes the title path in the Failures summary", async () => {
			const { summary } = await runTestCases(createFailingTestCase({}, "renders <dangerous> path"));

			expect(failureDetails(summary)).toContain(
				"<summary>❌ Tests » example.spec.ts » renders &lt;dangerous&gt; path</summary>",
			);
		});

		test("collapses multi-line test title to single space", async () => {
			const { summary } = await runTestCases(createFailingTestCase({}, "multi\r\nline\rexample\ntest"));

			expect(failureDetails(summary)).toContain(
				"<summary>❌ Tests » example.spec.ts » multi line example test</summary>",
			);
		});

		test("collapses multi-line step title and subtitle in the step chain", async () => {
			const { summary } = await runTestCases(
				createFailingTestCase({
					steps: [
						createStubTestStep({
							title: "Add\nto cart",
							subtitle: "SKU\r\n42",
							error: createStubTestError(),
						}),
					],
				}),
			);

			expect(failureDetails(summary)).toContain("<code>Add to cart (SKU 42)</code>");
		});

		test("normalises \\r\\n and \\r line endings in message and snippet", async () => {
			const { summary } = await runTestCases(
				createFailingTestCase({
					errors: [createStubTestError({ message: "first\r\nsecond\rthird", snippet: "  10 | a\r\n> 11 | b" })],
				}),
			);

			expect(failureDetails(summary)).toContain(
				"<pre>first&#10;second&#10;third</pre><pre>  10 | a&#10;&gt; 11 | b</pre>",
			);
		});

		test("HTML-escapes step title and subtitle in the step chain", async () => {
			const { summary } = await runTestCases(
				createFailingTestCase({
					steps: [
						createStubTestStep({
							title: "Add <item> to cart",
							subtitle: "SKU & price",
							error: createStubTestError(),
						}),
					],
				}),
			);

			expect(failureDetails(summary)).toContain("<code>Add &lt;item&gt; to cart (SKU &amp; price)</code>");
		});

		test("omits step section when no step has error", async () => {
			const { summary } = await runTestCases(
				createFailingTestCase({ steps: [createStubTestStep({ title: "Add to cart" })] }),
			);

			expect(failureDetails(summary)).toContain("<div><pre>Error message</pre></div>");
			expect(failureDetails(summary)).not.toContain("<strong>Step:</strong>");
		});

		test("never includes stack in failure details", async () => {
			const stack = "Error: Error message\n    at /path/to/example.spec.ts:3:7";

			const { summary } = await runTestCases(createFailingTestCase({ errors: [createStubTestError({ stack })] }));

			expect(failureDetails(summary)).toContain("<div><pre>Error message</pre></div>");
			expect(summary).not.toContain("/path/to/example.spec.ts");
		});
	});

	describe("Errors outside tests", () => {
		const errorsHeading = "<h3>Errors outside tests</h3>";
		const errorsFailure = "Errors outside tests detected. See the job summary for details.";

		const finishRun = async (...testCases: TestCase[]) => {
			try {
				await runTestCases(...testCases);
			} catch (error: unknown) {
				if (!(error instanceof Error && error.message === errorsFailure)) {
					throw error;
				}
			}

			return { summary: core.summary.stringify() };
		};

		const errorDetails = (summary: string): string => summary.slice(summary.indexOf(errorsHeading));

		const createNamedWorkerInfo = (name: string): WorkerInfo =>
			createStubWorkerInfo({ project: createStubProject({ name }) });

		test("does not throw on onError", () => {
			expect(() => reporter.onError(createStubTestError())).not.toThrow();
		});

		test("emits error annotation for recorded error", async () => {
			reporter.onError(
				createStubTestError({
					message: "Global setup failed",
					location: { file: "/path/to/global-setup.ts", line: 4, column: 2 },
				}),
			);

			await finishRun();

			expect(core.errorAnnotations).toContainEqual({
				message: "Global setup failed",
				properties: {
					title: "Error outside tests",
					file: "global-setup.ts",
					startLine: 4,
					startColumn: 2,
				},
			});
		});

		test("includes project name in annotation title when present", async () => {
			reporter.onError(createStubTestError(), createNamedWorkerInfo("chromium"));

			await finishRun();

			expect(core.errorAnnotations).toContainEqual(
				expect.objectContaining({
					properties: expect.objectContaining({ title: "Error outside tests (chromium)" }),
				}),
			);
		});

		test.each([
			["no worker info", undefined],
			["an unnamed project", createNamedWorkerInfo("")],
		])("omits project name from annotation title for %s", async (_, workerInfo?: WorkerInfo) => {
			reporter.onError(createStubTestError(), workerInfo);

			await finishRun();

			expect(core.errorAnnotations).toContainEqual(
				expect.objectContaining({ properties: expect.objectContaining({ title: "Error outside tests" }) }),
			);
		});

		test("omits file properties when error has no location", async () => {
			reporter.onError(createStubTestError({ location: undefined }));

			await finishRun();

			expect(core.errorAnnotations).toContainEqual({
				message: "Error message",
				properties: { title: "Error outside tests" },
			});
		});

		test.each([
			["value", { message: undefined, value: "Thrown value" }, "Thrown value"],
			["'Unknown error'", { message: undefined, value: undefined }, "Unknown error"],
		])("falls back to %s when error has no message", async (_, overrides: Partial<TestError>, expected: string) => {
			reporter.onError(createStubTestError(overrides));

			await finishRun();

			expect(core.errorAnnotations).toContainEqual(expect.objectContaining({ message: expected }));
		});

		test("renders Errors section when errors were recorded", async () => {
			reporter.onError(createStubTestError());

			const { summary } = await finishRun();

			expect(summary).toContain(`</details>${errorsHeading}`);
		});

		test("does not render Errors section when no errors were recorded", async () => {
			const { summary } = await finishRun();

			expect(summary).not.toContain(errorsHeading);
		});

		test("renders one details block per error", async () => {
			reporter.onError(createStubTestError({ message: "First error" }));
			reporter.onError(createStubTestError({ message: "Second error" }), createNamedWorkerInfo("firefox"));

			const { summary } = await finishRun();

			expect(errorDetails(summary).match(/<details>/g)).toHaveLength(2);
			expect(errorDetails(summary)).toContain(
				"<details><summary>Error outside tests</summary><pre>First error</pre></details>",
			);
			expect(errorDetails(summary)).toContain(
				"<details><summary>Error outside tests (firefox)</summary><pre>Second error</pre></details>",
			);
		});

		test("renders snippet when present", async () => {
			reporter.onError(createStubTestError({ snippet: "> 4 | throw new Error();" }));

			const { summary } = await finishRun();

			expect(errorDetails(summary)).toContain("<pre>Error message</pre><pre>&gt; 4 | throw new Error();</pre>");
		});

		test("never renders stack in error details", async () => {
			reporter.onError(createStubTestError({ stack: "Error: Error message\n    at /path/to/global-setup.ts:4:2" }));

			const { summary } = await finishRun();

			expect(errorDetails(summary)).toContain("<pre>Error message</pre></details>");
			expect(summary).not.toContain("global-setup.ts");
		});

		test("calls setFailed when errors recorded even if result.status passed", async () => {
			reporter.onError(createStubTestError());

			await finishRun();

			expect(core.errors).toContain(errorsFailure);
		});

		test("HTML-escapes error title with project name", async () => {
			reporter.onError(createStubTestError(), createNamedWorkerInfo("<chromium> & more"));

			const { summary } = await finishRun();

			expect(errorDetails(summary)).toContain("<summary>Error outside tests (&lt;chromium&gt; &amp; more)</summary>");
		});

		test("collapses line breaks in project name within error title", async () => {
			reporter.onError(createStubTestError(), createNamedWorkerInfo("chromium\n  desktop"));

			const { summary } = await finishRun();

			expect(errorDetails(summary)).toContain("<summary>Error outside tests (chromium desktop)</summary>");
		});

		test("renders both Failures and Errors sections in order", async () => {
			const failuresHeading = "<h3>Failures</h3>";
			reporter.onError(createStubTestError());

			const { summary } = await finishRun(
				createStubTestCase({ results: [createStubTestResult({ status: "failed", errors: [createStubTestError()] })] }),
			);

			expect(summary).toContain(failuresHeading);
			expect(summary).toContain(errorsHeading);
			expect(summary.indexOf(failuresHeading)).toBeLessThan(summary.indexOf(errorsHeading));
		});

		test("calls setFailed exactly once with test-run message when result.status is failed", async () => {
			const testRunFailure = "Test run failed. See the job summary for detailed information.";
			reporter.onError(createStubTestError());

			await expect(
				runTests({
					config: createStubConfig(),
					suite: createStubSuite(),
					fullResult: createStubFullResult({ status: "failed" }),
				}),
			).rejects.toThrow(testRunFailure);

			expect(core.errors.filter((message) => message === testRunFailure || message === errorsFailure)).toEqual([
				testRunFailure,
			]);
		});

		test("normalises \\r\\n and \\r to \\n in error message", async () => {
			reporter.onError(createStubTestError({ message: "first\r\nsecond\rthird\nfourth" }));

			const { summary } = await finishRun();

			expect(errorDetails(summary)).toContain("<pre>first&#10;second&#10;third&#10;fourth</pre>");
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
			expect.assertions(2);

			try {
				await runTests({
					config: createStubConfig(),
					suite: createStubSuite({
						allTests(): TestCase[] {
							return [
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
						status: "failed",
					}),
				});
			} catch (error: unknown) {
				const message = "Test run failed. See the job summary for detailed information.";
				expect(core.errors).toContain(message);
				expect((error as Error).message).toBe(message);
			}
		});
	});
});
