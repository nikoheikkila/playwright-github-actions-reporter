import { beforeEach, describe, expect, test } from "bun:test";
import type { TestCase } from "@playwright/test/reporter";
import { GitHubReporter } from "../src/reporter.ts";
import { preserveEnv } from "./env.ts";
import { FakeCore } from "./fakes.ts";
import { createRunners } from "./harness.ts";
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

	const { runTests } = createRunners(
		() => core,
		() => reporter,
	);

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
