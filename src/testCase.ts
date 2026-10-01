import type { TestCase, TestResult } from "@playwright/test/reporter";

export type Outcome = ReturnType<TestCase["outcome"]>;
export type CountedOutcome = Outcome | "interrupted";

export function lastResult(test: TestCase): TestResult | undefined {
	return test.results.at(-1);
}

export function countedOutcome(test: TestCase): CountedOutcome {
	const outcome = test.outcome();
	if (outcome === "skipped" && lastResult(test)?.status === "interrupted") {
		return "interrupted";
	}
	return outcome;
}
