import { describe, expect, test } from "bun:test";
import { titlePath } from "../src/outcome.ts";
import { createStubTestCase } from "./stubs.ts";

describe("titlePath", () => {
	test("skips empty segments such as the root suite title", () => {
		const testCase = createStubTestCase({ titlePath: () => ["", "chromium", "", "file.spec.ts", "works"] });

		expect(titlePath(testCase)).toBe("chromium » file.spec.ts » works");
	});
});
