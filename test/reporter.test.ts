import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import type { DefaultArtifactClient } from "@actions/artifact";
import type {
	FullConfig,
	FullResult,
	Suite,
	TestCase,
	TestError,
	TestResult,
	WorkerInfo,
} from "@playwright/test/reporter";
import Reporter from "../index.ts";
import { createArtifactUploader } from "../src/artifact.ts";
import { GitHubReporter, type GitHubReporterOptions } from "../src/reporter.ts";
import { preserveEnv, setRunEnvironment } from "./env.ts";
import { FakeCore } from "./fakes.ts";
import { section, silenceWarnings, withSourceFiles } from "./helpers.ts";
import {
	createStubAttachment,
	createStubConfig,
	createStubFailingTestCase,
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
	preserveEnv("GITHUB_WORKSPACE");
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

		await reporter.onEnd(fullResult ?? createStubFullResult());
		await reporter.onExit();

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

		const annotated: Partial<TestCase> = {
			location,
			titlePath(): string[] {
				return titlePath;
			},
		};

		test("emits error annotation for unexpected test with error location", async () => {
			await runTestCases(
				createStubFailingTestCase(annotated, {
					errors: [
						createStubTestError({
							message: "Expected 1 to be 2",
							location: { file: "/path/to/test.ts", line: 10, column: 5 },
						}),
					],
				}),
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
			await runTestCases(
				createStubFailingTestCase(annotated, { errors: [createStubTestError({ location: undefined })] }),
			);

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
			await runTestCases(
				createStubFailingTestCase(annotated, { errors: [createStubTestError({ message: "\x1b[31mRed\x1b[0m" })] }),
			);

			expect(core.errorAnnotations).toContainEqual(expect.objectContaining({ message: "Red" }));
		});

		test("falls back to the unexpected status when error has neither message nor value", async () => {
			await runTestCases(
				createStubFailingTestCase(annotated, {
					errors: [createStubTestError({ message: undefined, value: undefined })],
				}),
			);

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
				createStubFailingTestCase(annotated, {
					errors: [createStubTestError({ location: { file: "/home/user/project/src/test.ts", line: 1, column: 1 } })],
				}),
			);

			expect(core.errorAnnotations).toContainEqual(
				expect.objectContaining({ properties: expect.objectContaining({ file: "src/test.ts" }) }),
			);
		});

		test("makes file paths relative to process.cwd() when GITHUB_WORKSPACE is not set", async () => {
			delete process.env.GITHUB_WORKSPACE;
			const file = join(process.cwd(), "src", "test.ts");

			await runTestCases(
				createStubFailingTestCase(annotated, {
					errors: [createStubTestError({ location: { file, line: 1, column: 1 } })],
				}),
			);

			expect(core.errorAnnotations).toContainEqual(
				expect.objectContaining({ properties: expect.objectContaining({ file: relative(process.cwd(), file) }) }),
			);
		});
	});

	describe("Failure details", () => {
		const failuresHeading = "<h3>Failures</h3>";

		const inSpec = (title = "example test"): Partial<TestCase> => ({
			titlePath(): string[] {
				return ["Tests", "example.spec.ts", title];
			},
		});

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
				createStubFailingTestCase(inSpec("first failing test")),
				createStubFailingTestCase(inSpec("first timed out test"), { status: "timedOut" }),
			);

			expect(summary).toContain(`</details>${failuresHeading}`);
			expect(section(summary, failuresHeading).match(/<details>/g)).toHaveLength(2);
			expect(section(summary, failuresHeading)).toContain(
				"<details><summary>❌ Tests » example.spec.ts » first failing test</summary><div><pre>Error message</pre></div></details>",
			);
			expect(section(summary, failuresHeading)).toContain(
				"<details><summary>❌ Tests » example.spec.ts » first timed out test</summary><div><pre>Error message</pre></div></details>",
			);
		});

		test("renders step chain with subtitle when present", async () => {
			const { summary } = await runTestCases(
				createStubFailingTestCase(inSpec(), {
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

			expect(section(summary, failuresHeading)).toContain(
				'<div><p><strong>Step:</strong> <code>Add to cart (SKU 42) » Expect "toBe"</code></p><pre>Error message</pre></div>',
			);
		});

		test("renders step chain without subtitle when absent", async () => {
			const { summary } = await runTestCases(
				createStubFailingTestCase(inSpec(), {
					steps: [createStubTestStep({ title: "Add to cart", error: createStubTestError() })],
				}),
			);

			expect(section(summary, failuresHeading)).toContain("<p><strong>Step:</strong> <code>Add to cart</code></p>");
		});

		test("renders multiple errors from the same result", async () => {
			const { summary } = await runTestCases(
				createStubFailingTestCase(inSpec(), {
					errors: [
						createStubTestError({ message: "First error" }),
						createStubTestError({ message: undefined, value: "Second error" }),
					],
				}),
			);

			expect(section(summary, failuresHeading)).toContain("<div><pre>First error</pre><pre>Second error</pre></div>");
		});

		test("includes snippet when present", async () => {
			const { summary } = await runTestCases(
				createStubFailingTestCase(inSpec(), {
					errors: [createStubTestError({ snippet: "  10 | expect(1 + 1).toBe(3);" })],
				}),
			);

			expect(section(summary, failuresHeading)).toContain(
				"<div><pre>Error message</pre><pre>  10 | expect(1 + 1).toBe(3);</pre></div>",
			);
		});

		test("omits snippet when not present", async () => {
			const { summary } = await runTestCases(
				createStubFailingTestCase(inSpec(), { errors: [createStubTestError({ snippet: undefined })] }),
			);

			expect(section(summary, failuresHeading)).toContain("<div><pre>Error message</pre></div>");
		});

		test("strips ANSI and escapes HTML in message and snippet", async () => {
			const { summary } = await runTestCases(
				createStubFailingTestCase(inSpec(), {
					errors: [
						createStubTestError({
							message: "\x1b[31mExpected <div> & more\x1b[0m",
							snippet: "\x1b[2m> 10 | render(<div />);\x1b[0m",
						}),
					],
				}),
			);

			expect(section(summary, failuresHeading)).toContain(
				"<pre>Expected &lt;div&gt; &amp; more</pre><pre>&gt; 10 | render(&lt;div /&gt;);</pre>",
			);
		});

		test("encodes newlines in message and snippet so each block stays on one Markdown line", async () => {
			const { summary } = await runTestCases(
				createStubFailingTestCase(inSpec(), {
					errors: [
						createStubTestError({
							message: "Error: expect(received).toBe(expected)\n\nExpected: 3\nReceived: 2",
							snippet: "  10 | test(() => {\n> 11 |   expect(1 + 1).toBe(3);",
						}),
					],
				}),
			);

			expect(section(summary, failuresHeading)).toContain(
				"<pre>Error: expect(received).toBe(expected)&#10;&#10;Expected: 3&#10;Received: 2</pre><pre>  10 | test(() =&gt; {&#10;&gt; 11 |   expect(1 + 1).toBe(3);</pre>",
			);
		});

		test("HTML-escapes the title path in the Failures summary", async () => {
			const { summary } = await runTestCases(createStubFailingTestCase(inSpec("renders <dangerous> path")));

			expect(section(summary, failuresHeading)).toContain(
				"<summary>❌ Tests » example.spec.ts » renders &lt;dangerous&gt; path</summary>",
			);
		});

		test("collapses multi-line test title to single space", async () => {
			const { summary } = await runTestCases(createStubFailingTestCase(inSpec("multi\r\nline\rexample\ntest")));

			expect(section(summary, failuresHeading)).toContain(
				"<summary>❌ Tests » example.spec.ts » multi line example test</summary>",
			);
		});

		test("collapses multi-line step title and subtitle in the step chain", async () => {
			const { summary } = await runTestCases(
				createStubFailingTestCase(inSpec(), {
					steps: [
						createStubTestStep({
							title: "Add\nto cart",
							subtitle: "SKU\r\n42",
							error: createStubTestError(),
						}),
					],
				}),
			);

			expect(section(summary, failuresHeading)).toContain("<code>Add to cart (SKU 42)</code>");
		});

		test("normalises \\r\\n and \\r line endings in message and snippet", async () => {
			const { summary } = await runTestCases(
				createStubFailingTestCase(inSpec(), {
					errors: [createStubTestError({ message: "first\r\nsecond\rthird", snippet: "  10 | a\r\n> 11 | b" })],
				}),
			);

			expect(section(summary, failuresHeading)).toContain(
				"<pre>first&#10;second&#10;third</pre><pre>  10 | a&#10;&gt; 11 | b</pre>",
			);
		});

		test("HTML-escapes step title and subtitle in the step chain", async () => {
			const { summary } = await runTestCases(
				createStubFailingTestCase(inSpec(), {
					steps: [
						createStubTestStep({
							title: "Add <item> to cart",
							subtitle: "SKU & price",
							error: createStubTestError(),
						}),
					],
				}),
			);

			expect(section(summary, failuresHeading)).toContain("<code>Add &lt;item&gt; to cart (SKU &amp; price)</code>");
		});

		test("omits step section when no step has error", async () => {
			const { summary } = await runTestCases(
				createStubFailingTestCase(inSpec(), { steps: [createStubTestStep({ title: "Add to cart" })] }),
			);

			expect(section(summary, failuresHeading)).toContain("<div><pre>Error message</pre></div>");
			expect(section(summary, failuresHeading)).not.toContain("<strong>Step:</strong>");
		});

		test("never includes stack in failure details", async () => {
			const stack = "Error: Error message\n    at /path/to/example.spec.ts:3:7";

			const { summary } = await runTestCases(
				createStubFailingTestCase(inSpec(), { errors: [createStubTestError({ stack })] }),
			);

			expect(section(summary, failuresHeading)).toContain("<div><pre>Error message</pre></div>");
			expect(summary).not.toContain("/path/to/example.spec.ts");
		});
	});

	describe("Errors outside tests", () => {
		const errorsHeading = "<h3>Errors outside tests</h3>";
		const errorsFailure = "Errors outside tests detected. See the job summary for details.";

		const finishRun = async (...testCases: TestCase[]) => {
			await runTestCases(...testCases);

			return { summary: core.summary.stringify() };
		};

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

			expect(section(summary, errorsHeading).match(/<details>/g)).toHaveLength(2);
			expect(section(summary, errorsHeading)).toContain(
				"<details><summary>Error outside tests</summary><pre>First error</pre></details>",
			);
			expect(section(summary, errorsHeading)).toContain(
				"<details><summary>Error outside tests (firefox)</summary><pre>Second error</pre></details>",
			);
		});

		test("renders snippet when present", async () => {
			reporter.onError(createStubTestError({ snippet: "> 4 | throw new Error();" }));

			const { summary } = await finishRun();

			expect(section(summary, errorsHeading)).toContain(
				"<pre>Error message</pre><pre>&gt; 4 | throw new Error();</pre>",
			);
		});

		test("never renders stack in error details", async () => {
			reporter.onError(createStubTestError({ stack: "Error: Error message\n    at /path/to/global-setup.ts:4:2" }));

			const { summary } = await finishRun();

			expect(section(summary, errorsHeading)).toContain("<pre>Error message</pre></details>");
			expect(summary).not.toContain("global-setup.ts");
		});

		test("calls setFailed when errors recorded even if result.status passed", async () => {
			reporter.onError(createStubTestError());

			await finishRun();

			expect(core.failures).toContain(errorsFailure);
		});

		test("HTML-escapes error title with project name", async () => {
			reporter.onError(createStubTestError(), createNamedWorkerInfo("<chromium> & more"));

			const { summary } = await finishRun();

			expect(section(summary, errorsHeading)).toContain(
				"<summary>Error outside tests (&lt;chromium&gt; &amp; more)</summary>",
			);
		});

		test("collapses line breaks in project name within error title", async () => {
			reporter.onError(createStubTestError(), createNamedWorkerInfo("chromium\n  desktop"));

			const { summary } = await finishRun();

			expect(section(summary, errorsHeading)).toContain("<summary>Error outside tests (chromium desktop)</summary>");
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

			await runTests({
				config: createStubConfig(),
				suite: createStubSuite(),
				fullResult: createStubFullResult({ status: "failed" }),
			});

			expect(core.failures).toEqual([testRunFailure]);
		});

		test("normalises \\r\\n and \\r to \\n in error message", async () => {
			reporter.onError(createStubTestError({ message: "first\r\nsecond\rthird\nfourth" }));

			const { summary } = await finishRun();

			expect(section(summary, errorsHeading)).toContain("<pre>first&#10;second&#10;third&#10;fourth</pre>");
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

	describe("Artifact upload outside GitHub Actions", () => {
		preserveEnv("ACTIONS_RUNTIME_TOKEN", "ACTIONS_RESULTS_URL");
		const originalWrite = process.stdout.write;
		let output: string;

		beforeEach(() => {
			output = "";
			process.stdout.write = ((chunk: string | Uint8Array) => {
				output += String(chunk);
				return true;
			}) as typeof process.stdout.write;
		});

		afterEach(() => {
			process.stdout.write = originalWrite;
		});

		test("warns exactly once when the Actions runtime variables are missing", async () => {
			delete process.env.ACTIONS_RUNTIME_TOKEN;
			delete process.env.ACTIONS_RESULTS_URL;
			const upload = createArtifactUploader();
			core.uploadArtifact = (name, files) => upload(name, files);
			reporter = new GitHubReporter(core, { screenshots: true });
			const testCase = createStubTestCase({
				results: [
					createStubTestResult({
						status: "failed",
						errors: [createStubTestError()],
						attachments: [createStubAttachment()],
					}),
				],
			});

			const { summary } = await runTestCases(testCase);

			expect(core.warningAnnotations).toHaveLength(1);
			expect(core.warningAnnotations[0]?.message).toContain("Actions runtime variables");
			expect(core.isFailed).toBe(false);
			expect(summary).not.toContain("Screenshots</a>");
			expect(summary).not.toContain("undefined");

			const defaultReporter = new Reporter({ screenshots: true });
			defaultReporter.onBegin(createStubConfig(), createStubSuite({ allTests: () => [testCase] }));
			defaultReporter.onTestEnd(testCase, testCase.results[0] as TestResult);
			await defaultReporter.onEnd(createStubFullResult());

			expect(output.split("::warning::").length - 1).toBe(1);
			expect(output).not.toContain("Skipping artifact upload");
		});
	});
});

describe("createArtifactUploader", () => {
	preserveEnv("ACTIONS_RUNTIME_TOKEN", "ACTIONS_RESULTS_URL", "TMPDIR");

	beforeEach(() => {
		process.env.ACTIONS_RUNTIME_TOKEN = "token";
		process.env.ACTIONS_RESULTS_URL = "https://results.example";
	});

	const createClient = (behaviour: () => Promise<{ id?: number }>) => {
		const calls: Array<{ name: string; files: string[]; root: string }> = [];
		const client = {
			uploadArtifact: async (name: string, files: string[], root: string) => {
				calls.push({ name, files, root });
				return behaviour();
			},
		} as unknown as DefaultArtifactClient;
		return { client, calls };
	};

	test("throws instead of warning when the client throws", async () => {
		const warning = silenceWarnings();
		const { client } = createClient(async () => {
			throw new Error("boom");
		});

		const upload = createArtifactUploader(client)("shots", [{ name: "a", path: "/tmp/a/1.png" }]);

		await expect(upload).rejects.toThrow("boom");
		expect(warning).not.toHaveBeenCalled();
		warning.mockRestore();
	});

	test.each([
		["ACTIONS_RUNTIME_TOKEN", "ACTIONS_RESULTS_URL"],
		["ACTIONS_RESULTS_URL", "ACTIONS_RUNTIME_TOKEN"],
	])("throws and skips the client when %s is missing", async (missing, present) => {
		process.env[present] = "value";
		delete process.env[missing];
		const warning = silenceWarnings();
		const { client, calls } = createClient(async () => ({ id: 1 }));

		const upload = createArtifactUploader(client)("shots", [{ name: "a", path: "/tmp/a/1.png" }]);

		await expect(upload).rejects.toThrow(Error);
		expect(calls).toHaveLength(0);
		expect(warning).not.toHaveBeenCalled();
		warning.mockRestore();
	});

	test("uploads with the common ancestor of all file paths as root directory", async () => {
		const { client, calls } = createClient(async () => ({ id: 42 }));
		const files = [
			{ name: "one", path: "/tmp/run/x/1.png" },
			{ name: "two", path: "/tmp/run/y/z/2.png" },
		];

		const result = await createArtifactUploader(client)("shots", files);

		expect(result).toStrictEqual({ id: 42 });
		expect(calls[0]?.root).toBe("/tmp/run");
	});

	test.each([
		["empty", ""],
		["absolute posix", "/etc/evil.png"],
		["absolute windows", "C:\\evil.png"],
		["forward slash separator", "nested/evil.png"],
		["backslash separator", "nested\\evil.png"],
		["directory traversal", ".."],
	])("rejects %s file name before staging or uploading anything", async (_case, name) => {
		await withSourceFiles({ "1.png": "image-bytes" }, async (source) => {
			const { client, calls } = createClient(async () => ({ id: 1 }));

			const upload = createArtifactUploader(client)("shots", [{ name, path: join(source, "1.png") }]);

			await expect(upload).rejects.toThrow(/invalid artifact file name/i);
			expect(calls).toHaveLength(0);
		});
	});

	test("stages renamed files in a unique private mkdtemp directory under os.tmpdir and removes it afterwards", async () => {
		delete process.env.TMPDIR;
		const uploadTmpdir = tmpdir();
		const seen: Array<{ root: string; staged: string; mode: number }> = [];
		const client = {
			uploadArtifact: async (_name: string, files: string[], root: string) => {
				const staged = await readFile(join(root, "renamed.png"), "utf8");
				seen.push({ root, staged, mode: (await stat(root)).mode & 0o777 });
				expect(files).toStrictEqual([join(root, "renamed.png")]);
				throw new Error("upload failed");
			},
		} as unknown as DefaultArtifactClient;
		const warning = silenceWarnings();

		await withSourceFiles({ "1.png": "image-bytes" }, async (source) => {
			const upload = createArtifactUploader(client);
			const files = [{ name: "renamed.png", path: join(source, "1.png") }];

			await expect(upload("shots", files)).rejects.toThrow("upload failed");
			await expect(upload("shots", files)).rejects.toThrow("upload failed");
		});

		warning.mockRestore();
		const [first, second] = seen;
		expect(seen).toHaveLength(2);
		expect(first?.staged).toBe("image-bytes");
		expect(dirname(first?.root ?? "")).toBe(uploadTmpdir);
		expect(basename(first?.root ?? "").startsWith("playwright-screenshots-")).toBe(true);
		expect(first?.root).not.toBe(second?.root);
		expect(first?.mode).toBe(0o700);
		expect(existsSync(first?.root ?? "")).toBe(false);
	});

	test.each([
		["a symlink to another file", "symlink"],
		["a directory", "directory"],
	])("rejects %s as a non-regular attachment before uploading anything", async (_case, kind) => {
		await withSourceFiles({ "secret.txt": "secret-contents" }, async (source) => {
			const target = join(source, "secret.txt");
			const path = join(source, "1.png");
			if (kind === "symlink") {
				await symlink(target, path);
			} else {
				await mkdir(path);
			}
			const { client, calls } = createClient(async () => ({ id: 1 }));

			const error = await createArtifactUploader(client)("shots", [{ name: "1.png", path }]).catch((e: Error) => e);

			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).not.toContain("secret-contents");
			expect((error as Error).message).not.toContain(source);
			expect(calls).toHaveLength(0);
		});
	});

	test("throws 'Artifact upload returned no ID' when client returns undefined id, and cleans up staging directory", async () => {
		const { client, calls } = createClient(async () => ({ id: undefined }));

		await withSourceFiles({ "1.png": "image-bytes" }, async (source) => {
			const upload = createArtifactUploader(client)("shots", [{ name: "renamed.png", path: join(source, "1.png") }]);

			await expect(upload).rejects.toThrow("Artifact upload returned no ID");
		});

		const root = calls[0]?.root ?? "";
		expect(calls).toHaveLength(1);
		expect(root).not.toBe("");
		expect(existsSync(root)).toBe(false);
	});

	test("succeeds with real files, uses unique staged names, and cleans up staging directory", async () => {
		const { client, calls } = createClient(async () => ({ id: 123 }));

		const result = await withSourceFiles({ "a.png": "first-bytes", "b.png": "second-bytes" }, (source) =>
			createArtifactUploader(client)("shots", [
				{ name: "first-renamed.png", path: join(source, "a.png") },
				{ name: "second-renamed.png", path: join(source, "b.png") },
			]),
		);

		const root = calls[0]?.root ?? "";
		expect(result).toStrictEqual({ id: 123 });
		expect(calls).toHaveLength(1);
		expect(calls[0]?.files).toStrictEqual([join(root, "first-renamed.png"), join(root, "second-renamed.png")]);
		expect(basename(root).startsWith("playwright-screenshots-")).toBe(true);
		expect(existsSync(root)).toBe(false);
	});
});
