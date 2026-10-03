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

	describe("Test details", () => {
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
									tags: ["@smoke"],
									results: [
										createStubTestResult({
											retry: 0,
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
									results: [createStubTestResult({ retry: 1 })],
								}),
							];
						},
					}),
				});

				expect(summary).toContain("<td>1</td><td>None</td></tr>");
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
