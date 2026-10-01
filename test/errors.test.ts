import { beforeEach, describe, expect, test } from "bun:test";
import type { TestCase, TestError, WorkerInfo } from "@playwright/test/reporter";
import { GitHubReporter } from "../src/reporter.ts";
import { preserveEnv } from "./env.ts";
import { FakeCore } from "./fakes.ts";
import { createRunners } from "./harness.ts";
import { section } from "./helpers.ts";
import {
	createStubConfig,
	createStubFullResult,
	createStubProject,
	createStubSuite,
	createStubTestCase,
	createStubTestError,
	createStubTestResult,
	createStubWorkerInfo,
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

	const { runTests, runTestCases } = createRunners(
		() => core,
		() => reporter,
	);

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
});
