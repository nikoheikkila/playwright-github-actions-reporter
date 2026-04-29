import { expect, test } from "@playwright/test";

test("passing test", () => {
	expect(1 + 1).toBe(2);
});

test.fail("failing test", () => {
	expect(1 + 1).toBe(3);
});

test.fail("timed out test", async () => {
	test.setTimeout(100);
	await new Promise((resolve) => setTimeout(resolve, 200));
});

test.skip("skipped test", () => {
	expect(1 + 1).toBe(2);
});
