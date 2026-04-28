import {describe, test, expect, beforeEach} from 'bun:test';
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
  private total = 0;
  private passed = 0;
  private failures = 0;
  private timeouts = 0;

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
      return [
        createStubTestCase(),
      ]
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

function createStubTestCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    annotations: [],
    expectedStatus: "passed",
    id: "",
    location: {
      column: 0,
      file: "",
      line: 0
    },
    parent: createStubSuite(),
    repeatEachIndex: 0,
    results: [
      createStubTestResult()
    ],
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
    titlePath(): Array<string> {
      throw new Error("Function not implemented.");
    },
    ...overrides
  };
}

function createStubTestResult(overrides: Partial<TestResult> = {}): TestResult {
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

    for (const testCase of deps.suite.allTests()) {
      const result = testCase.results.at(0)!;

      reporter.onTestBegin(testCase, result)
      reporter.onTestEnd(testCase, result);
    }

    reporter.onEnd(deps.result);

    return {
      summary: core.summary.stringify()
    }
  }

  test('displays report heading', () => {
    const {summary} = run({
      config: createStubConfig(),
      suite: createStubSuite(),
      result: createStubFullResult()
    });

    expect(summary).toContain('<h2>🎭 Playwright Test Report</h2>');
  });

  test('displays "Summary" heading', () => {
    const {summary} = run({
      config: createStubConfig(),
      suite: createStubSuite(),
      result: createStubFullResult()
    });

    expect(summary).toContain('<h3>Summary</h3>');
  })

  test('displays total number of test files', () => {
    const {summary} = run({
      config: createStubConfig(),
      suite: createStubSuite({
        type: "root",
        title: "Tests",
        suites: [
          createStubSuite({
            type: "project",
            title: "Playwright",
            suites: [
              createStubSuite({type: "file", title: "example1.spec.ts"}),
              createStubSuite({type: "file", title: "example2.spec.ts"}),
            ]
          })
        ]
      }),
      result: createStubFullResult()
    });

    expect(summary).toContain('<li>📁 <strong>2</strong> test files total</li>');
  })

  test('displays total number of test cases', () => {
    const {summary} = run({
      config: createStubConfig(),
      suite: createStubSuite({
        allTests(): TestCase[] {
          return [
            createStubTestCase(),
            createStubTestCase(),
          ]
        }
      }),
      result: createStubFullResult()
    });

    expect(summary).toContain('<li>🧪 <strong>2</strong> test cases total</li>');
  });

  test('displays number of passed tests', () => {
    const {summary} = run({
      config: createStubConfig(),
      suite: createStubSuite({
        allTests(): TestCase[] {
          return [
            createStubTestCase({title: "first passing test"}),
            createStubTestCase({title: "second passing test"}),
          ]
        }
      }),
      result: createStubFullResult()
    });

    expect(summary).toContain('<li>🧪 <strong>2</strong> test cases total</li>');
    expect(summary).toContain('<li>✅ <strong>2</strong> tests passed</li>')
  })

  test('displays number of failed tests', () => {
    const { summary } = run({
      config: createStubConfig(),
      suite: createStubSuite({
        allTests(): TestCase[] {
          return [
            createStubTestCase({title: "first passing test"}),
            createStubTestCase({
              title: "first failing test", results: [
                createStubTestResult({
                  status: 'failed'
                })
              ]
            }),
          ]
        }
      }),
      result: createStubFullResult()
    });

    expect(summary).toContain('<li>🧪 <strong>2</strong> test cases total</li>');
    expect(summary).toContain('<li>✅ <strong>1</strong> tests passed</li>')
    expect(summary).toContain('<li>❌ <strong>1</strong> tests failed</li>')
  })

  test('list number of timed out tests', () => {
    const { summary } = run({
      config: createStubConfig(),
      suite: createStubSuite({
        allTests(): TestCase[] {
          return [
            createStubTestCase({ title: "first passing test" }),
            createStubTestCase({
              title: "first failing test", results: [
                createStubTestResult({
                  status: 'failed'
                })
              ]
            }),
            createStubTestCase({
              title: "first timed out test", results: [
                createStubTestResult({
                  status: 'timedOut'
                })
              ]
            }),
          ]
        }
      }),
      result: createStubFullResult()
    });

    expect(summary).toContain('<li>🧪 <strong>3</strong> test cases total</li>');
    expect(summary).toContain('<li>✅ <strong>1</strong> tests passed</li>')
    expect(summary).toContain('<li>❌ <strong>1</strong> tests failed</li>')
    expect(summary).toContain('<li>⏰ <strong>1</strong> tests timed out</li>')
  })
})
