import { access, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DefaultArtifactClient } from "@actions/artifact";
import * as coreModule from "@actions/core";
import { assertSafeFileNames, commonAncestorPath } from "./filenames.ts";
import type { ArtifactFile, Core } from "./interface.ts";

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
): Promise<{ id: number }> {
	const response = await client.uploadArtifact(name, filePaths, rootDirectory);
	if (response.id === undefined) {
		throw new Error("Artifact upload returned no ID");
	}
	coreModule.info(`Uploaded ${name} artifact: ID ${response.id}, ${filePaths.length} file(s)`);
	return { id: response.id };
}

export function createArtifactUploader(
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
