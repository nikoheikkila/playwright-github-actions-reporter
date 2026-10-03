/**
 * Fails when AGENTS.md or README.md names a repository path that no longer exists.
 *
 * Usage: bun scripts/checkDocs.ts
 *
 * Refactors kept leaving the docs pointing at moved or deleted files, and only a review advisory caught it.
 * Only backticked paths under tracked directories are checked, so commands, globs and git-ignored output such as
 * `reports/mutation/` are left alone. A bare file name (`summary.test.ts`) passes when any tracked file has that name.
 */
import { stat } from "node:fs/promises";
import { $ } from "bun";

const documents = ["AGENTS.md", "README.md"];
const trackedDirectories = ["src/", "test/", "e2e/", "scripts/", ".github/", ".claude/", ".husky/"];
const bareFile = /^\w[\w.-]*\.(ts|mjs|json|ya?ml|md|snap)$/;

const trackedNames = new Set(
	(await $`git ls-files`.text())
		.split("\n")
		.filter((file) => file !== "")
		.map((file) => file.slice(file.lastIndexOf("/") + 1)),
);

const isCheckedPath = (token: string): boolean =>
	/^[\w./-]+$/.test(token) && trackedDirectories.some((directory) => token.startsWith(directory));

const exists = async (path: string): Promise<boolean> =>
	stat(path)
		.then(() => true)
		.catch(() => false);

const isStale = async (path: string): Promise<boolean> => {
	if (bareFile.test(path)) {
		return !trackedNames.has(path);
	}
	return isCheckedPath(path) && !(await exists(path));
};

const missing = new Set<string>();

for (const document of documents) {
	const text = await Bun.file(document).text();
	for (const [, token = ""] of text.matchAll(/`([^`\n]+)`/g)) {
		if (await isStale(token.replace(/(:\d+(-\d+)?|#[\w-]+)$/, ""))) {
			missing.add(`${document}: \`${token}\``);
		}
	}
}

if (missing.size > 0) {
	console.error(`These paths in the docs do not exist:\n${[...missing].join("\n")}`);
	process.exit(1);
}

console.log(`Every path named in ${documents.join(" and ")} exists.`);
