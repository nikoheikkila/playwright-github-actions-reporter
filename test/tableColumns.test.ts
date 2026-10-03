import { describe, expect, test } from "bun:test";
import { type StoredResult, tableColumns } from "../src/outcome.ts";

const storedResult = (overrides: Partial<StoredResult> = {}): StoredResult => ({
	titlePath: "suite » works",
	label: "✅ Passed",
	duration: "1.5s",
	retries: "2",
	tags: "@smoke, @fast",
	...overrides,
});

describe("tableColumns", () => {
	test("lists the headers in order", () => {
		expect(tableColumns.map(({ header }) => header)).toStrictEqual(["Test", "Result", "Duration", "Retries", "Tags"]);
	});

	test("maps a stored result to a cell per column", () => {
		const result = storedResult();

		expect(tableColumns.map(({ cell }) => cell(result))).toStrictEqual([
			"suite » works",
			"✅ Passed",
			"1.5s",
			"2",
			"@smoke, @fast",
		]);
	});

	test("escapes HTML characters in title and tags", () => {
		const result = storedResult({ titlePath: "<b>a</b> & b", tags: "<@tag>" });
		const cells = tableColumns.map(({ cell }) => cell(result));

		expect(cells[0]).toBe("&lt;b&gt;a&lt;/b&gt; &amp; b");
		expect(cells[4]).toBe("&lt;@tag&gt;");
	});
});
