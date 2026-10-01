import type { FullConfig, FullResult, Suite, TestCase } from "@playwright/test/reporter";
import type { GitHubReporter } from "../src/reporter.ts";
import type { FakeCore } from "./fakes.ts";
import { createStubConfig, createStubFullResult, createStubSuite } from "./stubs.ts";

export interface RunDependencies {
	config: FullConfig;
	suite: Suite;
	fullResult?: FullResult;
}

export const count = (summary: string, label: string): number =>
	Number(summary.match(new RegExp(`<strong>(\\d+)</strong> ${label}`))?.[1]);

export const createRunners = (getCore: () => FakeCore, getReporter: () => GitHubReporter) => {
	const runTests = async ({ config, suite, fullResult }: RunDependencies) => {
		const core = getCore();
		const reporter = getReporter();
		reporter.onBegin(config, suite);

		for (const testCase of suite.allTests()) {
			for (const result of testCase.results) {
				reporter.onTestBegin(testCase);
				reporter.onTestEnd(testCase, result);
			}
		}

		await reporter.onEnd(fullResult ?? createStubFullResult());
		await reporter.onExit();

		return {
			summary: core.summary.stringify(),
		};
	};

	const runTestCases = (...testCases: TestCase[]) =>
		runTests({
			config: createStubConfig(),
			suite: createStubSuite({
				allTests(): TestCase[] {
					return testCases;
				},
			}),
		});

	return { runTests, runTestCases };
};
