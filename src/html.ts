import type { Location } from "@playwright/test/reporter";

export interface ErrorMessage {
	message: string;
	snippet?: string;
	location?: Location;
}

const lineBreaks = /\r\n|\r|\n/g;

export const escapeHtml = (text: string): string =>
	text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export const inlineHtml = (text: string): string => escapeHtml(text).replaceAll(/\s*[\r\n]+\s*/g, " ");

export const preformattedHtml = ({ message, snippet }: ErrorMessage): string =>
	(snippet === undefined ? [message] : [message, snippet])
		.map((text) => `<pre>${escapeHtml(text).replaceAll(lineBreaks, "&#10;")}</pre>`)
		.join("");

export const attributeEscape = (text: string): string => inlineHtml(text).replaceAll('"', "&quot;");
