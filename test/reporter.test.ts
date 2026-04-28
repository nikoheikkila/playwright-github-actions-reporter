import {beforeEach, describe, expect, test} from 'bun:test';
import type {FullConfig, FullResult, Suite, TestCase,} from "@playwright/test/reporter";
import {FakeCore} from "./fakes.ts";
import {GitHubReporter} from "../src/reporter.ts";
import {
  createStubConfig,
  createStubFullResult,
  createStubSuite,
  createStubTestCase,
  createStubTestResult
} from "./stubs.ts";
import type {Core} from "../src/interface.ts";

describe('Playwright GitHub Actions Reporter', () => {
  let core: Core;
  let reporter: GitHubReporter;

  interface RunDependencies {
    config: FullConfig;
    result: FullResult;
    suite: Suite;
  }

  beforeEach(() => {
    core = new FakeCore();
    reporter = new GitHubReporter(core);
  });

  const runTests = async ({config, result, suite}: RunDependencies) => {
    reporter.onBegin(config, suite);

    for (const testCase of suite.allTests()) {
      const result = testCase.results.at(0)!;

      reporter.onTestBegin(testCase, result)
      reporter.onTestEnd(testCase, result);
    }

    reporter.onEnd(result);
    await reporter.onExit();

    return {
      summary: core.summary.stringify()
    }
  }

  test('displays runTests heading', async () => {
    const {summary} = await runTests({
      config: createStubConfig(),
      suite: createStubSuite(),
      result: createStubFullResult()
    });

    expect(summary).toContain('<h2>🎭 Playwright Test Report</h2>');
  });

  test('displays "Summary" heading', async () => {
    const {summary} = await runTests({
      config: createStubConfig(),
      suite: createStubSuite(),
      result: createStubFullResult()
    });

    expect(summary).toContain('<h3>Summary</h3>');
  })

  test('displays total number of test files', async () => {
    const {summary} = await runTests({
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

  test('displays total number of test cases', async () => {
    const {summary} = await runTests({
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

  test('displays number of passed tests', async () => {
    const {summary} = await runTests({
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

  test('displays number of failed tests', async () => {
    const { summary } = await runTests({
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

  test('list number of timed out tests', async () => {
    const { summary } = await runTests({
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

  test('list number of skipped tests', async () => {
    const { summary } = await runTests({
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
            createStubTestCase({
              title: "first skipped test", results: [
                createStubTestResult({
                  status: 'skipped'
                })
              ]
            }),
          ]
        }
      }),
      result: createStubFullResult()
    });

    expect(summary).toContain('<li>🧪 <strong>4</strong> test cases total</li>');
    expect(summary).toContain('<li>✅ <strong>1</strong> tests passed</li>')
    expect(summary).toContain('<li>❌ <strong>1</strong> tests failed</li>')
    expect(summary).toContain('<li>⏰ <strong>1</strong> tests timed out</li>')
    expect(summary).toContain('<li>⚠️ <strong>1</strong> tests skipped</li>');
  })

  test('displays "Details" heading', async () => {
    const {summary} = await runTests({
      config: createStubConfig(),
      suite: createStubSuite(),
      result: createStubFullResult()
    });

    expect(summary).toContain('<h3>Details</h3>');
  })
})
