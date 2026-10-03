import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { EOL } from "node:os";
import type { TestCase } from "@playwright/test/reporter";
import { GitHubReporter } from "../src/reporter.ts";
import { preserveEnv } from "./env.ts";
import { FakeCore } from "./fakes.ts";
import { createRunners } from "./harness.ts";
import { createStubConfig, createStubSuite, createStubTestCase, createStubTestResult } from "./stubs.ts";

describe("Playwright GitHub Actions Reporter lifecycle", () => {
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

	test("prints to stdio", () => {
		expect(reporter.printsToStdio()).toBe(true);
	});

	test("writes the summary on exit", async () => {
		const write = spyOn(core.summary, "write");

		await reporter.onExit();

		expect(write).toHaveBeenCalledTimes(1);
	});

	test("does not log debug messages unless debugging is enabled", async () => {
		core.setDebug(false);

		await runTests({
			config: createStubConfig(),
			suite: createStubSuite({ allTests: (): TestCase[] => [createStubTestCase()] }),
		});

		expect(core.debugs).toStrictEqual([]);
	});

	test("lists no interrupted item when no test was interrupted", async () => {
		const { summary } = await runTests({ config: createStubConfig(), suite: createStubSuite() });

		expect(summary.match(/<li>/g)).toHaveLength(6);
	});

	test("ends the flaky note with a line break", async () => {
		const { summary } = await runTests({
			config: createStubConfig({ failOnFlakyTests: true }),
			suite: createStubSuite({
				allTests: (): TestCase[] => [
					createStubTestCase({
						results: [
							createStubTestResult({ status: "failed", retry: 0 }),
							createStubTestResult({ status: "passed", retry: 1 }),
						],
					}),
				],
			}),
		});

		expect(summary).toContain(`<code>failOnFlakyTests</code> is enabled.</p>${EOL}`);
	});
});
