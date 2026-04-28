import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
  TestResult,
  TestStep
} from "@playwright/test/reporter";

import type {Core} from "./interface.ts";

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

  onBegin(config: FullConfig, suite: Suite): void {
    this.files = suite.suites.reduce((total, suite) => total + suite.suites.length, 0);
    this.total = suite.allTests().length;
  }

  public async onEnd(result: FullResult): Promise<void> {
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

  onError(error: TestError): void {
  }

  onExit(): Promise<void> {
    return Promise.resolve(undefined);
  }

  onStdErr(chunk: string | Buffer, test: void | TestCase, result: void | TestResult): void {
  }

  onStdOut(chunk: string | Buffer, test: void | TestCase, result: void | TestResult): void {
  }

  onStepBegin(test: TestCase, result: TestResult, step: TestStep): void {
  }

  onStepEnd(test: TestCase, result: TestResult, step: TestStep): void {
  }

  onTestBegin(test: TestCase, result: TestResult): void {
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
  }

  printsToStdio(): boolean {
    return true;
  }

}
