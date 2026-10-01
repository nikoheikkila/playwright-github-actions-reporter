import { stripVTControlCharacters } from "node:util";
import type { TestCase, TestError, TestResult, TestStep, WorkerInfo } from "@playwright/test/reporter";
import type { ErrorMessage } from "./html.ts";
import { inlineHtml, preformattedHtml } from "./html.ts";

export interface RecordedError extends ErrorMessage {
	title: string;
}

export const errorMessage = ({ message, value, snippet, location }: TestError, fallback: string): ErrorMessage => ({
	message: stripVTControlCharacters(message ?? value ?? fallback),
	...(snippet === undefined ? {} : { snippet: stripVTControlCharacters(snippet) }),
	location,
});

const unexpectedStatus = ({ expectedStatus }: TestCase, { status }: TestResult): string =>
	status === "passed" && expectedStatus === "failed" ? "Expected to fail, but passed." : `Unexpected status: ${status}`;

/** A `test.fail()` test that passes has no errors, so an empty list falls back to one made-up message. */
export const errorMessages = (test: TestCase, result: TestResult): ErrorMessage[] => {
	const errors: TestError[] = result.errors.length > 0 ? result.errors : [{}];

	return errors.map((error) => errorMessage(error, unexpectedStatus(test, result)));
};

export const errorTitle = (workerInfo?: WorkerInfo): string => {
	const project = workerInfo?.project.name ?? "";

	return project.length > 0 ? `Error outside tests (${project})` : "Error outside tests";
};

const stepTitle = ({ title, subtitle }: TestStep): string =>
	subtitle === undefined ? title : `${title} (${subtitle})`;

const failingSteps = (steps: TestStep[]): string[] => {
	const step = steps.find(({ error }) => error !== undefined);

	return step === undefined ? [] : [stepTitle(step), ...failingSteps(step.steps)];
};

const renderFailingStep = ({ steps }: TestResult): string => {
	const chain = failingSteps(steps);

	return chain.length > 0 ? `<p><strong>Step:</strong> <code>${inlineHtml(chain.join(" » "))}</code></p>` : "";
};

export const failureDetails = (test: TestCase, result: TestResult): string => {
	const blocks = errorMessages(test, result).map(preformattedHtml).join("");

	return `<div>${renderFailingStep(result)}${blocks}</div>`;
};
