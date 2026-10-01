import { beforeEach, describe, expect, test } from "bun:test";
import { join, relative } from "node:path";
import type { TestCase } from "@playwright/test/reporter";
import { GitHubReporter } from "../src/reporter.ts";
import { preserveEnv } from "./env.ts";
import { FakeCore } from "./fakes.ts";
import { createRunners } from "./harness.ts";
import { section } from "./helpers.ts";
import { createStubFailingTestCase, createStubTestCase, createStubTestError, createStubTestResult } from "./stubs.ts";

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

		test("falls back to the unexpected status in the annotation and Failures section when a failed test has no errors", async () => {
			const { summary } = await runTestCases(createStubFailingTestCase({}, { errors: [] }));

			expect(core.errorAnnotations).toEqual([expect.objectContaining({ message: "Unexpected status: failed" })]);
			expect(section(summary, "Failures")).toContain("Unexpected status: failed");
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
});
