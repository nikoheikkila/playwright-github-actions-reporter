import { afterEach } from "bun:test";

export function preserveEnv(...keys: string[]): void {
	const saved: Record<string, string | undefined> = {};
	for (const key of keys) {
		saved[key] = process.env[key];
	}

	afterEach(() => {
		for (const key of keys) {
			const value = saved[key];
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	});
}

export function setRunEnvironment(): void {
	process.env.GITHUB_RUN_ID = "999";
	process.env.GITHUB_REPOSITORY = "owner/repo";
	process.env.GITHUB_SERVER_URL = "https://github.com";
}
