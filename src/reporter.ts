import { relative } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type {
	FullConfig,
	FullResult,
	Location,
	Reporter,
	Suite,
	TestCase,
	TestError,
	TestResult,
	TestStep,
	WorkerInfo,
} from "@playwright/test/reporter";
import type { AnnotationProperties, Core, Summary } from "./interface.ts";

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

interface StoredResult {
	titlePath: string;
	label: string;
	duration: string;
	retries: string;
	tags: string;
}

type ResultMap = Map<TestCase["id"], StoredResult>;

type Counts = Record<"passed" | "failed" | "flaky" | "skipped" | "interrupted", number>;

interface ErrorMessage {
	message: string;
	snippet?: string;
	location?: Location;
}

interface RecordedError extends ErrorMessage {
	title: string;
}

const lineBreaks = /\r\n|\r|\n/g;

const escapeHtml = (text: string): string =>
	text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const inlineHtml = (text: string): string => escapeHtml(text).replaceAll(/\s*[\r\n]+\s*/g, " ");

const preformattedHtml = ({ message, snippet }: ErrorMessage): string =>
	(snippet === undefined ? [message] : [message, snippet])
		.map((text) => `<pre>${escapeHtml(text).replaceAll(lineBreaks, "&#10;")}</pre>`)
		.join("");

export interface GitHubReporterOptions {
	omitTags?: boolean;
	title?: string;
}

export class GitHubReporter implements Reporter {
	private readonly core: Core;
	private readonly options: GitHubReporterOptions;
	private readonly results: ResultMap;
	private readonly summary: Summary;
	private readonly recordedErrors: RecordedError[] = [];

	private files = 0;
	private tests: TestCase[] = [];
	private failOnFlakyTests = false;
	private workspace = "";

	constructor(core: Core, options: GitHubReporterOptions = {}) {
		this.core = core;
		this.options = options;
		this.results = new Map();
		this.summary = core.summary;
	}

	public onBegin(config: FullConfig, suite: Suite): void {
		this.files = suite.suites.reduce((total, suite) => total + suite.suites.length, 0);
		this.tests = suite.allTests();
		this.failOnFlakyTests = config.failOnFlakyTests;
		this.workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
		this.summary.addHeading(this.heading(config.shard), 2).addHeading("Summary", 3);

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

	public onError(error: TestError, workerInfo?: WorkerInfo): void {
		this.recordedErrors.push({ title: this.errorTitle(workerInfo), ...this.errorMessage(error, "Unknown error") });
	}

	public onEnd(result: FullResult): void {
		const counts = this.counts();
		this.core.notice(`🎭  ${counts.passed} out of ${this.tests.length} test(s) passed (${this.duration(result)})`);

		this.emitAnnotations();
		this.collectSummaryResults(counts);
		this.collectDetailedResults();

		const unexpectedTests = this.tests.filter((test) => this.outcome(test) === "unexpected");
		if (unexpectedTests.length > 0) {
			this.collectFailureDetails(unexpectedTests);
		}

		if (this.recordedErrors.length > 0) {
			this.collectErrorDetails();
		}

		if (result.status !== "passed") {
			this.core.setFailed("Test run failed. See the job summary for detailed information.");
		} else if (this.recordedErrors.length > 0) {
			this.core.setFailed("Errors outside tests detected. See the job summary for details.");
		}
	}

	public async onExit(): Promise<void> {
		await this.summary.write();
	}

	private heading(shard: FullConfig["shard"]): string {
		const title = inlineHtml(this.options.title ?? "🎭 Playwright Test Report");

		return shard === null ? title : `${title} (shard ${shard.current}/${shard.total})`;
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

	private emitAnnotations() {
		for (const test of this.tests) {
			const result = test.results.at(-1);

			if (result !== undefined) {
				this.annotate(test, result);
			}
		}

		for (const { title, message, location } of this.recordedErrors) {
			this.core.error(message, this.annotation(title, location));
		}
	}

	private annotate(test: TestCase, result: TestResult) {
		const outcome = this.outcome(test);

		if (outcome === "unexpected") {
			for (const { message, location } of this.errorMessages(test, result)) {
				this.core.error(message, this.annotation(this.titlePath(test), location ?? test.location));
			}
		}

		if (outcome === "flaky") {
			this.core.warning(this.label(outcome, result), this.annotation(this.titlePath(test), test.location));
		}
	}

	private errorMessages(test: TestCase, result: TestResult): ErrorMessage[] {
		const errors: TestError[] = result.errors.length > 0 ? result.errors : [{}];

		return errors.map((error) => this.errorMessage(error, this.unexpectedStatus(test, result)));
	}

	private errorMessage({ message, value, snippet, location }: TestError, fallback: string): ErrorMessage {
		return {
			message: stripVTControlCharacters(message ?? value ?? fallback),
			...(snippet === undefined ? {} : { snippet: stripVTControlCharacters(snippet) }),
			location,
		};
	}

	private errorTitle(workerInfo?: WorkerInfo): string {
		const project = workerInfo?.project.name ?? "";

		return project.length > 0 ? `Error outside tests (${project})` : "Error outside tests";
	}

	private unexpectedStatus({ expectedStatus }: TestCase, { status }: TestResult): string {
		return status === "passed" && expectedStatus === "failed"
			? "Expected to fail, but passed."
			: `Unexpected status: ${status}`;
	}

	private annotation(title: string, location?: Location): AnnotationProperties {
		if (location === undefined) {
			return { title };
		}

		return {
			title,
			file: relative(this.workspace, location.file),
			startLine: location.line,
			startColumn: location.column,
		};
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

	private collectFailureDetails(tests: TestCase[]) {
		this.summary.addHeading("Failures", 3);

		for (const test of tests) {
			const result = test.results.at(-1);

			if (result !== undefined) {
				this.summary.addDetails(`❌ ${inlineHtml(this.titlePath(test))}`, this.failureDetails(test, result));
			}
		}
	}

	private failureDetails(test: TestCase, result: TestResult): string {
		const blocks = this.errorMessages(test, result).map(preformattedHtml).join("");

		return `<div>${this.renderFailingStep(result)}${blocks}</div>`;
	}

	private collectErrorDetails() {
		this.summary.addHeading("Errors outside tests", 3);

		for (const error of this.recordedErrors) {
			this.summary.addDetails(inlineHtml(error.title), preformattedHtml(error));
		}
	}

	private renderFailingStep({ steps }: TestResult): string {
		const chain = this.failingSteps(steps);

		return chain.length > 0 ? `<p><strong>Step:</strong> <code>${inlineHtml(chain.join(" » "))}</code></p>` : "";
	}

	private failingSteps(steps: TestStep[]): string[] {
		const step = steps.find(({ error }) => error !== undefined);

		return step === undefined ? [] : [this.stepTitle(step), ...this.failingSteps(step.steps)];
	}

	private stepTitle({ title, subtitle }: TestStep): string {
		return subtitle === undefined ? title : `${title} (${subtitle})`;
	}

	private titlePath(test: TestCase) {
		return test.titlePath().filter(Boolean).join(" » ");
	}

	private label(outcome: Outcome, { status, retry }: TestResult): string {
		if (outcome === "flaky") {
			return `🔁 Flaky (${retry + 1} attempts)`;
		}

		return outcome === "expected" && status === "failed" ? "✅ Failed as expected" : statusLabels[status];
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

	private withTags<Cell>(cells: Cell[], tags: Cell): Cell[] {
		return this.options.omitTags === true ? cells : [...cells, tags];
	}

	private get dataRows() {
		return this.results
			.values()
			.map((result) =>
				this.withTags(
					[inlineHtml(result.titlePath), result.label, result.duration, result.retries],
					inlineHtml(result.tags),
				),
			);
	}

	private get columns() {
		return this.withTags(
			[
				{ data: "Test", header: true },
				{ data: "Result", header: true },
				{ data: "Duration", header: true },
				{ data: "Retries", header: true },
			],
			{ data: "Tags", header: true },
		);
	}
}
