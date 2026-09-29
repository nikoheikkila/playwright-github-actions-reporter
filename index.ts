import { access, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import { DefaultArtifactClient } from "@actions/artifact";
import * as coreModule from "@actions/core";
import type { AnnotationProperties, ArtifactFile, Core } from "./src/interface.ts";
import { GitHubReporter, type GitHubReporterOptions } from "./src/reporter.ts";

export type { GitHubReporterOptions };

function sharedPrefix(left: string[], right: string[]): string[] {
	const mismatch = left.findIndex((segment, index) => segment !== right[index]);
	return mismatch === -1 ? left : left.slice(0, mismatch);
}

function commonAncestorPath(paths: string[]): string {
	const directories = paths.map((path) => dirname(path).split(sep));
	const common = directories.reduce(sharedPrefix, directories[0] ?? ["."]).join(sep);
	return common === "" ? sep : common;
}

// Names are joined onto the staging directory, so anything that could escape it is rejected
function isSafeFileName(name: string): boolean {
	return name !== "" && !/[/\\]|\.\.|^[A-Za-z]:/.test(name);
}

function assertSafeFileNames(files: ArtifactFile[]): void {
	const unsafe = files.find((file) => !isSafeFileName(file.name));
	if (unsafe !== undefined) {
		throw new Error(`Invalid artifact file name: "${unsafe.name}"`);
	}
}

// Symlinks and directories could leak content outside the intended files; missing files are left to the upload client
async function assertRegularFiles(files: ArtifactFile[]): Promise<void> {
	for (const file of files) {
		const stats = await lstat(file.path).catch(() => undefined);
		if (stats !== undefined && !stats.isFile()) {
			throw new Error(`Invalid artifact file: "${file.name}" is not a regular file`);
		}
	}
}

async function filesExist(files: ArtifactFile[]): Promise<boolean> {
	for (const file of files) {
		try {
			await access(file.path);
		} catch {
			return false;
		}
	}
	return true;
}

async function stageFilesWithNames(files: ArtifactFile[], stagingDir: string): Promise<string[]> {
	const stagedPaths: string[] = [];
	for (const file of files) {
		const stagedPath = join(stagingDir, file.name);
		const content = await readFile(file.path);
		await writeFile(stagedPath, content);
		stagedPaths.push(stagedPath);
	}
	return stagedPaths;
}

async function cleanupStagingDir(stagingDir: string | undefined): Promise<void> {
	if (stagingDir === undefined) {
		return;
	}
	try {
		await rm(stagingDir, { recursive: true, force: true });
	} catch {
		// A leftover temp directory must not turn a successful upload into a failure
	}
}

async function performUpload(
	client: DefaultArtifactClient,
	name: string,
	filePaths: string[],
	rootDirectory: string,
): Promise<{ id?: number }> {
	const response = await client.uploadArtifact(name, filePaths, rootDirectory);
	if (response.id === undefined) {
		throw new Error("Artifact upload returned no ID");
	}
	coreModule.info(`Uploaded ${name} artifact: ID ${response.id}, ${filePaths.length} file(s)`);
	return response;
}

export function createUploadArtifactImpl(
	client: DefaultArtifactClient = new DefaultArtifactClient(),
): Core["uploadArtifact"] {
	return async (name: string, files: ArtifactFile[]) => {
		if (!(process.env.ACTIONS_RUNTIME_TOKEN && process.env.ACTIONS_RESULTS_URL)) {
			throw new Error(
				"Artifact upload skipped: the Actions runtime variables ACTIONS_RUNTIME_TOKEN and ACTIONS_RESULTS_URL are missing. GitHub exposes them only to `uses:` steps, not `run:` steps. See the `screenshots` option in the README for setup.",
			);
		}

		assertSafeFileNames(files);

		await assertRegularFiles(files);

		let stagingDir: string | undefined;
		try {
			let filePaths = files.map((f) => f.path);
			let rootDirectory = filePaths.length === 0 ? process.cwd() : commonAncestorPath(filePaths);

			const hasCustomNames = files.some((f) => f.name !== basename(f.path));
			if (hasCustomNames && (await filesExist(files))) {
				stagingDir = await mkdtemp(join(tmpdir(), "playwright-screenshots-"));
				filePaths = await stageFilesWithNames(files, stagingDir);
				rootDirectory = stagingDir;
			}

			return await performUpload(client, name, filePaths, rootDirectory);
		} finally {
			await cleanupStagingDir(stagingDir);
		}
	};
}

const core: Core = {
	summary: coreModule.summary,
	debug: (message: string) => coreModule.debug(message),
	isDebug: () => coreModule.isDebug(),
	info: (message: string) => coreModule.info(message),
	notice: (message: string, properties?: AnnotationProperties) => coreModule.notice(message, properties),
	warning: (message: string, properties?: AnnotationProperties) => coreModule.warning(message, properties),
	error: (message: string, properties?: AnnotationProperties) => coreModule.error(message, properties),
	setFailed: (message: string) => coreModule.setFailed(message),
	uploadArtifact: createUploadArtifactImpl(),
};

export default class Reporter extends GitHubReporter {
	constructor(options: GitHubReporterOptions = {}) {
		super(core, options);
	}
}
