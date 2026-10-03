import * as os from "node:os";
import type { AnnotationProperties, ArtifactFile, Core, Summary, SummaryTableRow } from "../src/interface.ts";

type UploadArtifact = Core["uploadArtifact"];

interface FakeCoreOptions {
	uploadArtifact?: UploadArtifact;
}

interface Annotation {
	message: string;
	properties?: AnnotationProperties;
}

export class FakeSummary implements Summary {
	private summaryBuffer = "";
	private storedSummary = "";

	public addRaw(text: string, addEol = false): Summary {
		this.summaryBuffer += text;

		if (addEol) {
			this.summaryBuffer += os.EOL;
		}

		return this;
	}

	public addHeading(text: string, level: number): Summary {
		this.summaryBuffer += `<h${level}>${text}</h${level}>`;

		return this;
	}

	public addList(items: string[]): Summary {
		this.summaryBuffer += "<ul>";

		for (const item of items) {
			this.summaryBuffer += `<li>${item}</li>`;
		}

		this.summaryBuffer += "</ul>";

		return this;
	}

	public addTable(rows: SummaryTableRow[]): Summary {
		this.summaryBuffer += "<table>";

		for (const row of rows) {
			this.summaryBuffer += "<tr>";

			for (const cell of row) {
				if (typeof cell === "string") {
					this.summaryBuffer += `<td>${cell}</td>`;
					continue;
				}

				const tag = cell.header ? "th" : "td";
				this.summaryBuffer += `<${tag}>${cell.data}</${tag}>`;
			}

			this.summaryBuffer += "</tr>";
		}

		this.summaryBuffer += "</table>";

		return this;
	}

	public addDetails(label: string, html: string): Summary {
		this.summaryBuffer += `<details><summary>${label}</summary>${html}</details>`;

		return this;
	}

	public addLink(text: string, href: string): Summary {
		return this.addRaw(`<a href="${href}">${text}</a>`, true);
	}

	public async write(): Promise<Summary> {
		this.storedSummary = this.summaryBuffer;

		return this;
	}

	public stringify(): string {
		return this.storedSummary || this.summaryBuffer;
	}
}

export class FakeCore implements Core {
	public readonly summary: Summary;
	public readonly debugs: string[] = [];
	public readonly infos: string[] = [];
	public readonly errors: string[] = [];
	public readonly notices: string[] = [];
	public readonly errorAnnotations: Annotation[] = [];
	public readonly warningAnnotations: Annotation[] = [];
	public readonly uploadedArtifacts: Array<{ name: string; files: ArtifactFile[] }> = [];
	public readonly failures: string[] = [];
	public isFailed = false;

	private debugEnabled = false;
	private uploadError: Error | undefined;
	private uploadErrorArtifact: string | undefined;
	private readonly uploader: UploadArtifact;

	constructor({ uploadArtifact = async () => ({ id: 42 }) }: FakeCoreOptions = {}) {
		this.summary = new FakeSummary();
		this.uploader = uploadArtifact;
	}

	public debug(message: string): void {
		this.debugs.push(message);
	}

	public isDebug(): boolean {
		return this.debugEnabled;
	}

	public setDebug(value: boolean): void {
		this.debugEnabled = value;
	}

	public info(message: string): void {
		this.infos.push(message);
	}

	public notice(message: string): void {
		this.notices.push(message);
	}

	public warning(message: string, properties?: AnnotationProperties): void {
		this.warningAnnotations.push({ message, properties });
	}

	public error(message: string, properties?: AnnotationProperties): void {
		this.errors.push(message);
		this.errorAnnotations.push({ message, properties });
	}

	public setUploadArtifactThrow(error: Error, artifact?: string): void {
		this.uploadError = error;
		this.uploadErrorArtifact = artifact;
	}

	public async uploadArtifact(name: string, files: ArtifactFile[]): Promise<{ id: number }> {
		this.uploadedArtifacts.push({ name, files });

		if (this.uploadError !== undefined && (this.uploadErrorArtifact ?? name) === name) {
			throw this.uploadError;
		}

		return this.uploader(name, files);
	}

	public setFailed(message: string): void {
		this.isFailed = true;
		this.failures.push(message);
	}
}
