// @ts-check
/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
	plugins: ["@stryker-mutator/typescript-checker", "@hughescr/stryker-bun-runner"],
	testRunner: "bun",
	coverageAnalysis: "perTest",
	checkers: ["typescript"],
	tsconfigFile: "tsconfig.json",
	mutate: ["src/**/*.ts", "!src/interface.ts"],
	ignorePatterns: ["dist", "coverage", "test-results", "playwright-report", "reports"],
	reporters: ["html", "json", "clear-text", "progress"],
	clearTextReporter: { logTests: false },
	htmlReporter: { fileName: "reports/mutation/mutation.html" },
	jsonReporter: { fileName: "reports/mutation/mutation.json" },
	incrementalFile: "reports/stryker-incremental.json",
};
