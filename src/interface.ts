export interface Summary {
	addHeading(text: string, level: number): Summary;

	addList(items: string[]): Summary;

	write(): Promise<void>;

	stringify(): string;
}

export interface Core {
	summary: Summary;
}
