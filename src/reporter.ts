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

type Status = TestResult["status"];
type Outcome = ReturnType<TestCase["outcome"]>;
type CountedOutcome = Outcome | "interrupted";

const statusLabels = {
	passed: "✅ Passed",
	failed: "❌ Failed",
	timedOut: "⏰ Timed out",
	skipped: "⚠️ Skipped",
	interrupted: "🛑 Interrupted",
} as const satisfies Record<Status, string>;

const expectedStatusLabels: Partial<Record<Status, string>> = {
	failed: "✅ Failed as expected",
};

interface StoredResult {
	titlePath: string;
	label: string;
	duration: string;
	retries: string;
	tags: string;
}

type ResultMap = Map<TestCase["id"], StoredResult>;

type Counts = Record<"passed" | "failed" | "flaky" | "skipped" | "interrupted", number>;

const escapeHtml = (text: string): string =>
	text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export class GitHubReporter implements Reporter {
	private readonly core: Core;
	private readonly results: ResultMap;
	private readonly summary: Summary;

	private files = 0;
	private tests: TestCase[] = [];
	private failOnFlakyTests = false;

	constructor(core: Core) {
		this.core = core;
		this.results = new Map();
		this.summary = core.summary;
	}

	public onBegin(config: FullConfig, suite: Suite): void {
		this.files = suite.suites.reduce((total, suite) => total + suite.suites.length, 0);
		this.tests = suite.allTests();
		this.failOnFlakyTests = config.failOnFlakyTests;
		this.summary.addHeading("🎭 Playwright Test Report", 2).addHeading("Summary", 3);

		this.core.info(`Starting a test run with ${config.workers} workers and ${this.tests.length} tests`);
	}

	public onTestBegin(test: TestCase) {
		this.debug(`Starting test '${this.titlePath(test)}'`);
	}

	public onTestEnd(test: TestCase, result: TestResult): void {
		const titlePath = this.titlePath(test);
		const outcome = test.outcome();
		this.debug(`Finished test '${titlePath}' with result '${result.status}'`);

		this.results.set(test.id, {
			titlePath,
			label: this.label(outcome, result),
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
		const counts = this.counts();
		this.core.notice(`🎭  ${counts.passed} out of ${this.tests.length} test(s) passed (${this.duration(result)})`);

		this.collectSummaryResults(counts);
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

	private counts(): Counts {
		const outcomes = this.tests.map((test) => this.outcome(test));
		const count = (outcome: CountedOutcome) => outcomes.filter((candidate) => candidate === outcome).length;

		return {
			passed: count("expected"),
			failed: count("unexpected"),
			flaky: count("flaky"),
			skipped: count("skipped"),
			interrupted: count("interrupted"),
		};
	}

	private outcome(test: TestCase): CountedOutcome {
		const outcome = test.outcome();
		const interrupted = outcome === "skipped" && test.results.at(-1)?.status === "interrupted";

		return interrupted ? "interrupted" : outcome;
	}

	private collectSummaryResults(counts: Counts) {
		this.summary.addList([
			`📁 <strong>${this.files}</strong> test files total`,
			`🧪 <strong>${this.tests.length}</strong> test cases total`,
			`✅ <strong>${counts.passed}</strong> tests passed`,
			`❌ <strong>${counts.failed}</strong> tests failed`,
			`🔁 <strong>${counts.flaky}</strong> tests flaky`,
			`⚠️ <strong>${counts.skipped}</strong> tests skipped`,
			...(counts.interrupted > 0 ? [`🛑 <strong>${counts.interrupted}</strong> tests interrupted`] : []),
		]);

		if (this.failOnFlakyTests && counts.flaky > 0) {
			this.summary.addRaw("<p>🔁 Flaky tests fail the run because <code>failOnFlakyTests</code> is enabled.</p>", true);
		}
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

	private label(outcome: Outcome, { status, retry }: TestResult): string {
		if (outcome === "flaky") {
			return `🔁 Flaky (${retry + 1} attempts)`;
		}

		if (outcome === "expected") {
			return expectedStatusLabels[status] ?? statusLabels[status];
		}

		return statusLabels[status];
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
			.map((result) => [
				escapeHtml(result.titlePath),
				result.label,
				result.duration,
				result.retries,
				escapeHtml(result.tags),
			]);
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
