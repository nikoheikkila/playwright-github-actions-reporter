export interface Core {
	summary: Summary;
	debug(message: string): void;
	isDebug(): boolean;
	info(message: string): void;
	notice(message: string, properties?: AnnotationProperties): void;
	warning(message: string, properties?: AnnotationProperties): void;
	error(message: string, properties?: AnnotationProperties): void;
	setFailed(message: string): void;
}

export interface AnnotationProperties {
	title?: string;
	file?: string;
	startLine?: number;
	startColumn?: number;
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
