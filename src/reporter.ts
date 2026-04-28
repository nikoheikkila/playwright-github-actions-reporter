import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from "@playwright/test/reporter";

import type { Core } from "./interface.ts";

export class GitHubReporter implements Reporter {
	private readonly core: Core;

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
			.write();
	}

	public async onExit(): Promise<void> {
		return;
	}

	public onTestEnd(_test: TestCase, result: TestResult): void {
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
	}

	public printsToStdio(): boolean {
		return true;
	}
}
