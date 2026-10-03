# Instructions for Coding Agents

> **NOTE:**`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md`.

## Project Overview

This project is a custom Playwright reporter that renders the run as a GitHub Actions step summary
(Markdown / HTML rendered by GitHub) via `@actions/core`.

## Structure

- `index.ts` — default-exported `Reporter` that wires the real `@actions/core` into `GitHubReporter` for production use.
- `src/reporter.ts` — `GitHubReporter` class implementing Reporter interface, plus the exported `GitHubReporterOptions` (`omitTags`, `title`) that `index.ts` re-exports.
- `src/html.ts` — the escaping helpers `escapeHtml`, `inlineHtml`, `preformattedHtml` and `attributeEscape`.
- `src/outcome.ts` — `counts` (every test in exactly one bucket), status labels, titles, durations, the precomputed per-test row values (`storedResult`) and the `tableColumns` descriptor list that drives the Details table.
- `src/testCase.ts` — plain-function local extension for Playwright's `TestCase`: `lastResult(test)` (the last result or `undefined`), `countedOutcome(test)` (`test.outcome()`, with `"interrupted"` for `skipped` tests whose last result was interrupted), `finishedTests(tests)` (a generator of `{ test, result }` for tests that have a last result) and the `Outcome` / `CountedOutcome` types.
- `src/failure.ts` — error message extraction with fallbacks, error titles, the failing-step chain and the failure details HTML.
- `src/attachments.ts` — attachment kinds (screenshots, videos), the artifact URL, the file naming for the uploads and `uploadAttachments(core, kinds, tests)`, which uploads each enabled kind through `core.uploadArtifact`, logs an "Uploaded" line via `core.info` per successful upload, warns once when an upload throws and returns the links by label.
- `src/artifact.ts` — `createArtifactUploader`, the production `core.uploadArtifact`: checks the runtime variables, file names and file types, stages renamed files in a temp directory and uploads them with `@actions/artifact` (used for both screenshots and videos). `src/filenames.ts` holds the file name and path helpers it uses.
- `src/interface.ts` — minimal `Core` / `Summary` / `SummaryTableRow` / `AnnotationProperties` types mirroring the subset of `@actions/core` we use. Production code depends on these abstractions, not on `@actions/core` directly, so tests can substitute fakes.
- `test/` — `bun:test` unit tests with `FakeCore` / `FakeSummary` (`test/fakes.ts`) and `createStubX` factories for Playwright fixtures (`test/stubs.ts`). There are two kinds of suite. **Module suites** are named after a `src/` module and test its exported functions directly (`outcome.test.ts`, `failure.test.ts`, `testCase.test.ts`, `filenames.test.ts`, `tableColumns.test.ts`, `uploadAttachments.test.ts`). **Reporter suites** are named after a section of the summary and drive the whole `GitHubReporter` (`summary*.test.ts`, `details*.test.ts`, `failures.test.ts`, `attachments*.test.ts`, `annotations.test.ts`, `errors.test.ts`, `logging.test.ts`, `options.test.ts`, `lifecycle.test.ts`). `artifact.test.ts` covers `createArtifactUploader` and its wiring into the reporter. `reporter.test.ts` holds only the Full Report Snapshot. Run `ls test/` for the current list rather than trusting this one. `test/harness.ts` holds the shared `count` and `createRunners`, next to `test/helpers.ts` and `test/env.ts`.
- `e2e/` — Playwright suite (`example.spec.ts`) that intentionally contains passing / expected-failure / timing-out / flaky / failing-step / skipped tests; the rendered summary is diffed against `e2e/snapshots/summary.md`.
- `scripts/diffPlaywrightTypes.ts` — diffs the reporter-facing Playwright type definitions against another version (`task playwright:diff`).
- `scripts/strykerDiff.ts` — mutates only the production files changed since a base ref (`task mutation:diff`). `stryker.config.mjs` holds the Stryker setup.
- `scripts/checkDocs.ts` — fails when `AGENTS.md` or `README.md` names a file that doesn't exist (`task docs:check`, part of `task check`).
- `.claude/settings.json` — Claude Code hooks: Biome after every edit, and the check pipeline when a turn ends.

### Reporter lifecycle

- `onBegin` captures `suite.allTests()`, `config.failOnFlakyTests` and the workspace root (`GITHUB_WORKSPACE ?? process.cwd()`), and adds the heading (custom `title`, plus ` (shard x/y)` when `config.shard` is set).
- `onTestEnd` stores one precomputed row per `test.id`, so a retry overwrites the earlier row. `onError` records errors outside tests instead of throwing.
- `onEnd` is async and does everything else in this order: the `notice` line, inline annotations, the counts list, the collapsible Details table, then (only if a test is `unexpected`) `uploadAttachments` from `src/attachments.ts`, which calls `core.uploadArtifact` for the screenshot upload (only with the `screenshots` option and at least one PNG attachment) and the video upload (only with the `videos` option and at least one `video/webm` attachment) followed by the Failures section, the "Errors outside tests" section (only if `onError` fired), then `core.setFailed` at most once. The upload is awaited before the Failures section so one artifact link per attachment kind (Screenshots, Videos) can be rendered under the heading.
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

- Put every piece of test-controlled text (titles, tags, step titles/subtitles, project names, error messages, snippets) through the helpers in `src/html.ts`. Use `inlineHtml` for single-line contexts: it escapes HTML and collapses line breaks into one space. Use `preformattedHtml` for `<pre>` blocks: it escapes HTML and encodes line breaks as `&#10;`.
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
- `task mutation` — Stryker mutation run over `src/` (Bun runner with per-test coverage, TypeScript checker). HTML and JSON reports land in `reports/mutation/`, which is git-ignored. `task mutation:incremental` reuses earlier results; `task mutation:diff base=<ref>` mutates only the production files changed since `<ref>` and needs a clean working tree.
- `task docs:check` — fail when a backticked file path in `AGENTS.md` or `README.md` no longer exists. Bare names such as `summary.test.ts` pass when any tracked file has that name.
- `task check` — the read-only pipeline: lint → typecheck → docs:check → test → verify → build. The Stop hook runs this.
- `task test:all` — `format`, then `check` (full local pipeline)

Ad-hoc variants:

- Always run Bun tests with `--parallel` and `AGENT=1` set in the environment (`task test` does both). Ad-hoc `bun test` calls must too.
- Single test file: `AGENT=1 bun test --parallel test/failures.test.ts`. Single test by name: `AGENT=1 bun test --parallel -t "<name pattern>"`.
- Update the `bun:test` snapshot (`test/__snapshots__/reporter.test.ts.snap`): `AGENT=1 bun test --parallel --update-snapshots`.
- Regenerate the e2e snapshot: `task verify summary=e2e/snapshots/summary.md`.
- Judge a run by its exit code, not by its tail. `task verify | tail` reports the exit code of `tail`, and an empty diff tail also looks like a pass. Use `task verify > /tmp/verify.log 2>&1; echo "exit=$?"; tail -n 20 /tmp/verify.log`.
- If Task prints `task "<name>" is up to date`, the task did **not** run. Re-run it with `task --force <name>` before you call it green.

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
- File size: keep source and test modules under 300 lines where possible. When a file grows past that, split it by responsibility (as `src/html.ts` was extracted from `src/reporter.ts`, and the tests were split by topic). Don't make a file larger, and split one when you are already changing it.
- TypeScript (`tsconfig.json`) is strict with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`. Internal imports must include the `.ts` extension (e.g. `from "./reporter.ts"`) — required by `allowImportingTsExtensions`.
- Use `import type` / `export type` for type-only symbols (`useImportType`, `useExportType`).
- No `any` (`noExplicitAny`), no non-null assertions (`noNonNullAssertion`), no implicit-boolean coercion in conditionals (`noImplicitBoolean` — use explicit `> 0`, `!== undefined`, or `!!x` as in `playwright.config.ts`).
- No `Array.prototype.forEach` (`noForEach`) — use `for...of` or iterator chains; see `collectDetailedResults` in `src/reporter.ts`.
- Class fields should be `readonly` where they aren't reassigned (`useReadonlyClassProperties`).
- No import cycles (`noImportCycles`).
- Naming follows Biome defaults: `camelCase` for variables/methods/properties, `PascalCase` for classes/types/interfaces. Don't introduce `SCREAMING_SNAKE_CASE` constants, and don't add a trailing or leading underscore to dodge a name clash (`test_`, `_result`). Biome doesn't catch these, but review does. Choose a descriptive name instead (`testCase`).
- Don't add a constant that only re-assigns another binding (`export const outcome = countedOutcome`). When you move or rename something, migrate the callers.
- Prefer plain types and named interfaces over stacked utility types (`Omit<Partial<T>, "x"> & { x?: never }`). If a type needs a guard, first try changing the code: the spread order, or a narrower parameter.

## Testing

- Unit tests run via `task test` and live under `test/` (configured in `bunfig.toml`: `root = "test"`, coverage excludes test files themselves).
- Use `bun:test` primitives (`describe`, `test`, `beforeEach`, `expect`, `test.each`). Don't import Jest or Vitest.
- Reuse `FakeCore` / `FakeSummary` for the reporter under test. `FakeCore` records annotations together with their properties. Like the real `@actions/core`, `FakeCore.setFailed` does not throw. It sets `isFailed = true` and records the message in `core.failures`. Unlike the real one, it does not also emit an error annotation, so `core.errors` holds only annotations the reporter raised itself. Extend the `createStubX` factories in `test/stubs.ts` (`Config`, `Project`, `WorkerInfo`, `Suite`, `TestCase`, `TestResult`, `TestStep`, `TestError`, `FullResult`) rather than hand-rolling Playwright objects inline.
- Tests that depend on `GITHUB_WORKSPACE` or the Actions runtime variables must set and restore them. Use `preserveEnv(...keys)` from `test/env.ts` inside a `describe` (it snapshots the values when called and registers an `afterEach`), and use `setRunEnvironment` for the run variables.
- Bun keys snapshots by the full `describe` / `test` name path. Keep the "Playwright GitHub Actions Reporter" › "Full Report Snapshot" names when moving tests between files, or `test/__snapshots__/reporter.test.ts.snap` is rewritten.
- Don't write tests for code that only runs in tests (`test/env.ts`, `test/helpers.ts`, `test/harness.ts`, `test/stubs.ts`, `test/fakes.ts`). The suites that use them cover them.
- No unit test imports `index.ts`. Its wiring of `@actions/core` is covered only by `task typecheck` and `task verify`, so run both after you touch it.
- Cover the fallback branches as well as the happy path. An error annotation that read "✅ Passed" got through 62 green tests because every failing fixture had a populated `errors` array.
- For end-to-end coverage, `task verify summary=test-results/summary.md` runs the Playwright suite with this reporter and `diff`s the produced summary against `e2e/snapshots/summary.md`. If your change intentionally alters the rendered output, update the snapshot in the same commit. After regenerating it, run `task verify summary=test-results/summary.md` again to confirm the output is deterministic.
- Locally (no `CI` env var) the Playwright config wires `e2e/createStepSummary.ts` as `globalSetup` to create the summary file at `$GITHUB_STEP_SUMMARY`. In CI, GitHub Actions provides that variable natively, so `globalSetup` is skipped.
- `task verify` deletes the Screenshots and Videos link lines before diffing, because they hold run and artifact ids. A green verify doesn't prove a link renders. The CI step "Verify screenshot and video artifacts were uploaded" checks the upload, and only a real Actions run can show the link.

### Mutation testing

`src/` is at a 100% mutation score (363 mutants killed). Keep it there: after changing production code, run `task mutation:incremental`, or `task mutation:diff` once the work is committed, and kill or classify every survivor before you open the PR.

- The runner is the community `@hughescr/stryker-bun-runner`, the only Bun option. It and `@stryker-mutator/*` are pinned to exact versions. Upgrade them together and smoke-run one file first: `bunx stryker run --mutate src/html.ts`.
- `AGENT=1` is deliberately not set for Stryker. The runner reads results over the inspector protocol, not from the test output.
- `CompileError` mutants are ones the TypeScript checker rejected. They are not survivors, so ignore them in the score.
- Mark an equivalent mutant with `// Stryker disable next-line <Mutator>: <why no input can tell the difference>` on the line directly above it, naming the single mutator (see `src/reporter.ts` and `src/artifact.ts`). A bare `disable next-line` or a block-level disable also hides real mutants on the same line.
- Read survivors from `reports/mutation/mutation.json` or the HTML report. Don't re-run Stryker just to see its output again.

## Changing the reporter: minimum context

Almost every change to `src/reporter.ts` touches the same set of files. Load all of them up front, including when you hand work to a subagent:

- `src/reporter.ts`, `src/html.ts` (if escaping changes), `src/outcome.ts` / `src/failure.ts` / `src/attachments.ts` (if counts, failure details or attachments change), `src/interface.ts` (if the `Core`/`Summary` surface changes), `index.ts` (if constructor or exports change)
- the module suite named after each `src/` file you change, plus the reporter suites for the summary sections it renders (`grep -l <symbol> test/*.test.ts` finds them), plus `test/harness.ts`, `test/helpers.ts`, `test/env.ts`, `test/fakes.ts`, `test/stubs.ts`
- `test/__snapshots__/reporter.test.ts.snap` and `e2e/snapshots/summary.md`: any rendering change moves one or both
- `e2e/example.spec.ts` when the change needs a real Playwright scenario
- `README.md` (Overview / Features / options / Project layout) and the "Structure" and "Reporter lifecycle" sections above when behaviour or file layout changes

Before you commit, run the review gate on the **staged** diff. Only the coordinating agent commits, after the gate passes. An implementation agent that commits on its own skips the gate.

## Working on an issue

Issues here are written ahead of time and go stale quickly. Earlier fixes often do part of the work, and line numbers and commit hashes drift.

1. **Check the issue against `HEAD` before planning.** For each item, `grep` the named symbol (ignore line numbers) and run `git log --oneline --grep "#<n>"`. Report items that are already done, with the commit that did them, instead of re-implementing them. If the issue depends on another open issue, say which one and keep to this issue's scope.
2. **Standing answers.** The orchestrator asked the same questions in every session, and the user gave the same answers each time. Apply these without asking:
   - A behaviour-preserving refactor has no Red step. The existing suite and the 100% mutation score are the safety net. If the refactor touches code no test exercises, first add a test that pins the current behaviour.
   - A bug you find along the way is in scope, but fix it in its own commit.
   - Run any project command (`task test:all`, `task verify`, `task mutation`) without asking.
   - Accept the recommended default for anything else that has one. List the defaults you applied in the hand-off.
3. **Sweep the docs.** After renaming, moving or deleting a symbol or file, `grep -n` the old name in `AGENTS.md` and `README.md`, then run `task docs:check`. Stale docs were the most common review advisory.
4. **Fix the cheap advisories before committing.** The review gate passes with advisory findings. Fix doc drift, dead code and missing tests for stated behaviour in the same change, then re-run the gate in delta mode. Put the rest in the PR description or a new issue.
5. **Commit.** Once the gate passes, commit without asking, using a Conventional Commit message, with `Fixes #<n>` in the body and the exact `Co-Authored-By` trailer from the system prompt. The user pushes, unless they ask you to.

To upgrade Playwright, follow the `upgrade-playwright` skill in `.claude/skills/`.

## Pre-commit and CI

- `.husky/pre-commit` runs `bunx lint-staged` (Biome write on staged JS/TS/JSON) followed by `task test`. Don't bypass with `--no-verify`; if a hook fails, fix the underlying issue.
- `.github/workflows/ci.yml` runs `task lint`, `task typecheck`, `task docs:check`, `task test`, then `task verify` against the runner-provided `$GITHUB_STEP_SUMMARY`. A parallel `mutation` job runs `task mutation` and uploads `reports/mutation/` as the `mutation-report` artifact. It has no score threshold yet, so it fails only when Stryker itself fails. Release Please waits for both jobs. Keep these green before opening a PR.
- A green `task verify` step still shows `::error` and `::warning` annotations (timed out test, failing step test, flaky test). The e2e suite produces them on purpose. They are not failures.
- To watch a run after a push, the run may take a few seconds to register. Find it with `gh run list --commit "$(git rev-parse HEAD)" --json databaseId --jq '.[0].databaseId'` in a Monitor until-loop, then follow it with `gh run watch <id> --exit-status` as a background command. Foreground `sleep` is blocked.
- Claude Code hooks (`.claude/settings.json`): after each Edit or Write, Biome checks the edited file, and a failure is fed back to the agent. When a turn ends with a dirty working tree, `task check` runs. A Stop-hook failure while a TDD subagent is still mid-cycle (a Red test, a half-written stub) is expected. Don't fix it from the coordinating agent; wait for the cycle to finish.
- Releases come from Release Please: on pushes to `main`, it opens or updates a release PR based on Conventional Commit messages (`feat:`, `fix:`, `chore:`, `docs:` …). Merging that PR tags the release and runs `npm publish --provenance`. Use Conventional Commit messages. Don't bump `version` in `package.json` or edit `CHANGELOG.md` by hand.
