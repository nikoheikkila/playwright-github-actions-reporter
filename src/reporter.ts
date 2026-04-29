import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from "@playwright/test/reporter";

import type { Core, SummaryTableRow } from "./interface.ts";

interface StoredResult {
	titlePath: string;
	status: string;
	duration: string;
	retries: string;
	tags: string;
}

export class GitHubReporter implements Reporter {
	private readonly core: Core;
	private readonly results: StoredResult[] = [];

	private files = 0;
	private total = 0;
	private passed = 0;
	private failures = 0;
	private timeouts = 0;
	private skipped = 0;

	constructor(core: Core) {
		this.core = core;
	}

	public onBegin(_config: FullConfig, suite: Suite): void {
		this.files = suite.suites.reduce((total, suite) => total + suite.suites.length, 0);
		this.total = suite.allTests().length;
	}

	public async onEnd(_result: FullResult): Promise<void> {
		const tableRows: SummaryTableRow[] = [
			this.columns,
			...this.results.map((result) => [result.titlePath, result.status, result.duration, result.retries, result.tags]),
		];

		await this.core.summary
			.addHeading("🎭 Playwright Test Report", 2)
			.addHeading("Summary", 3)
			.addList([
				`📁 <strong>${this.files}</strong> test files total`,
				`🧪 <strong>${this.total}</strong> test cases total`,
				`✅ <strong>${this.passed}</strong> tests passed`,
				`❌ <strong>${this.failures}</strong> tests failed`,
				`⏰ <strong>${this.timeouts}</strong> tests timed out`,
				`⚠️ <strong>${this.skipped}</strong> tests skipped`,
			])
			.addHeading("Details", 3)
			.addRaw("<details><summary>Show Test Cases</summary>")
			.addTable(tableRows)
			.addRaw("</details>")
			.write();
	}

	public async onExit(): Promise<void> {
		return;
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

		this.results.push({
			titlePath: this.titlePath(test),
			status: this.status(result),
			duration: this.duration(result),
			retries: this.retries(test),
			tags: this.tags(test),
		});
	}

	public printsToStdio(): boolean {
		return true;
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

	private retries(testCase: TestCase): string {
		return testCase.retries === 0 ? "None" : testCase.retries.toString();
	}

	private tags(testCase: TestCase) {
		return testCase.tags.length > 0 ? testCase.tags.join(", ") : "None";
	}
}
