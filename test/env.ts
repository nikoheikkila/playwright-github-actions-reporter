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

interface RunEnvironment {
	runId?: string;
	repository?: string;
	serverUrl?: string;
}

/** Sets the GitHub run variables; an empty override stands in for a variable that is missing. */
export function setRunEnvironment({
	runId = "999",
	repository = "owner/repo",
	serverUrl = "https://github.com",
}: RunEnvironment = {}): void {
	process.env.GITHUB_RUN_ID = runId;
	process.env.GITHUB_REPOSITORY = repository;
	process.env.GITHUB_SERVER_URL = serverUrl;
}
