/**
 * Runs Stryker against the production files changed on this branch.
 *
 * Usage: bun scripts/strykerDiff.ts [base]   (defaults to the remote's default branch, or "main")
 *
 * Only committed changes (`<base>...HEAD`) are mutated, so the working tree must be clean.
 */
import { $ } from "bun";

const productionFile = (path: string): boolean =>
	path.startsWith("src/") && path.endsWith(".ts") && !path.endsWith(".d.ts") && path !== "src/interface.ts";

const defaultBase = async (): Promise<string> => {
	const remoteHead = await $`git symbolic-ref --quiet --short refs/remotes/origin/HEAD`.nothrow().quiet().text();
	return remoteHead.trim() === "" ? "main" : remoteHead.trim();
};

const base = Bun.argv[2] ?? (await defaultBase());

const status = await $`git status --porcelain`.text();
if (status !== "") {
	console.error(
		`The working tree has uncommitted changes. ${base}...HEAD covers committed work only, so commit or stash first.`,
	);
	process.exit(1);
}

const changed = await $`git diff --name-only -z --diff-filter=ACMRTUXB ${`${base}...HEAD`}`.text();
const files = changed.split("\0").filter(productionFile);

if (files.length === 0) {
	console.log(`No production files changed since ${base}. Nothing to mutate.`);
	process.exit(0);
}

const withComma = files.find((file) => file.includes(","));
if (withComma !== undefined) {
	console.error(`Cannot mutate "${withComma}": Stryker's --mutate option is comma-separated.`);
	process.exit(1);
}

console.log(`Mutating ${files.length} file(s) changed since ${base}:\n${files.join("\n")}`);

const stryker = Bun.spawn(["node_modules/.bin/stryker", "run", "--mutate", files.join(",")], {
	stdio: ["inherit", "inherit", "inherit"],
});
process.exit(await stryker.exited);
