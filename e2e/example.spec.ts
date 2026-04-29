import { expect, type TestDetails, test } from "@playwright/test";

const tag = (name: string): TestDetails => ({
	tag: `@${name}`,
});

test("passing test", tag("pass"), () => {
	expect(1 + 1).toBe(2);
});

test.fail("failing test", tag("fail"), () => {
	expect(1 + 1).toBe(3);
});

test.fail("timed out test", tag("timeOut"), async () => {
	test.setTimeout(100);
	await new Promise((resolve) => setTimeout(resolve, 200));
});

test.skip("skipped test", tag("skip"), () => {
	expect(1 + 1).toBe(2);
});
