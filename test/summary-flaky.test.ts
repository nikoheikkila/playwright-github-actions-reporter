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
	});
});
