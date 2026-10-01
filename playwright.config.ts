import { defineConfig } from "@playwright/test";

const isPipeline = !!process.env.CI;

export default defineConfig({
	name: "Reporter Verification",
	testDir: "./e2e",
	globalSetup: isPipeline ? undefined : "./e2e/createStepSummary.ts",
	retries: 1,
	use: {
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},
	reporter: [["./index.ts", { screenshots: isPipeline, videos: isPipeline }]],
});
