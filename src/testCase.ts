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

/** Tests that never ran have no result to annotate or detail, so they are left out. */
export function* finishedTests(tests: TestCase[]): Iterable<{ test: TestCase; result: TestResult }> {
	for (const test of tests) {
		const result = lastResult(test);
		if (result !== undefined) {
			yield { test, result };
		}
	}
}
