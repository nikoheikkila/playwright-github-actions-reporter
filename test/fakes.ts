import * as os from "node:os";
import type { AnnotationProperties, Core, Summary, SummaryTableRow } from "../src/interface.ts";

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

	public async write(): Promise<Summary> {
		this.storedSummary = this.summaryBuffer;

		return this;
	}

	public stringify(): string {
		return this.storedSummary;
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
	public readonly noticeAnnotations: Annotation[] = [];
	public isFailed = false;

	private debugEnabled = false;

	constructor() {
		this.summary = new FakeSummary();
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

	public notice(message: string, properties?: AnnotationProperties): void {
		this.notices.push(message);
		this.noticeAnnotations.push({ message, properties });
	}

	public warning(message: string, properties?: AnnotationProperties): void {
		this.warningAnnotations.push({ message, properties });
	}

	public error(message: string, properties?: AnnotationProperties): void {
		this.errors.push(message);
		this.errorAnnotations.push({ message, properties });
	}

	public setFailed(message: string): never {
		this.error(message);
		throw new Error(message);
	}
}
