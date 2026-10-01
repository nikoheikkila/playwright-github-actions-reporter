import { describe, expect, test } from "bun:test";
import { countedOutcome, lastResult } from "../src/testCase.ts";
import { createStubTestCase, createStubTestResult } from "./stubs.ts";

describe("lastResult", () => {
	test("returns the final result when a test has several results", () => {
		const first = createStubTestResult({ retry: 0, status: "failed" });
		const last = createStubTestResult({ retry: 1, status: "passed" });
		const test_ = createStubTestCase({ results: [first, last] });

		expect(lastResult(test_)).toBe(last);
	});
});

describe("countedOutcome", () => {
	test("reports interrupted when Playwright outcome is skipped and the last result was interrupted", () => {
		const test_ = createStubTestCase({
			results: [createStubTestResult({ status: "interrupted" })],
			outcome: () => "skipped",
		});

		expect(countedOutcome(test_)).toBe("interrupted");
	});
});
