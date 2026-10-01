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
});
