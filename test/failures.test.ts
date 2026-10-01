import { beforeEach, describe, expect, test } from "bun:test";
import type { TestCase } from "@playwright/test/reporter";
import { GitHubReporter } from "../src/reporter.ts";
import { preserveEnv } from "./env.ts";
import { FakeCore } from "./fakes.ts";
import { createRunners } from "./harness.ts";
import { section } from "./helpers.ts";
import {
	createStubFailingTestCase,
	createStubTestCase,
	createStubTestError,
	createStubTestResult,
	createStubTestStep,
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

	const { runTestCases } = createRunners(
		() => core,
		() => reporter,
	);

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
});
