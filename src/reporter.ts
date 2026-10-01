import { relative } from "node:path";
import type {
	FullConfig,
	FullResult,
	Location,
	Reporter,
	Suite,
	TestCase,
	TestError,
	TestResult,
	WorkerInfo,
} from "@playwright/test/reporter";
import type { AttachmentKind } from "./attachments.ts";
import { artifactUrl, attachmentFiles, attachmentKinds } from "./attachments.ts";
import type { RecordedError } from "./failure.ts";
import { errorMessage, errorMessages, errorTitle, failureDetails } from "./failure.ts";
import { attributeEscape, inlineHtml, preformattedHtml } from "./html.ts";
import type { AnnotationProperties, Core, Summary } from "./interface.ts";
import type { Counts, StoredResult } from "./outcome.ts";
import { counts, duration, label, storedResult, titlePath } from "./outcome.ts";
import { countedOutcome, finishedTests } from "./testCase.ts";

export interface GitHubReporterOptions {
	omitTags?: boolean;
	title?: string;
	screenshots?: boolean;
	videos?: boolean;
}

export class GitHubReporter implements Reporter {
	private readonly core: Core;
	private readonly options: GitHubReporterOptions;
	private readonly results = new Map<TestCase["id"], StoredResult>();
	private readonly summary: Summary;
	private readonly recordedErrors: RecordedError[] = [];

	private files = 0;
	private tests: TestCase[] = [];
	private failOnFlakyTests = false;
	private workspace = "";
	/** Artifact URLs keyed by link label, in upload order. */
	private readonly artifactLinks = new Map<string, string>();

	constructor(core: Core, options: GitHubReporterOptions = {}) {
		this.core = core;
		this.options = options;
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
		this.debug(`Starting test '${titlePath(test)}'`);
	}

	public onTestEnd(test: TestCase, result: TestResult): void {
		this.debug(`Finished test '${titlePath(test)}' with result '${result.status}'`);

		this.results.set(test.id, storedResult(test, result));
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
		this.recordedErrors.push({ title: errorTitle(workerInfo), ...errorMessage(error, "Unknown error") });
	}

	public async onEnd(result: FullResult): Promise<void> {
		const runCounts = counts(this.tests);
		this.core.notice(`🎭  ${runCounts.passed} out of ${this.tests.length} test(s) passed (${duration(result)})`);

		this.emitAnnotations();
		this.collectSummaryResults(runCounts);
		this.collectDetailedResults();

		if (runCounts.failed > 0) {
			// The upload is awaited before the Failures section so one artifact link per attachment kind can be rendered under the heading.
			await this.uploadAttachments();
			this.collectFailureDetails();
		}

		if (this.recordedErrors.length > 0) {
			this.collectErrorDetails();
		}

		this.reportFailure(result);
	}

	public async onExit(): Promise<void> {
		await this.summary.write();
	}

	private reportFailure(result: FullResult) {
		if (result.status !== "passed") {
			this.core.setFailed("Test run failed. See the job summary for detailed information.");
		} else if (this.recordedErrors.length > 0) {
			this.core.setFailed("Errors outside tests detected. See the job summary for details.");
		}
	}

	private async uploadAttachments(): Promise<void> {
		for (const kind of attachmentKinds.filter(({ option }) => this.options[option] === true)) {
			const url = await this.uploadArtifactLink(kind);
			if (url !== undefined) {
				this.artifactLinks.set(kind.label, url);
			}
		}
	}

	private async uploadArtifactLink(kind: AttachmentKind): Promise<string | undefined> {
		const artifact = await this.uploadArtifact(kind);
		if (artifact === undefined) {
			return undefined;
		}
		const plural = kind.label.toLowerCase();
		const url = artifactUrl(artifact.id);
		if (url === undefined) {
			this.core.warning(`GitHub run environment is missing, so the summary does not link to ${plural}.`);
		}
		return url;
	}

	/** Resolves to `undefined` when there is nothing to upload or the upload throws, so a failed upload never hides the Failures section. */
	private async uploadArtifact(kind: AttachmentKind): Promise<{ id: number } | undefined> {
		const files = attachmentFiles(this.unexpectedTests(), kind);
		if (files.length === 0) {
			return undefined;
		}
		try {
			return await this.core.uploadArtifact(kind.artifact, files);
		} catch (error) {
			this.core.warning(error instanceof Error ? error.message : String(error));
			return undefined;
		}
	}

	private unexpectedTests(): TestCase[] {
		return this.tests.filter((test) => countedOutcome(test) === "unexpected");
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

	private emitAnnotations() {
		for (const { test, result } of finishedTests(this.tests)) {
			this.annotate(test, result);
		}

		for (const { title, message, location } of this.recordedErrors) {
			this.core.error(message, this.annotation(title, location));
		}
	}

	private annotate(test: TestCase, result: TestResult) {
		const testOutcome = countedOutcome(test);

		if (testOutcome === "unexpected") {
			for (const { message, location } of errorMessages(test, result)) {
				this.core.error(message, this.annotation(titlePath(test), location ?? test.location));
			}
		}

		if (testOutcome === "flaky") {
			this.core.warning(label(testOutcome, result), this.annotation(titlePath(test), test.location));
		}
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

	private collectFailureDetails() {
		this.summary.addHeading("Failures", 3);

		for (const [label, url] of this.artifactLinks) {
			this.summary.addLink(label, attributeEscape(url));
		}

		for (const { test, result } of finishedTests(this.unexpectedTests())) {
			this.summary.addDetails(`❌ ${inlineHtml(titlePath(test))}`, failureDetails(test, result));
		}
	}

	private collectErrorDetails() {
		this.summary.addHeading("Errors outside tests", 3);

		for (const error of this.recordedErrors) {
			this.summary.addDetails(inlineHtml(error.title), preformattedHtml(error));
		}
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
