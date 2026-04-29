import { defineConfig } from "@playwright/test";

const isPipeline = !!process.env.CI;

export default defineConfig({
	testDir: "./e2e",
	globalSetup: isPipeline ? undefined : "./e2e/createStepSummary.ts",
	retries: 0,
	reporter: [["./index.ts"]],
});
