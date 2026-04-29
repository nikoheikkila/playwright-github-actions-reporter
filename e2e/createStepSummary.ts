import fs from "node:fs/promises";
import path from "node:path";

export default async function createStepSummary(): Promise<void> {
	const summaryFile = process.env.GITHUB_STEP_SUMMARY;

	if (summaryFile) {
		await fs.mkdir(path.dirname(summaryFile), { recursive: true });
		await fs.writeFile(summaryFile, "");
	}
}
