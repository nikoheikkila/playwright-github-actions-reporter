import { dirname, sep } from "node:path";
import type { ArtifactFile } from "./interface.ts";

function sharedPrefix(left: string[], right: string[]): string[] {
	const mismatch = left.findIndex((segment, index) => segment !== right[index]);
	return mismatch === -1 ? left : left.slice(0, mismatch);
}

export function commonAncestorPath(paths: string[]): string {
	const directories = paths.map((path) => dirname(path).split(sep));
	const common = directories.reduce(sharedPrefix, directories[0] ?? ["."]).join(sep);
	return common === "" ? sep : common;
}

// Names are joined onto the staging directory, so anything that could escape it is rejected
function isSafeFileName(name: string): boolean {
	return name !== "" && !/[/\\]|\.\.|^[A-Za-z]:/.test(name);
}

export function assertSafeFileNames(files: ArtifactFile[]): void {
	const unsafe = files.find((file) => !isSafeFileName(file.name));
	if (unsafe !== undefined) {
		throw new Error(`Invalid artifact file name: "${unsafe.name}"`);
	}
}
