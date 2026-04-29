import type {
	FullConfig,
	FullResult,
	Reporter,
	Suite,
	TestCase,
	TestError,
	TestResult,
} from "@playwright/test/reporter";
import type { Core, Summary } from "./interface.ts";

const statusLabels = {
	passed: "✅ Passed",
	failed: "❌ Failed",
	timedOut: "⏰ Timed out",
	skipped: "⚠️ Skipped",
	interrupted: "🛑 Interrupted",
} as const satisfies Record<TestResult["status"], string>;

interface StoredResult {
	titlePath: string;
	status: TestResult["status"];
	duration: string;
	retries: string;
	tags: string;
}

type ResultMap = Map<TestCase["id"], StoredResult>;

export class GitHubReporter implements Reporter {
	private readonly core: Core;
	private readonly results: ResultMap;
	private readonly summary: Summary;

	private files = 0;
	private total = 0;
	private readonly counts: Record<TestResult["status"], number> = {
		passed: 0,
		failed: 0,
		timedOut: 0,
		skipped: 0,
		interrupted: 0,
	};

	constructor(core: Core) {
		this.core = core;
		this.results = new Map();
		this.summary = core.summary;
	}

	public onBegin(config: FullConfig, suite: Suite): void {
		this.files = suite.suites.reduce((total, suite) => total + suite.suites.length, 0);
		this.total = suite.allTests().length;
		this.summary.addHeading("🎭 Playwright Test Report", 2).addHeading("Summary", 3);

		this.core.info(`Starting a test run with ${config.workers} workers and ${this.total} tests`);
	}

	public onTestBegin(test: TestCase) {
		this.debug(`Starting test '${this.titlePath(test)}'`);
	}

	public onTestEnd(test: TestCase, result: TestResult): void {
		const titlePath = this.titlePath(test);
		this.debug(`Finished test '${titlePath}' with result '${result.status}'`);
		this.counts[result.status]++;

		this.results.set(test.id, {
			titlePath,
			status: result.status,
			duration: this.duration(result),
			retries: this.retries(result),
			tags: this.tags(test),
		});
	}

	public printsToStdio(): boolean {
		return true;
	}

	public onStdOut(chunk: string | Buffer): void {
		this.core.info(chunk.toString("utf-8"));
	}

	public onStdErr(chunk: string | Buffer): void {
		this.core.info(chunk.toString("utf-8"));
	}

	public onError(error: TestError): never {
		throw error;
	}

	public onEnd(result: FullResult): void {
		this.core.notice(`🎭  ${this.counts.passed} out of ${this.total} test(s) passed (${this.duration(result)})`);

		this.collectSummaryResults();
		this.collectDetailedResults();

		if (result.status !== "passed") {
			this.core.setFailed("Test run failed. See the job summary for detailed information.");
		}
	}

	public async onExit(): Promise<void> {
		await this.summary.write();
	}

	private debug(message: string) {
		if (this.core.isDebug()) {
			this.core.debug(message);
		}
	}

	private collectSummaryResults() {
		return this.summary.addList([
			`📁 <strong>${this.files}</strong> test files total`,
			`🧪 <strong>${this.total}</strong> test cases total`,
			`✅ <strong>${this.counts.passed}</strong> tests passed`,
			`❌ <strong>${this.counts.failed}</strong> tests failed`,
			`⏰ <strong>${this.counts.timedOut}</strong> tests timed out`,
			`⚠️ <strong>${this.counts.skipped}</strong> tests skipped`,
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
			.map((result) => [result.titlePath, statusLabels[result.status], result.duration, result.retries, result.tags]);
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
