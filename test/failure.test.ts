import { describe, expect, test } from "bun:test";
import { errorMessages } from "../src/failure.ts";
import { createStubTestCase, createStubTestResult } from "./stubs.ts";

describe("errorMessages", () => {
	test.each([
		["passed", "failed", "Expected to fail, but passed."],
		["passed", "passed", "Unexpected status: passed"],
		["failed", "failed", "Unexpected status: failed"],
		["timedOut", "passed", "Unexpected status: timedOut"],
	] as const)("falls back for a %s result expecting %s", (status, expectedStatus, message) => {
		const testCase = createStubTestCase({ expectedStatus });
		const result = createStubTestResult({ status, errors: [] });

		expect(errorMessages(testCase, result)).toStrictEqual([{ message, location: undefined }]);
	});
});
