import * as core from "@actions/core";
import { GitHubReporter, type GitHubReporterOptions } from "./src/reporter.ts";

export type { GitHubReporterOptions };

export default class Reporter extends GitHubReporter {
	constructor(options: GitHubReporterOptions = {}) {
		super(core, options);
	}
}
