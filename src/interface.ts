export interface Core {
	summary: Summary;
	debug(message: string): void;
	isDebug(): boolean;
	info(message: string): void;
	notice(message: string): void;
	error(message: string): void;
	setFailed(message: string): void;
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
