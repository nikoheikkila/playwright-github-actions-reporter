/**
 * Diffs the reporter-facing Playwright type definitions between the installed version and a target version.
 *
 * Usage: bun scripts/diffPlaywrightTypes.ts [version]   (defaults to "latest")
 *
 * Prints a unified diff of `types/testReporter.d.ts` in full, followed by the reporter-facing
 * interfaces of `types/test.d.ts` (`FullConfig`, `FullProject`, `WorkerInfo`, `TestInfoError`)
 * and the built-in `*ReporterOptions` types. Nothing in the project is modified.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

interface RegistryVersion {
	version: string;
	dist: { tarball: string };
}

const reporterFacingInterfaces = ["FullConfig", "FullProject", "WorkerInfo", "TestInfoError"];

const target = Bun.argv[2] ?? "latest";
const installedTypes = join("node_modules", "playwright", "types");
const { version: installedVersion } = await Bun.file(join("node_modules", "playwright", "package.json")).json();

const response = await fetch(`https://registry.npmjs.org/playwright/${target}`);
if (!response.ok) {
	throw new Error(`Cannot resolve playwright@${target}: HTTP ${response.status}`);
}
const { version: targetVersion, dist } = (await response.json()) as RegistryVersion;

const reporterFacing = (source: string): string => {
	const interfaces = reporterFacingInterfaces.map(
		(name) => source.match(new RegExp(`^export interface ${name}\\b[^{]*\\{[\\s\\S]*?^\\}`, "m"))?.[0] ?? "",
	);
	const reporterOptions = source.match(/^export type \w+ReporterOptions = .*$/gm) ?? [];

	return [...interfaces, ...reporterOptions].join("\n\n");
};

const workdir = await mkdtemp(join(tmpdir(), "playwright-types-"));

try {
	const tarball = join(workdir, "playwright.tgz");
	await Bun.write(tarball, await fetch(dist.tarball));
	await $`tar -xzf ${tarball} -C ${workdir} package/types`.quiet();
	const targetTypes = join(workdir, "package", "types");

	console.log(`# playwright ${installedVersion} → ${targetVersion}\n`);
	console.log("## types/testReporter.d.ts\n");
	await $`diff -u ${join(installedTypes, "testReporter.d.ts")} ${join(targetTypes, "testReporter.d.ts")}`.nothrow();

	const installedExtract = join(workdir, `test.d.ts@${installedVersion}`);
	const targetExtract = join(workdir, `test.d.ts@${targetVersion}`);
	await Bun.write(installedExtract, reporterFacing(await Bun.file(join(installedTypes, "test.d.ts")).text()));
	await Bun.write(targetExtract, reporterFacing(await Bun.file(join(targetTypes, "test.d.ts")).text()));

	console.log(`\n## types/test.d.ts (${[...reporterFacingInterfaces, "*ReporterOptions"].join(", ")})\n`);
	await $`diff -u ${installedExtract} ${targetExtract}`.nothrow();
} finally {
	await rm(workdir, { recursive: true, force: true });
}
