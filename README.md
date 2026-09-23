# playwright-github-actions-reporter

A [Playwright](https://playwright.dev) reporter that renders test results as a [GitHub Actions step summary](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/workflow-commands-for-github-actions#adding-a-job-summary) — rich Markdown/HTML surfaced directly on your workflow runs, no external services required.

[![CI](https://github.com/nikoheikkila/playwright-github-actions-reporter/actions/workflows/ci.yml/badge.svg)](https://github.com/nikoheikkila/playwright-github-actions-reporter/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@nikoheikkila/playwright-github-actions-reporter)](https://www.npmjs.com/package/@nikoheikkila/playwright-github-actions-reporter)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Overview

When your workflow runs, the reporter writes a formatted summary to the job page and adds inline annotations to the files that failed.

**Summary section**: one final outcome per test, so the counts always add up to the total:

> 🎭 **Playwright Test Report**
>
> ### Summary
>
> - 📁 **1** test files total
> - 🧪 **6** test cases total
> - ✅ **2** tests passed
> - ❌ **2** tests failed
> - 🔁 **1** tests flaky
> - ⚠️ **1** tests skipped

A 🛑 interrupted line appears only when a run was cut short, for example by `maxFailures` or a global timeout.

**Details section**: a collapsible table with per-test metadata:

| Test                                                        | Result                | Duration | Retries | Tags     |
|-------------------------------------------------------------|-----------------------|----------|---------|----------|
| Reporter Verification » example.spec.ts » passing test      | ✅ Passed              | 0.0s     | None    | @pass    |
| Reporter Verification » example.spec.ts » failing test      | ✅ Failed as expected  | 0.0s     | None    | @fail    |
| Reporter Verification » example.spec.ts » timed out test    | ⏰ Timed out           | 0.1s     | 1       | @timeOut |
| Reporter Verification » example.spec.ts » flaky test        | 🔁 Flaky (2 attempts)  | 0.0s     | 1       | @flaky   |
| Reporter Verification » example.spec.ts » failing step test | ❌ Failed              | 0.0s     | 1       | @step    |
| Reporter Verification » example.spec.ts » skipped test      | ⚠️ Skipped            | 0.0s     | None    | @skip    |

**Failures section**: one collapsible block per failed test. It shows the chain of failing steps, each error message and the source snippet:

> ❌ Reporter Verification » example.spec.ts » failing step test
>
> **Step:** `Add to cart (SKU 42) » Expect "toBe"`
>
> ```
> Error: expect(received).toBe(expected) // Object.is equality
>
> Expected: 3
> Received: 2
> ```

Errors raised outside any test, such as a failing worker fixture teardown, get their own **Errors outside tests** section.

**Inline annotations**: failed tests are annotated with `::error` at the failing line of the spec file, and flaky tests with `::warning`. They appear on the workflow run and in pull request diffs.

## Features

- Renders a collapsible HTML summary in the GitHub job summary, visible on every workflow run
- Counts each test once by its final outcome (passed, failed, flaky, skipped, interrupted), so retries never inflate the numbers, and expected failures from `test.fail()` don't count as failures
- Shows hierarchical test titles (`Project » file » describe » test`) with per-test duration, retry count and tags
- Explains failures in the summary: the failing step chain (including step subtitles), error messages and code snippets, without stack traces
- Annotates failures and flaky tests inline on the spec file, with paths relative to the repository
- Reports errors outside tests (for example fixture teardown) instead of crashing the reporter
- Labels sharded runs with `(shard x/y)` so matrix jobs can be told apart
- Marks the workflow step as failed when the run fails, so a broken build never passes silently
- Escapes all test-controlled text, so titles or messages containing HTML can't break the summary layout
- Zero configuration: works out of the box on any GitHub Actions runner, with [options](#reporter-options) when you need them

## Requirements

| Dependency         | Version                            |
|--------------------|------------------------------------|
| `@playwright/test` | `^1.63.0` (peer dependency)        |
| Node.js / Bun      | any version supported by the above |

## Installation

```bash
# npm
npm install --save-dev @nikoheikkila/playwright-github-actions-reporter

# Bun
bun add --dev @nikoheikkila/playwright-github-actions-reporter
```

Other package managers have not been tested, but should be supported.

## Usage

Add the reporter to your Playwright configuration. It can be used alongside other reporters:

```typescript
// playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: [
    ["@nikoheikkila/playwright-github-actions-reporter"],
    ["html"], // optional: keep the local HTML report too
  ],
  // ... rest of your config
});
```

Then run Playwright as usual in your GitHub Actions workflow — the step summary is written automatically:

```yaml
# .github/workflows/ci.yml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps

      - name: Run tests
        run: npx playwright test
```

GitHub Actions sets `$GITHUB_STEP_SUMMARY` automatically on every runner. The reporter reads that variable and writes the summary there — nothing else to configure.

## Reporter options

The reporter accepts options to customize its output:

```typescript
// playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: [
    [
      "@nikoheikkila/playwright-github-actions-reporter",
      {
        omitTags: true,
        title: "E2E tests",
      },
    ],
  ],
});
```

| Option     | Type      | Description                                                                                                                                  |
|------------|-----------|----------------------------------------------------------------------------------------------------------------------------------------------|
| `omitTags` | `boolean` | When `true`, hides the Tags column from the results table. Defaults to `false`. Matches Playwright's built-in `omitTags` option in 1.63+. |
| `title`    | `string`  | Custom heading for the report, replacing "🎭 Playwright Test Report". Defaults to the standard heading.                                      |

When running sharded tests (configured with `shard` in `playwright.config.ts`), the report automatically appends " (shard x/y)" to the heading, so parallel jobs can be distinguished in the summary.

## Development

This project uses [Bun](https://bun.sh) as the runtime and package manager, and [Task](https://taskfile.dev) for scripting.

```bash
# Install dependencies
bun install

# Run unit tests with coverage
task test

# Run unit tests in watch mode
task test:watch

# Lint with Biome
task lint

# Type-check (bun test strips types without checking them)
task typecheck

# Auto-fix lint issues
task format

# Run the full e2e suite and diff output against the snapshot
task verify summary=test-results/summary.md

# Full local pipeline: format → lint → typecheck → test → verify → build
task test:all

# See what a newer Playwright changes in the reporter API (read-only)
task playwright:diff version=latest
```

### How it works

```
Playwright lifecycle events
        │
        ▼
  GitHubReporter
  ├── onBegin    → writes report heading (title, shard); captures all tests
  ├── onTestEnd  → stores one row per test (a retry overwrites the earlier row)
  ├── onError    → records errors outside tests (never throws)
  ├── onEnd      → annotations, counts, details table, Failures,
  │                Errors outside tests, setFailed
  └── onExit     → flushes summary to $GITHUB_STEP_SUMMARY
        │
        ▼
  @actions/core
  ├── summary.addHeading / addList / addTable / addDetails → step summary
  └── error / warning / notice / setFailed / info           → annotations and logs
```

Annotations are emitted only once the run has ended, so a test that fails and then passes on retry is reported as a flaky warning, not an error. GitHub shows at most 10 error and 10 warning annotations per step. The summary always lists every failure.

The reporter depends on the `Core` abstraction defined in `src/interface.ts` rather than `@actions/core` directly. This keeps the core logic testable with lightweight fakes and lets the production entry point (`index.ts`) wire in the real GitHub SDK.

### Project layout

```
index.ts                  # Production entry point (wires @actions/core)
src/
  reporter.ts             # GitHubReporter: implements Playwright's Reporter interface
  interface.ts            # Core / Summary / AnnotationProperties abstractions
test/
  reporter.test.ts        # Unit test suite (bun:test)
  fakes.ts                # FakeCore / FakeSummary for isolated testing
  stubs.ts                # Factory functions for Playwright fixture objects
e2e/
  example.spec.ts         # Intentional pass / expected-fail / timeout / flaky / failing-step / skip scenarios
  createStepSummary.ts    # Local-only globalSetup that creates $GITHUB_STEP_SUMMARY
  snapshots/
    summary.md            # Expected reporter output; diffed in `task verify`
scripts/
  diffPlaywrightTypes.ts  # Reporter-facing type diff behind `task playwright:diff`
```

### Snapshot testing

The `task verify` task runs the e2e suite with this reporter and diffs the produced summary against `e2e/snapshots/summary.md`. If your change intentionally alters the rendered output, update the snapshot in the same commit:

```bash
# Run e2e and overwrite the snapshot
task verify summary=e2e/snapshots/summary.md

# Run again against a scratch file to confirm the output is deterministic
task verify summary=test-results/summary.md
```

The summary deliberately leaves out stack traces, because their absolute paths would make the snapshot differ between machines.

## Contributing

1. Fork the repository and create a feature branch.
2. Run `task test:all` to verify everything passes locally.
3. Open a pull request. CI runs lint, the type check, unit tests, and the e2e snapshot check.

**Code style** is enforced by [Biome](https://biomejs.dev) via a pre-commit hook. Don't bypass hooks with `--no-verify`; if a hook fails, fix the underlying issue. Key rules:

- Tabs for indentation, double quotes, trailing commas, 120-character line width
- Strict TypeScript (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`, no `any`)
- `import type` / `export type` for type-only symbols
- No `Array.prototype.forEach` — use `for...of` or iterator chains instead
- `readonly` class fields where values are never reassigned

## License

[MIT](LICENSE) © [Niko Heikkilä](https://github.com/nikoheikkila)
