import { defineConfig } from "@playwright/test";

const isPipeline = !!process.env.CI;

export default defineConfig({
	name: "Reporter Verification",
	testDir: "./e2e",
	globalSetup: isPipeline ? undefined : "./e2e/createStepSummary.ts",
	retries: 1,
	reporter: [["./index.ts"]],
});
