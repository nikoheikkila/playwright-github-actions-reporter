import type { TestCase } from "@playwright/test/reporter";
import type { ArtifactFile, Core } from "./interface.ts";
import { lastResult } from "./testCase.ts";

/** Each kind of failure attachment the reporter can upload as one artifact and link from the Failures section. */
export interface AttachmentKind {
	option: "screenshots" | "videos";
	artifact: string;
	contentType: string;
	extension: string;
	label: string;
}

export const attachmentKinds: readonly AttachmentKind[] = [
	{
		option: "screenshots",
		artifact: "playwright-screenshots",
		contentType: "image/png",
		extension: "png",
		label: "Screenshots",
	},
	{
		option: "videos",
		artifact: "playwright-videos",
		contentType: "video/webm",
		extension: "webm",
		label: "Videos",
	},
];

export const artifactUrl = (id: number): string | undefined => {
	const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
	if (!(GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID)) {
		return undefined;
	}
	return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/artifacts/${id}`;
};

const attachmentPaths = (test: TestCase, kind: AttachmentKind): string[] =>
	(lastResult(test)?.attachments ?? []).flatMap(({ contentType, path }) =>
		contentType === kind.contentType && path !== undefined ? [path] : [],
	);

export const attachmentFiles = (tests: TestCase[], kind: AttachmentKind): ArtifactFile[] =>
	// Titles can repeat and contain path separators, so the opaque, unique test id names the file instead.
	tests.flatMap((test) => {
		const paths = attachmentPaths(test, kind);
		// A lone attachment keeps the plain name; only several need an index to stay unique.
		const suffix = (index: number) => (paths.length === 1 ? "" : `-${index}`);
		return paths.map((path, index) => ({ name: `${test.id}${suffix(index)}.${kind.extension}`, path }));
	});

/** Resolves to `undefined` after a warning, so a failed upload never hides the Failures section. */
const uploadLink = async (core: Core, kind: AttachmentKind, files: ArtifactFile[]): Promise<string | undefined> => {
	try {
		const url = artifactUrl((await core.uploadArtifact(kind.artifact, files)).id);
		if (url === undefined) {
			core.warning(`GitHub run environment is missing, so the summary does not link to ${kind.label.toLowerCase()}.`);
		}
		return url;
	} catch (error) {
		core.warning(error instanceof Error ? error.message : String(error));
		return undefined;
	}
};

/** Resolves to artifact URLs keyed by link label, in upload order. */
export const uploadAttachments = async (
	core: Core,
	kinds: readonly AttachmentKind[],
	tests: TestCase[],
): Promise<ReadonlyMap<string, string>> => {
	const links = new Map<string, string>();
	for (const kind of kinds) {
		const files = attachmentFiles(tests, kind);
		const url = files.length > 0 ? await uploadLink(core, kind, files) : undefined;
		if (url !== undefined) {
			links.set(kind.label, url);
		}
	}
	return links;
};
