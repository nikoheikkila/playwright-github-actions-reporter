import type { TestCase } from "@playwright/test/reporter";

export interface Core {
	summary: Summary;
	info(message: string): void;
}

export interface Summary {
	addRaw(text: string, addEol?: boolean): Summary;
	addHeading(text: string, level: number): Summary;
	addList(items: string[]): Summary;
	addTable(rows: SummaryTableRow[]): Summary;
	write(): Promise<Summary>;
	stringify(): string;
}

export type SummaryTableRow = (SummaryTableCell | string)[];

export interface SummaryTableCell {
	data: string;
	header?: boolean;
}

interface StoredResult {
	titlePath: string;
	status: string;
	duration: string;
	retries: string;
	tags: string;
}

export type ResultMap = Map<TestCase["id"], StoredResult>;
