import { beforeEach, describe, expect, test } from "bun:test";
import type { FullConfig } from "@playwright/test/reporter";
import { GitHubReporter, type GitHubReporterOptions } from "../src/reporter.ts";
import { preserveEnv } from "./env.ts";
import { FakeCore } from "./fakes.ts";
import { createRunners } from "./harness.ts";
import { createStubConfig, createStubSuite, createStubTestCase } from "./stubs.ts";

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
});
