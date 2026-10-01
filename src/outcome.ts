import type { FullResult, TestCase, TestResult } from "@playwright/test/reporter";
import type { CountedOutcome, Outcome } from "./testCase.ts";
import { countedOutcome } from "./testCase.ts";

type Status = TestResult["status"];

export type Counts = Record<"passed" | "failed" | "flaky" | "skipped" | "interrupted", number>;

const statusLabels = {
	passed: "✅ Passed",
	failed: "❌ Failed",
	timedOut: "⏰ Timed out",
	skipped: "⚠️ Skipped",
	interrupted: "🛑 Interrupted",
} as const satisfies Record<Status, string>;

export const counts = (tests: TestCase[]): Counts => {
	const outcomes = tests.map(countedOutcome);
	const count = (outcome: CountedOutcome) => outcomes.filter((candidate) => candidate === outcome).length;

	return {
		passed: count("expected"),
		failed: count("unexpected"),
		flaky: count("flaky"),
		skipped: count("skipped"),
		interrupted: count("interrupted"),
	};
};

export const label = (outcome: Outcome, { status, retry }: TestResult): string => {
	if (outcome === "flaky") {
		return `🔁 Flaky (${retry + 1} attempts)`;
	}

	return outcome === "expected" && status === "failed" ? "✅ Failed as expected" : statusLabels[status];
};

export const titlePath = (test: TestCase): string => test.titlePath().filter(Boolean).join(" » ");

export const duration = (result: TestResult | FullResult): string => `${(result.duration / 1000).toFixed(1)}s`;

const retries = (result: TestResult): string => (result.retry === 0 ? "None" : result.retry.toString());

const tags = (test: TestCase): string => (test.tags.length > 0 ? test.tags.join(", ") : "None");

/** One summary table row, precomputed in `onTestEnd` so a retry overwrites the earlier attempt. */
export interface StoredResult {
	titlePath: string;
	label: string;
	duration: string;
	retries: string;
	tags: string;
}

export const storedResult = (test: TestCase, result: TestResult): StoredResult => ({
	titlePath: titlePath(test),
	label: label(test.outcome(), result),
	duration: duration(result),
	retries: retries(result),
	tags: tags(test),
});
