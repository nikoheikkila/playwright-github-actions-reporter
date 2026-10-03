import * as coreModule from "@actions/core";
import { createArtifactUploader } from "./src/artifact.ts";
import type { Core } from "./src/interface.ts";
import { GitHubReporter, type GitHubReporterOptions } from "./src/reporter.ts";

export type { GitHubReporterOptions };

const core: Core = {
	summary: coreModule.summary,
	debug: coreModule.debug,
	isDebug: coreModule.isDebug,
	info: coreModule.info,
	notice: coreModule.notice,
	warning: coreModule.warning,
	error: coreModule.error,
	setFailed: coreModule.setFailed,
	uploadArtifact: createArtifactUploader(),
};

export default class Reporter extends GitHubReporter {
	constructor(options: GitHubReporterOptions = {}) {
		super(core, options);
	}
}
