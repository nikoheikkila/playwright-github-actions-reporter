# Instructions for Coding Agents

> **NOTE:**`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md`.

## Project Overview

This project is a custom Playwright reporter that renders the run as a GitHub Actions step summary
(Markdown / HTML rendered by GitHub) via `@actions/core`.

## Structure

- `index.ts` — default-exported `Reporter` that wires the real `@actions/core` into `GitHubReporter` for production use.
- `src/reporter.ts` — `GitHubReporter` class implementing Reporter interface, plus the exported `GitHubReporterOptions` (`omitTags`, `title`) that `index.ts` re-exports.
- `src/interface.ts` — minimal `Core` / `Summary` / `SummaryTableRow` / `AnnotationProperties` types mirroring the subset of `@actions/core` we use. Production code depends on these abstractions, not on `@actions/core` directly, so tests can substitute fakes.
- `test/` — `bun:test` unit tests with `FakeCore` / `FakeSummary` (`test/fakes.ts`) and `createStubX` factories for Playwright fixtures (`test/stubs.ts`).
- `e2e/` — Playwright suite (`example.spec.ts`) that intentionally contains passing / expected-failure / timing-out / flaky / failing-step / skipped tests; the rendered summary is diffed against `e2e/snapshots/summary.md`.
- `scripts/diffPlaywrightTypes.ts` — diffs the reporter-facing Playwright type definitions against another version (`task playwright:diff`).

### Reporter lifecycle

- `onBegin` captures `suite.allTests()`, `config.failOnFlakyTests` and the workspace root (`GITHUB_WORKSPACE ?? process.cwd()`), and adds the heading (custom `title`, plus ` (shard x/y)` when `config.shard` is set).
- `onTestEnd` stores one precomputed row per `test.id`, so a retry overwrites the earlier row. `onError` records errors outside tests instead of throwing.
- `onEnd` does everything else in this order: the `notice` line, inline annotations, the counts list, the collapsible Details table, the Failures section (only if a test is `unexpected`), the "Errors outside tests" section (only if `onError` fired), then `core.setFailed` at most once.
- The summary is written to `$GITHUB_STEP_SUMMARY` only in `onExit` (`summary.write()`).
- Counts come from `outcome()` of every test in `suite.allTests()`: `passed` (expected, including tests that fail as expected), `failed` (unexpected), `flaky`, `skipped` (including tests that never ran), and `interrupted` (a `skipped` outcome whose last result is `interrupted`; shown only when above zero). Every test lands in exactly one bucket, so the counts add up to the total.
- Annotations are emitted in `onEnd`, never `onTestEnd`, so a failure that later passes on retry becomes a flaky warning rather than an error. Unexpected tests get one `core.error` per entry in the last result's `errors`, at the error's location or `test.location`. File paths are relative to the workspace root.

### Playwright semantics that shaped the code

These aren't obvious from the docs, and each one caused a bug or a review block while building the reporter:

- `test.outcome()` returns `"skipped"` for interrupted tests. Check the last result's `status` to tell them apart.
- `test.fail()` sets `expectedStatus` to `"failed"`, never `"timedOut"`. A `test.fail()` test that times out is **unexpected**, and "timed out as expected" can't happen.
- When a `test.fail()` test passes, its `result.errors` is **empty**. Playwright's own formatter makes up "Expected to fail, but passed." (see `node_modules/playwright/lib/runner/index.js`). Any code that renders errors needs a fallback for an empty list, and for a `TestError` that has neither `message` nor `value`.
- `FullConfig` gains *required* fields in minor releases (1.61 added `argv` and `failOnFlakyTests`). `createStubConfig` then stops type-checking, and only `task typecheck` catches it, because `bun test` doesn't type-check.
- The reporter API reference that matches the installed version is `node_modules/playwright/types/testReporter.d.ts`. It's more reliable than the release notes. Use `task playwright:diff version=<x>` to see what a new version changes.

### Rendering to the step summary

GitHub renders the summary as GFM with embedded HTML, and none of the `@actions/core` `Summary` methods escape their input:

- Put every piece of test-controlled text (titles, tags, step titles/subtitles, project names, error messages, snippets) through the helpers in `src/reporter.ts`. Use `inlineHtml` for single-line contexts: it escapes HTML and collapses line breaks into one space. Use `preformattedHtml` for `<pre>` blocks: it escapes HTML and encodes line breaks as `&#10;`.
- **A blank line ends a GFM HTML block.** A raw newline inside `<details>` / `<pre>` can break the collapsible and leak the rest as Markdown. That's why `<pre>` content encodes `\r\n`, `\r` and `\n` as `&#10;`.
- Never render `error.stack`. It contains absolute paths, which make `e2e/snapshots/summary.md` differ from machine to machine. Messages and snippets are deterministic.
- GitHub shows at most 10 error and 10 warning annotations per step. The summary is the complete record, so every failure must still appear there.

## Commands

Run everything through Task — these are what CI runs.

- `task install` — frozen-lockfile `bun install`
- `task lint` — Lint codebase with Biome
- `task format` — Format codebase with Biome
- `task typecheck` — `tsc --noEmit` over every TypeScript file. Required because `bun test` strips types without checking them.
- `task test` — Run unit tests with coverage
- `task test:watch` — Run unit tests using an interactive watcher
- `task verify summary=<path>` — Playwright run + `diff` against `e2e/snapshots/summary.md`. The Playwright step has `ignore_error: true` because the e2e suite fails on purpose, so only the `diff` sets the exit code.
- `task build` — `bun build` bundles `index.ts` into `dist/` (with `@actions/core` and `@playwright/test` kept external), then `tsc -p tsconfig.build.json` emits only the `.d.ts` files. `prepublishOnly` runs this.
- `task playwright:diff version=<x>` — diff the reporter-facing types of the installed Playwright against version `<x>` (default `latest`). Read-only, nothing is installed.
- `task test:all` — format → lint → typecheck → test → verify → build (full local pipeline)

Ad-hoc variants:

- Single test file: `bun test test/reporter.test.ts`. Single test by name: `bun test -t "<name pattern>"`.
- Update the `bun:test` snapshot (`test/__snapshots__/reporter.test.ts.snap`): `bun test --update-snapshots`.
- Regenerate the e2e snapshot: `task verify summary=e2e/snapshots/summary.md`.

## Bun

Default to Bun. Never reach for Node-only tooling when a Bun equivalent exists.

- `bun <file>` instead of `node <file>` or `ts-node <file>`
- `bun test` instead of `jest` or `vitest`
- `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- `bun install` (or `task install`) instead of `npm`/`yarn`/`pnpm install`
- `bun run <script>` instead of `npm run` / `yarn run` / `pnpm run`
- `bunx <package> <command>` instead of `npx <package> <command>`
- Bun loads `.env` automatically — don't use `dotenv`.

### Bun APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s `readFile` / `writeFile`.
- `Bun.$`ls`` instead of `execa`.

For deeper detail, read `node_modules/bun-types/docs/**.mdx`.

## Code style

Biome (`biome.json`) is strict and enforced via `task lint` and the lint-staged pre-commit hook. Don't disable rules to silence an error — fix the code.

- Formatting: tabs, double quotes, trailing commas, semicolons, line width 120.
- TypeScript (`tsconfig.json`) is strict with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`. Internal imports must include the `.ts` extension (e.g. `from "./reporter.ts"`) — required by `allowImportingTsExtensions`.
- Use `import type` / `export type` for type-only symbols (`useImportType`, `useExportType`).
- No `any` (`noExplicitAny`), no non-null assertions (`noNonNullAssertion`), no implicit-boolean coercion in conditionals (`noImplicitBoolean` — use explicit `> 0`, `!== undefined`, or `!!x` as in `playwright.config.ts`).
- No `Array.prototype.forEach` (`noForEach`) — use `for...of` or iterator chains; see the `dataRows` getter in `src/reporter.ts`.
- Class fields should be `readonly` where they aren't reassigned (`useReadonlyClassProperties`).
- No import cycles (`noImportCycles`).
- Naming follows Biome defaults: `camelCase` for variables/methods/properties, `PascalCase` for classes/types/interfaces. Don't introduce `SCREAMING_SNAKE_CASE` constants.

## Testing

- Unit tests run via `task test` and live under `test/` (configured in `bunfig.toml`: `root = "test"`, coverage excludes test files themselves).
- Use `bun:test` primitives (`describe`, `test`, `beforeEach`, `expect`, `test.each`). Don't import Jest or Vitest.
- Reuse `FakeCore` / `FakeSummary` for the reporter under test. `FakeCore` records annotations together with their properties. Extend the `createStubX` factories in `test/stubs.ts` (`Config`, `Project`, `WorkerInfo`, `Suite`, `TestCase`, `TestResult`, `TestStep`, `TestError`, `FullResult`) rather than hand-rolling Playwright objects inline.
- Tests that depend on `GITHUB_WORKSPACE` must set it and restore it themselves.
- Cover the fallback branches as well as the happy path. An error annotation that read "✅ Passed" got through 62 green tests because every failing fixture had a populated `errors` array.
- For end-to-end coverage, `task verify summary=test-results/summary.md` runs the Playwright suite with this reporter and `diff`s the produced summary against `e2e/snapshots/summary.md`. If your change intentionally alters the rendered output, update the snapshot in the same commit. After regenerating it, run `task verify summary=test-results/summary.md` again to confirm the output is deterministic.
- Locally (no `CI` env var) the Playwright config wires `e2e/createStepSummary.ts` as `globalSetup` to create the summary file at `$GITHUB_STEP_SUMMARY`. In CI, GitHub Actions provides that variable natively, so `globalSetup` is skipped.

## Changing the reporter: minimum context

Almost every change to `src/reporter.ts` touches the same set of files. Load all of them up front, including when you hand work to a subagent:

- `src/reporter.ts`, `src/interface.ts` (if the `Core`/`Summary` surface changes), `index.ts` (if constructor or exports change)
- `test/reporter.test.ts`, `test/fakes.ts`, `test/stubs.ts`
- `test/__snapshots__/reporter.test.ts.snap` and `e2e/snapshots/summary.md`: any rendering change moves one or both
- `e2e/example.spec.ts` when the change needs a real Playwright scenario
- `README.md` (Overview / Features / options) and the "Reporter lifecycle" section above when behaviour changes

Before you commit, run the review gate on the **staged** diff. Only the coordinating agent commits, after the gate passes. An implementation agent that commits on its own skips the gate.

To upgrade Playwright, follow the `upgrade-playwright` skill in `.claude/skills/`.

## Pre-commit and CI

- `.husky/pre-commit` runs `bunx lint-staged` (Biome write on staged JS/TS/JSON) followed by `task test`. Don't bypass with `--no-verify`; if a hook fails, fix the underlying issue.
- `.github/workflows/ci.yml` runs `task lint`, `task typecheck`, `task test`, then `task verify` against the runner-provided `$GITHUB_STEP_SUMMARY`. Keep these green before opening a PR.
- Releases come from Release Please: on pushes to `main`, it opens or updates a release PR based on Conventional Commit messages (`feat:`, `fix:`, `chore:`, `docs:` …). Merging that PR tags the release and runs `npm publish --provenance`. Use Conventional Commit messages. Don't bump `version` in `package.json` or edit `CHANGELOG.md` by hand.
