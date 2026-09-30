import * as coreModule from "@actions/core";
import { createArtifactUploader } from "./src/artifact.ts";
import type { AnnotationProperties, Core } from "./src/interface.ts";
import { GitHubReporter, type GitHubReporterOptions } from "./src/reporter.ts";

export type { GitHubReporterOptions };

const core: Core = {
	summary: coreModule.summary,
	debug: (message: string) => coreModule.debug(message),
	isDebug: () => coreModule.isDebug(),
	info: (message: string) => coreModule.info(message),
	notice: (message: string, properties?: AnnotationProperties) => coreModule.notice(message, properties),
	warning: (message: string, properties?: AnnotationProperties) => coreModule.warning(message, properties),
	error: (message: string, properties?: AnnotationProperties) => coreModule.error(message, properties),
	setFailed: (message: string) => coreModule.setFailed(message),
	uploadArtifact: createArtifactUploader(),
};

export default class Reporter extends GitHubReporter {
	constructor(options: GitHubReporterOptions = {}) {
		super(core, options);
	}
}
