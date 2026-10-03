import { describe, expect, test } from "bun:test";
import { assertSafeFileNames, commonAncestorPath } from "../src/filenames.ts";

describe("commonAncestorPath", () => {
	test("falls back to the current directory without paths", () => {
		expect(commonAncestorPath([])).toBe(".");
	});

	test("uses the root separator when paths share no directory", () => {
		expect(commonAncestorPath(["/a/1.png", "/b/2.png"])).toBe("/");
	});
});

describe("assertSafeFileNames", () => {
	test.each(["C:evil.png", "z:evil.png"])("rejects the drive-relative name %s", (name) => {
		expect(() => assertSafeFileNames([{ name, path: "/tmp/1.png" }])).toThrow(`Invalid artifact file name: "${name}"`);
	});

	test.each(["video:1.webm", "1:a.png", "shot.png"])("accepts %s", (name) => {
		expect(() => assertSafeFileNames([{ name, path: "/tmp/1.png" }])).not.toThrow();
	});
});
