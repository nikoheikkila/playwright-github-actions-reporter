# playwright-github-actions-reporter

A [Playwright](https://playwright.dev) reporter that renders test results as a [GitHub Actions step summary](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/workflow-commands-for-github-actions#adding-a-job-summary) — rich Markdown/HTML surfaced directly on your workflow runs, no external services required.

[![CI](https://github.com/nikoheikkila/playwright-github-actions-reporter/actions/workflows/ci.yml/badge.svg)](https://github.com/nikoheikkila/playwright-github-actions-reporter/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@nikoheikkila/playwright-github-actions-reporter)](https://www.npmjs.com/package/@nikoheikkila/playwright-github-actions-reporter)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Overview

When your workflow runs, the reporter writes a formatted summary to the job page:

**Summary section** — high-level counts with status icons:

> 🎭 **Playwright Test Report**
>
> ### Summary
>
> - 📁 **1** test files total
> - 🧪 **4** test cases total
> - ✅ **1** tests passed
> - ❌ **1** tests failed
> - ⏰ **2** tests timed out
> - ⚠️ **1** tests skipped

**Details section** — collapsible table with per-test metadata:

| Test                                                     | Result      | Duration | Retries | Tags     |
|----------------------------------------------------------|-------------|----------|---------|----------|
| Reporter Verification » example.spec.ts » passing test   | ✅ Passed    | 0.0s     | None    | @pass    |
| Reporter Verification » example.spec.ts » failing test   | ❌ Failed    | 0.0s     | None    | @fail    |
| Reporter Verification » example.spec.ts » timed out test | ⏰ Timed out | 0.1s     | 1       | @timeOut |
| Reporter Verification » example.spec.ts » skipped test   | ⚠️ Skipped  | 0.0s     | None    | @skip    |

## Features

- Renders a collapsible HTML summary to GitHub job summary — visible on every workflow run
- Tracks all five Playwright test statuses: passed, failed, timed out, skipped, interrupted
- Shows hierarchical test titles (`Project » file » describe » test`) with full context
- Displays per-test duration (seconds, 1 decimal), retry count, and tags
- Emits structured log messages via `@actions/core` (`info`, `notice`, `debug`, `error`)
- Marks the workflow step as failed when any test fails, so you never silently pass a broken build
- Zero configuration — works out of the box in any GitHub Actions runner

## Requirements

| Dependency         | Version                            |
|--------------------|------------------------------------|
| `@playwright/test` | `^1.59.1` (peer dependency)        |
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

# Auto-fix lint issues
task format

# Run the full e2e suite and diff output against the snapshot
task verify summary=test-results/summary.md

# Full local pipeline: format → lint → test → verify → build
task test:all
```

### How it works

```
Playwright lifecycle events
        │
        ▼
  GitHubReporter
  ├── onBegin    → writes report heading; logs worker count
  ├── onTestEnd  → accumulates per-test result metadata
  ├── onEnd      → builds summary counts and details table
  └── onExit     → flushes summary to $GITHUB_STEP_SUMMARY
        │
        ▼
  @actions/core
  ├── summary.addHeading / addList / addTable → step summary
  └── setFailed / notice / info / error       → workflow logs
```

The reporter depends on the `Core` abstraction defined in `src/interface.ts` rather than `@actions/core` directly. This keeps the core logic testable with lightweight fakes and lets the production entry point (`index.ts`) wire in the real GitHub SDK.

### Project layout

```
index.ts                  # Production entry point (wires @actions/core)
src/
  reporter.ts             # GitHubReporter: implements Playwright's Reporter interface
  interface.ts            # Core / Summary / SummaryTableRow abstractions
test/
  reporter.test.ts        # Unit test suite (bun:test)
  fakes.ts                # FakeCore / FakeSummary for isolated testing
  stubs.ts                # Factory functions for Playwright fixture objects
e2e/
  example.spec.ts         # Intentional pass / fail / timeout / skip scenarios
  createStepSummary.ts    # Local-only globalSetup that creates $GITHUB_STEP_SUMMARY
  snapshots/
    summary.md            # Expected reporter output; diffed in `task verify`
```

### Snapshot testing

The `task verify` task runs the e2e suite with this reporter and diffs the produced summary against `e2e/snapshots/summary.md`. If your change intentionally alters the rendered output, update the snapshot in the same commit:

```bash
# Run e2e and overwrite the snapshot
task verify summary=e2e/snapshots/summary.md
```

## Contributing

1. Fork the repository and create a feature branch.
2. Run `task test:all` to verify everything passes locally.
3. Open a pull request — CI will run lint, unit tests, and the e2e snapshot check.

**Code style** is enforced by [Biome](https://biomejs.dev) via a pre-commit hook. Don't bypass hooks with `--no-verify`; if a hook fails, fix the underlying issue. Key rules:

- Tabs for indentation, double quotes, trailing commas, 120-character line width
- Strict TypeScript (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`, no `any`)
- `import type` / `export type` for type-only symbols
- No `Array.prototype.forEach` — use `for...of` or iterator chains instead
- `readonly` class fields where values are never reassigned

## License

[MIT](LICENSE) © [Niko Heikkilä](https://github.com/nikoheikkila)
