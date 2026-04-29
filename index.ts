import * as core from "@actions/core";
import { GitHubReporter } from "./src/reporter.ts";

export default class Reporter extends GitHubReporter {
	constructor() {
		super(core);
	}
}
