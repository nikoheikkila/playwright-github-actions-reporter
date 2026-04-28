import { describe, test, expect, beforeEach } from 'bun:test';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
  TestError,
  TestStep,
  FullProject,
} from "@playwright/test/reporter";
import * as core from '@actions/core';
import * as Buffer from "node:buffer";

interface Summary {
    addHeading(text: string, level: number): Summary;
    addList(items: string[]): Summary;
    write(): Promise<void>;
    stringify(): string;
}

interface Core {
  summary: Summary;
}

class FakeSummary implements Summary {
  private summaryBuffer: string;
  private storedSummary: string;

  constructor() {
    this.summaryBuffer = "";
    this.storedSummary = "";
  }

  public addHeading(text: string, level: number): Summary {
    this.summaryBuffer += `<h${level}>${text}</h${level}>`

    return this;
  }

  public addList(items: string[]): Summary {
    this.summaryBuffer += "<ul>"

    for (const item of items) {
      this.summaryBuffer += `<li>${item}</li>`;
    }

    this.summaryBuffer += "</ul>"

    return this;
  }

  public async write(): Promise<void> {
    this.storedSummary = this.summaryBuffer;
  }

  public stringify(): string {
    return this.storedSummary;
  }
}

class FakeCore implements Core {
  public readonly summary: FakeSummary;

  constructor() {
    this.summary = new FakeSummary();
  }
}

class GitHubReporter implements Reporter {
  private readonly core: Core;

  private files = 0;

  constructor(core: Core) {
    this.core = core;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.files = suite.suites.reduce((total, suite) => total + suite.suites.length, 0);
  }

  public async onEnd(result: FullResult): Promise<void> {
    await this.core.summary
      .addHeading("🎭 Playwright Test Report", 2)
      .addHeading("Summary", 3)
      .addList([
        `📁 <strong>${this.files}</strong> test files total`
      ])
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

  onTestEnd(test: TestCase, result: TestResult): void {
  }

  printsToStdio(): boolean {
    return false;
  }

}

function createStubConfig(overrides: Partial<FullConfig> = {}): FullConfig {
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
  }
}

function createStubSuite(overrides: Partial<Suite> = {}): Suite {
  return {
    suites: [],
    tests: [],
    title: "",
    type: "root",
    allTests(): Array<TestCase> {
      throw new Error("Function not implemented.");
    },
    entries(): Array<TestCase | Suite> {
      throw new Error("Function not implemented.");
    },
    project(): FullProject | undefined {
      throw new Error("Function not implemented.");
    },
    titlePath(): Array<string> {
      throw new Error("Function not implemented.");
    },
    ...overrides,
  };
}

function createStubFullResult(overrides: Partial<FullResult> = {}): FullResult {
  return {
    status: "passed",
    startTime: new Date(),
    duration: 1000,
    ...overrides,
  };
}

describe('Playwright GitHub Actions Reporter', () => {
  let core: Core;
  let reporter: GitHubReporter;

  interface RunDependencies {
    config: FullConfig;
    suite: Suite;
    result: FullResult;
  }

  beforeEach(() => {
    core = new FakeCore();
    reporter = new GitHubReporter(core);
  });

  const run = (deps: RunDependencies) => {
    reporter.onBegin(deps.config, deps.suite);
    reporter.onEnd(deps.result);
  }

  test('displays report heading', () => {
    run({
      config: createStubConfig(),
      suite: createStubSuite(),
      result: createStubFullResult()
    });

    expect(core.summary.stringify()).toContain('<h2>🎭 Playwright Test Report</h2>');
  });

  test('displays "Summary" heading', () => {
    run({
      config: createStubConfig(),
      suite: createStubSuite(),
      result: createStubFullResult()
    });

    expect(core.summary.stringify()).toContain('<h3>Summary</h3>');
  })

  test('displays total number of test files', () => {
    run({
      config: createStubConfig(),
      suite: createStubSuite({
        type: "root",
        title: "Tests",
        suites: [
          createStubSuite({
            type: "project",
            title: "Playwright",
            suites: [
              createStubSuite({ type: "file", title: "example1.spec.ts" }),
              createStubSuite({ type: "file", title: "example2.spec.ts" }),
            ]
          })
        ]
      }),
      result: createStubFullResult()
    });

    expect(core.summary.stringify()).toContain('<li>📁 <strong>2</strong> test files total</li>');
  })
})
