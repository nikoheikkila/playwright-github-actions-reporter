import { type Mock, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as coreModule from "@actions/core";

/** Returns the part of the summary from the heading to the end, or "" if the heading is missing. */
export function section(summary: string, heading: string): string {
	const start = summary.indexOf(heading);

	return start === -1 ? "" : summary.slice(start);
}

/** Creates a temp directory holding the given files, passes it to the callback and always removes it afterwards. */
export async function withSourceFiles<T>(
	files: Record<string, string>,
	callback: (dir: string) => Promise<T>,
): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), "reporter-source-"));

	try {
		for (const [name, content] of Object.entries(files)) {
			await Bun.write(join(dir, name), content);
		}

		return await callback(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/** Replaces `core.warning` with a spy that does nothing and returns the spy. */
export function silenceWarnings(): Mock<typeof coreModule.warning> {
	return spyOn(coreModule, "warning").mockImplementation(() => undefined);
}
