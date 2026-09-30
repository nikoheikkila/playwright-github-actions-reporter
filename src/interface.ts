export interface Core {
	summary: Summary;
	debug(message: string): void;
	isDebug(): boolean;
	info(message: string): void;
	notice(message: string, properties?: AnnotationProperties): void;
	warning(message: string, properties?: AnnotationProperties): void;
	error(message: string, properties?: AnnotationProperties): void;
	setFailed(message: string): void;
	/** Rejects instead of warning on any failure, so the reporter is the single place that warns about it. */
	uploadArtifact(name: string, files: ArtifactFile[]): Promise<{ id?: number }>;
}

export interface ArtifactFile {
	name: string;
	path: string;
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
	addDetails(label: string, html: string): Summary;
	addLink(text: string, href: string): Summary;
	write(): Promise<Summary>;
	stringify(): string;
}

export type SummaryTableRow = (SummaryTableCell | string)[];

export interface SummaryTableCell {
	data: string;
	header?: boolean;
}
