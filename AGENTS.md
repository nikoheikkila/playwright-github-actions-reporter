# Instructions for Coding Agents

> **NOTE:**`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md`.

## Project Overview

This project is a custom Playwright reporter that renders the run as a GitHub Actions step summary
(Markdown / HTML rendered by GitHub) via `@actions/core`.

## Structure

- `index.ts` — default-exported `Reporter` that wires the real `@actions/core` into `GitHubReporter` for production use.
- `src/reporter.ts` — `GitHubReporter` class implementing Reporter interface.
- `src/interface.ts` — minimal `Core` / `Summary` / `SummaryTableRow` types. Production code depends on these abstractions, not on `@actions/core` directly, so tests can substitute fakes.
- `test/` — `bun:test` unit tests with `FakeCore` / `FakeSummary` (`test/fakes.ts`) and `createStubX` factories for Playwright fixtures (`test/stubs.ts`).
- `e2e/` — Playwright suite (`example.spec.ts`) that intentionally contains passing / failing / timing-out / skipped tests; the rendered summary is diffed against `e2e/snapshots/summary.md`.

## Commands

Run everything through Task — these are what CI runs.

- `task install` — frozen-lockfile `bun install`
- `task lint` — Lint codebase with Biome
- `task format` — Format codebase with Biome
- `task test` — Run unit tests with coverage
- `task test:watch` — Run unit tests using an interactive watcher
- `task verify summary=<path>` — Playwright run + `diff` against `e2e/snapshots/summary.md`
- `task test:all` — format → lint → test → verify (full local pipeline)

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
- Reuse `FakeCore` / `FakeSummary` for the reporter under test, and extend the `createStubConfig` / `createStubSuite` / `createStubTestCase` / `createStubTestResult` factories rather than hand-rolling Playwright objects inline.
- For end-to-end coverage, `task verify summary=test-results/summary.md` runs the Playwright suite with this reporter and `diff`s the produced summary against `e2e/snapshots/summary.md`. If your change intentionally alters the rendered output, update the snapshot in the same commit.
- Locally (no `CI` env var) the Playwright config wires `e2e/createStepSummary.ts` as `globalSetup` to create the summary file at `$GITHUB_STEP_SUMMARY`. In CI, GitHub Actions provides that variable natively, so `globalSetup` is skipped.

## Pre-commit and CI

- `.husky/pre-commit` runs `bunx lint-staged` (Biome write on staged JS/TS/JSON) followed by `task test`. Don't bypass with `--no-verify`; if a hook fails, fix the underlying issue.
- `.github/workflows/ci.yml` runs `task lint`, `task test`, then `task verify` against the runner-provided `$GITHUB_STEP_SUMMARY`. Keep these green before opening a PR.
