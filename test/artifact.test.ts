import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { DefaultArtifactClient } from "@actions/artifact";
import { createArtifactUploader } from "../src/artifact.ts";
import { GitHubReporter } from "../src/reporter.ts";
import { preserveEnv } from "./env.ts";
import { FakeCore } from "./fakes.ts";
import { createRunners } from "./harness.ts";
import { withSourceFiles } from "./helpers.ts";
import { createStubAttachment, createStubTestCase, createStubTestError, createStubTestResult } from "./stubs.ts";

describe("Playwright GitHub Actions Reporter", () => {
	preserveEnv("GITHUB_WORKSPACE");
	let core: FakeCore;
	let reporter: GitHubReporter;

	beforeEach(() => {
		process.env.GITHUB_WORKSPACE = "/path/to";
		core = new FakeCore();
		reporter = new GitHubReporter(core);
	});

	const { runTestCases } = createRunners(
		() => core,
		() => reporter,
	);

	describe("Artifact upload outside GitHub Actions", () => {
		preserveEnv("ACTIONS_RUNTIME_TOKEN", "ACTIONS_RESULTS_URL");
		test("warns exactly once when the Actions runtime variables are missing", async () => {
			delete process.env.ACTIONS_RUNTIME_TOKEN;
			delete process.env.ACTIONS_RESULTS_URL;
			core = new FakeCore({ uploadArtifact: createArtifactUploader() });
			reporter = new GitHubReporter(core, { screenshots: true });
			const testCase = createStubTestCase({
				results: [
					createStubTestResult({
						status: "failed",
						errors: [createStubTestError()],
						attachments: [createStubAttachment()],
					}),
				],
			});

			const { summary } = await runTestCases(testCase);

			expect(core.warningAnnotations).toHaveLength(1);
			expect(core.warningAnnotations[0]?.message).toContain("Actions runtime variables");
			expect(core.warningAnnotations[0]?.message).toContain(
				"See the `screenshots` and `videos` options in the README for setup.",
			);
			expect(core.isFailed).toBe(false);
			expect(summary).not.toContain("Screenshots</a>");
			expect(summary).not.toContain("undefined");
		});
	});
});

describe("createArtifactUploader", () => {
	preserveEnv("ACTIONS_RUNTIME_TOKEN", "ACTIONS_RESULTS_URL", "TMPDIR");

	afterEach(() => {
		mock.restore();
	});

	beforeEach(() => {
		process.env.ACTIONS_RUNTIME_TOKEN = "token";
		process.env.ACTIONS_RESULTS_URL = "https://results.example";
	});

	const createClient = (behaviour: () => Promise<{ id?: number }>) => {
		const calls: Array<{ name: string; files: string[]; root: string }> = [];
		const client = {
			uploadArtifact: async (name: string, files: string[], root: string) => {
				calls.push({ name, files, root });
				return behaviour();
			},
		} as unknown as DefaultArtifactClient;
		return { client, calls };
	};

	test("throws instead of warning when the client throws", async () => {
		const { client } = createClient(async () => {
			throw new Error("boom");
		});

		const upload = createArtifactUploader(client)("shots", [{ name: "a", path: "/tmp/a/1.png" }]);

		await expect(upload).rejects.toThrow("boom");
	});

	test.each([
		["ACTIONS_RUNTIME_TOKEN", "ACTIONS_RESULTS_URL"],
		["ACTIONS_RESULTS_URL", "ACTIONS_RUNTIME_TOKEN"],
	])("throws and skips the client when %s is missing", async (missing, present) => {
		process.env[present] = "value";
		delete process.env[missing];
		const { client, calls } = createClient(async () => ({ id: 1 }));

		const upload = createArtifactUploader(client)("shots", [{ name: "a", path: "/tmp/a/1.png" }]);

		await expect(upload).rejects.toThrow(Error);
		expect(calls).toHaveLength(0);
	});

	test("uploads with the common ancestor of all file paths as root directory", async () => {
		const { client, calls } = createClient(async () => ({ id: 42 }));
		const files = [
			{ name: "one", path: "/tmp/run/x/1.png" },
			{ name: "two", path: "/tmp/run/y/z/2.png" },
		];

		const result = await createArtifactUploader(client)("shots", files);

		expect(result).toStrictEqual({ id: 42 });
		expect(calls[0]?.root).toBe("/tmp/run");
	});

	test.each([
		["empty", ""],
		["absolute posix", "/etc/evil.png"],
		["absolute windows", "C:\\evil.png"],
		["forward slash separator", "nested/evil.png"],
		["backslash separator", "nested\\evil.png"],
		["directory traversal", ".."],
	])("rejects %s file name before staging or uploading anything", async (_case, name) => {
		await withSourceFiles({ "1.png": "image-bytes" }, async (source) => {
			const { client, calls } = createClient(async () => ({ id: 1 }));

			const upload = createArtifactUploader(client)("shots", [{ name, path: join(source, "1.png") }]);

			await expect(upload).rejects.toThrow(/invalid artifact file name/i);
			expect(calls).toHaveLength(0);
		});
	});

	test("stages renamed files in a unique private mkdtemp directory under os.tmpdir and removes it afterwards", async () => {
		delete process.env.TMPDIR;
		const uploadTmpdir = tmpdir();
		const seen: Array<{ root: string; staged: string; mode: number }> = [];
		const client = {
			uploadArtifact: async (_name: string, files: string[], root: string) => {
				const staged = await readFile(join(root, "renamed.png"), "utf8");
				seen.push({ root, staged, mode: (await stat(root)).mode & 0o777 });
				expect(files).toStrictEqual([join(root, "renamed.png")]);
				throw new Error("upload failed");
			},
		} as unknown as DefaultArtifactClient;

		await withSourceFiles({ "1.png": "image-bytes" }, async (source) => {
			const upload = createArtifactUploader(client);
			const files = [{ name: "renamed.png", path: join(source, "1.png") }];

			await expect(upload("shots", files)).rejects.toThrow("upload failed");
			await expect(upload("shots", files)).rejects.toThrow("upload failed");
		});

		const [first, second] = seen;
		expect(seen).toHaveLength(2);
		expect(first?.staged).toBe("image-bytes");
		expect(dirname(first?.root ?? "")).toBe(uploadTmpdir);
		expect(basename(first?.root ?? "").startsWith("playwright-artifact-")).toBe(true);
		expect(first?.root).not.toBe(second?.root);
		expect(first?.mode).toBe(0o700);
		expect(existsSync(first?.root ?? "")).toBe(false);
	});

	test.each([
		["a symlink to another file", "symlink"],
		["a directory", "directory"],
	])("rejects %s as a non-regular attachment before uploading anything", async (_case, kind) => {
		await withSourceFiles({ "secret.txt": "secret-contents" }, async (source) => {
			const target = join(source, "secret.txt");
			const path = join(source, "1.png");
			if (kind === "symlink") {
				await symlink(target, path);
			} else {
				await mkdir(path);
			}
			const { client, calls } = createClient(async () => ({ id: 1 }));

			const error = await createArtifactUploader(client)("shots", [{ name: "1.png", path }]).catch((e: Error) => e);

			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).not.toContain("secret-contents");
			expect((error as Error).message).not.toContain(source);
			expect(calls).toHaveLength(0);
		});
	});

	test("throws 'Artifact upload returned no ID' when client returns undefined id, and cleans up staging directory", async () => {
		const { client, calls } = createClient(async () => ({ id: undefined }));

		await withSourceFiles({ "1.png": "image-bytes" }, async (source) => {
			const upload = createArtifactUploader(client)("shots", [{ name: "renamed.png", path: join(source, "1.png") }]);

			await expect(upload).rejects.toThrow("Artifact upload returned no ID");
		});

		const root = calls[0]?.root ?? "";
		expect(calls).toHaveLength(1);
		expect(root).not.toBe("");
		expect(existsSync(root)).toBe(false);
	});

	test("succeeds with real files, uses unique staged names, and cleans up staging directory", async () => {
		const { client, calls } = createClient(async () => ({ id: 123 }));

		const result = await withSourceFiles({ "a.png": "first-bytes", "b.png": "second-bytes" }, (source) =>
			createArtifactUploader(client)("shots", [
				{ name: "first-renamed.png", path: join(source, "a.png") },
				{ name: "second-renamed.png", path: join(source, "b.png") },
			]),
		);

		const root = calls[0]?.root ?? "";
		expect(result).toStrictEqual({ id: 123 });
		expect(calls).toHaveLength(1);
		expect(calls[0]?.files).toStrictEqual([join(root, "first-renamed.png"), join(root, "second-renamed.png")]);
		expect(basename(root).startsWith("playwright-artifact-")).toBe(true);
		expect(existsSync(root)).toBe(false);
	});
});
