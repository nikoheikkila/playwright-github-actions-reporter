import { describe, expect, test } from "bun:test";
import { artifactUrl, attachmentKinds, uploadAttachments } from "../src/attachments.ts";
import { preserveEnv, setRunEnvironment } from "./env.ts";
import { FakeCore } from "./fakes.ts";
import { createStubAttachment, createStubFailingTestCase } from "./stubs.ts";

describe("uploadAttachments", () => {
	preserveEnv("GITHUB_RUN_ID", "GITHUB_REPOSITORY", "GITHUB_SERVER_URL");

	test("returns the artifact URL under the kind's label after uploading a PNG of an unexpected test", async () => {
		setRunEnvironment();
		const core = new FakeCore();
		const screenshots = attachmentKinds.filter(({ option }) => option === "screenshots");
		const test1 = createStubFailingTestCase(
			{ id: "a1" },
			{ attachments: [createStubAttachment({ path: "/tmp/a1/screenshot.png" })] },
		);

		const links = await uploadAttachments(core, screenshots, [test1]);

		expect(links).toStrictEqual(new Map([["Screenshots", artifactUrl(42) ?? ""]]));
		expect(core.uploadedArtifacts).toStrictEqual([
			{ name: "playwright-screenshots", files: [{ name: "a1.png", path: "/tmp/a1/screenshot.png" }] },
		]);
	});

	test("leaves a kind out of the links and uploads nothing when the tests hold no files for it", async () => {
		setRunEnvironment();
		const core = new FakeCore();
		const screenshots = attachmentKinds.filter(({ option }) => option === "screenshots");
		const withoutPng = createStubFailingTestCase({ id: "b1" }, { attachments: [] });

		const links = await uploadAttachments(core, screenshots, [withoutPng]);

		expect(links.has("Screenshots")).toBe(false);
		expect(links.size).toBe(0);
		expect(core.uploadedArtifacts).toStrictEqual([]);
	});

	test("warns once and leaves no link for a kind whose upload throws while the other kind still uploads", async () => {
		setRunEnvironment();
		const core = new FakeCore();
		core.setUploadArtifactThrow(new Error("screenshots upload failed"), "playwright-screenshots");
		const failing = createStubFailingTestCase(
			{ id: "c1" },
			{
				attachments: [
					createStubAttachment({ path: "/tmp/c1/screenshot.png" }),
					createStubAttachment({ path: "/tmp/c1/video.webm", contentType: "video/webm" }),
				],
			},
		);

		const links = await uploadAttachments(core, attachmentKinds, [failing]);

		expect(core.warningAnnotations.map(({ message }) => message)).toStrictEqual(["screenshots upload failed"]);
		expect(links.has("Screenshots")).toBe(false);
		expect(links).toStrictEqual(new Map([["Videos", artifactUrl(42) ?? ""]]));
	});
});
