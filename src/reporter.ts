import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from "@playwright/test/reporter";

import type { Core, ResultMap, Summary } from "./interface.ts";

export class GitHubReporter implements Reporter {
	private readonly core: Core;
	private readonly results: ResultMap;
	private readonly summary: Summary;

	private files = 0;
	private total = 0;
	private passed = 0;
	private failures = 0;
	private timeouts = 0;
	private skipped = 0;

	constructor(core: Core) {
		this.core = core;
		this.results = new Map();
		this.summary = core.summary;
	}

	public onBegin(_config: FullConfig, suite: Suite): void {
		this.files = suite.suites.reduce((total, suite) => total + suite.suites.length, 0);
		this.total = suite.allTests().length;
		this.summary.addHeading("🎭 Playwright Test Report", 2).addHeading("Summary", 3);
	}

	public onTestEnd(test: TestCase, result: TestResult): void {
		if (result.status === "passed") {
			this.passed++;
		}

		if (result.status === "failed") {
			this.failures++;
		}

		if (result.status === "timedOut") {
			this.timeouts++;
		}

		if (result.status === "skipped") {
			this.skipped++;
		}

		this.results.set(test.id, {
			titlePath: this.titlePath(test),
			status: this.status(result),
			duration: this.duration(result),
			retries: this.retries(result),
			tags: this.tags(test),
		});
	}

	public printsToStdio(): boolean {
		return true;
	}

	public onEnd(): void {
		this.collectSummaryResults();
		this.collectDetailedResults();
	}

	public async onExit(): Promise<void> {
		await this.summary.write();
	}

	private collectSummaryResults() {
		return this.summary.addList([
			`📁 <strong>${this.files}</strong> test files total`,
			`🧪 <strong>${this.total}</strong> test cases total`,
			`✅ <strong>${this.passed}</strong> tests passed`,
			`❌ <strong>${this.failures}</strong> tests failed`,
			`⏰ <strong>${this.timeouts}</strong> tests timed out`,
			`⚠️ <strong>${this.skipped}</strong> tests skipped`,
		]);
	}

	private collectDetailedResults() {
		this.summary
			.addHeading("Details", 3)
			.addRaw("<details><summary>Show Test Cases</summary>")
			.addTable([this.columns, ...this.dataRows])
			.addRaw("</details>");
	}

	private titlePath(test: TestCase) {
		return test.titlePath().filter(Boolean).join(" » ");
	}

	private status(result: TestResult): string {
		switch (result.status) {
			case "passed":
				return "✅ Passed";
			case "failed":
				return "❌ Failed";
			case "timedOut":
				return "⏰ Timed out";
			case "skipped":
				return "⚠️ Skipped";
			case "interrupted":
				return "🛑 Interrupted";
			default:
				return result.status;
		}
	}

	private duration(result: TestResult | FullResult): string {
		return `${(result.duration / 1000).toFixed(1)}s`;
	}

	private retries(result: TestResult): string {
		return result.retry === 0 ? "None" : result.retry.toString();
	}

	private tags(testCase: TestCase) {
		return testCase.tags.length > 0 ? testCase.tags.join(", ") : "None";
	}

	private get dataRows() {
		return this.results
			.values()
			.map((result) => [result.titlePath, result.status, result.duration, result.retries, result.tags]);
	}

	private get columns() {
		return [
			{ data: "Test", header: true },
			{ data: "Result", header: true },
			{ data: "Duration", header: true },
			{ data: "Retries", header: true },
			{ data: "Tags", header: true },
		];
	}
}
