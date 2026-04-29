import type { FullConfig, FullProject, FullResult, Suite, TestCase, TestResult } from "@playwright/test/reporter";

export function createStubConfig(overrides: Partial<FullConfig> = {}): FullConfig {
	return {
		forbidOnly: false,
		fullyParallel: false,
		globalSetup: null,
		globalTeardown: null,
		globalTimeout: 0,
		grep: /.*/,
		grepInvert: null,
		maxFailures: 0,
		metadata: {},
		preserveOutput: "never",
		projects: [],
		quiet: false,
		reportSlowTests: null,
		reporter: [],
		rootDir: "",
		shard: null,
		tags: [],
		updateSnapshots: "none",
		updateSourceMethod: "overwrite",
		version: "",
		webServer: null,
		workers: 0,
		...overrides,
	};
}

export function createStubSuite(overrides: Partial<Suite> = {}): Suite {
	return {
		suites: [],
		tests: [],
		title: "",
		type: "root",
		allTests(): TestCase[] {
			return [createStubTestCase()];
		},
		entries(): Array<TestCase | Suite> {
			throw new Error("Function not implemented.");
		},
		project(): FullProject | undefined {
			throw new Error("Function not implemented.");
		},
		titlePath(): string[] {
			return [];
		},
		...overrides,
	};
}

export function createStubFullResult(overrides: Partial<FullResult> = {}): FullResult {
	return {
		status: "passed",
		startTime: new Date(),
		duration: 1000,
		...overrides,
	};
}

export function createStubTestCase(overrides: Partial<TestCase> = {}): TestCase {
	return {
		annotations: [],
		expectedStatus: "passed",
		id: "",
		location: {
			column: 0,
			file: "",
			line: 0,
		},
		parent: createStubSuite(),
		repeatEachIndex: 0,
		results: [createStubTestResult()],
		retries: 0,
		tags: [],
		timeout: 0,
		title: "",
		type: "test",
		ok(): boolean {
			throw new Error("Function not implemented.");
		},
		outcome(): "skipped" | "expected" | "unexpected" | "flaky" {
			throw new Error("Function not implemented.");
		},
		titlePath(): string[] {
			return [];
		},
		...overrides,
	};
}

export function createStubTestResult(overrides: Partial<TestResult> = {}): TestResult {
	return {
		annotations: [],
		attachments: [],
		duration: 0,
		errors: [],
		parallelIndex: 0,
		retry: 0,
		startTime: new Date(),
		status: "passed",
		stderr: [],
		stdout: [],
		steps: [],
		workerIndex: 0,
		...overrides,
	};
}
