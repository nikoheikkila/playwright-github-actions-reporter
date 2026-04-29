import * as os from "node:os";
import type { Core, Summary, SummaryTableRow } from "../src/interface.ts";

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
	public readonly debugs: string[];
	public readonly infos: string[];
	private debugEnabled = false;

	constructor() {
		this.summary = new FakeSummary();
		this.debugs = [];
		this.infos = [];
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
}
