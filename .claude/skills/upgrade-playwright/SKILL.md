---
name: upgrade-playwright
description: Upgrade @playwright/test in this reporter and find reporter-API gaps the new version introduces. Use when asked to update Playwright, bump the peer dependency, or check what a new Playwright release means for this reporter.
---

# Upgrade Playwright

Follow these steps in order. Each one fixes a problem that came up during the 1.59 → 1.63 upgrade.

## 1. See what changed before touching anything

```bash
task playwright:diff version=<target>   # default: latest
```

This prints the full `types/testReporter.d.ts` diff, followed by the reporter-facing interfaces from `types/test.d.ts` (`FullConfig`, `FullProject`, `WorkerInfo`, `TestInfoError`, `*ReporterOptions`). The type definitions are the source of truth. Release notes summarise, and they sometimes put a feature under the wrong version.

Classify every addition by how much it matters to *a step-summary reporter*:

- **Adopt**: data that improves the summary or the annotations (step `subtitle`, `workerInfo` on `onError`, new `TestError` fields).
- **Parity**: options that Playwright's built-in `github` reporter gained (for example `omitTags`). Check `GitHubReporterOptions` in the target `test.d.ts`.
- **Not applicable**: test-selection hooks such as `preprocess` / `TestRun`, and `argv`. Name these explicitly in the plan so nobody implements them later.

## 2. Decide the peer range with the user

Raising the `peerDependencies` floor is a breaking change and needs `feat!:` plus a `BREAKING CHANGE:` footer. Release Please then cuts a new major. Ask the user whether to require the new minimum or to keep the old floor and feature-detect. Don't decide this yourself.

## 3. Install and pin

```bash
bun add -d @playwright/test@<exact>
```

Then update `peerDependencies["@playwright/test"]`. Keep the devDependency on an exact version so `bun.lock` pins the version that `task verify` runs against. Lockfile churn such as a dropped `fsevents` entry comes from upstream and is expected.

## 4. Fix the stubs, then type-check

New *required* `FullConfig` / `FullProject` / `WorkerInfo` fields break `test/stubs.ts`, and `bun test` won't tell you, because it doesn't type-check. Add the fields to the matching `createStubX` factory and run:

```bash
task typecheck
```

## 5. Verify rendered output is unchanged

```bash
task test:all
```

A plain upgrade must leave `test/__snapshots__/reporter.test.ts.snap` and `e2e/snapshots/summary.md` untouched. If either changes, stop and find out why before you continue.

## 6. Plan the adopted features one commit each

- One Conventional Commit per feature, each with its own unit tests, and snapshots regenerated in the same commit.
- Before implementing, re-read "Playwright semantics that shaped the code" and "Rendering to the step summary" in `AGENTS.md`.
- Update the Requirements table in `README.md` whenever the peer floor moves.
