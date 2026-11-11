import type { NoteModel } from './models';

/** Fold case and strip accents so "energie" finds "Énergie". */
function searchable(value: string): string {
	return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

function terms(query: string): string[] {
	return searchable(query).trim().split(/\s+/).filter(Boolean);
}

const ACCENTS: Record<string, string> = {
	a: '[aàâä]',
	c: '[cç]',
	e: '[eéèêë]',
	i: '[iîï]',
	n: '[nñ]',
	o: '[oôö]',
	u: '[uùûü]',
	y: '[yÿ]'
};

function literal(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Match the original text, accents included, without moving source offsets. */
function pattern(query: string): RegExp | null {
	const parts = terms(query);
	if (!parts.length) return null;
	const source = parts
		.map((term) => [...term].map((char) => ACCENTS[char] ?? literal(char)).join(''))
		.join('|');
	return new RegExp(source, 'giu');
}

export interface TextPart {
	text: string;
	match: boolean;
}

/** Split text into highlighted and plain runs for inline rendering. */
export function highlightParts(value: string, query: string): TextPart[] {
	const matcher = pattern(query);
	if (!matcher) return value ? [{ text: value, match: false }] : [];
	const parts: TextPart[] = [];
	let last = 0;
	for (const found of value.matchAll(matcher)) {
		const index = found.index ?? 0;
		if (index > last) parts.push({ text: value.slice(last, index), match: false });
		parts.push({ text: found[0], match: true });
		last = index + found[0].length;
	}
	if (last < value.length) parts.push({ text: value.slice(last), match: false });
	return parts;
}

/** Short excerpt around a content match, so matches outside the title stay visible. */
export function noteSnippet(note: NoteModel, query: string, limit = 80): string {
	const matcher = pattern(query);
	if (!matcher) return '';
	const text = note.markdown
		.replace(/[#>*_`~[\]()!-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	const found = matcher.exec(text);
	if (!found) return '';
	const start = Math.max(0, Math.min((found.index ?? 0) - 24, text.length - limit));
	const excerpt = text.slice(start, start + limit);
	return `${start > 0 ? '…' : ''}${excerpt}${start + limit < text.length ? '…' : ''}`;
}

/** Whether the query matches some part of this text, accents included. */
export function textMatches(value: string, query: string): boolean {
	const matcher = pattern(query);
	return matcher ? matcher.test(value) : false;
}

/** Search only the caller's already-authorized note list. No extra data fetch. */ export function searchNotes(
	notes: NoteModel[],
	query: string
): NoteModel[] {
	const wanted = terms(query);
	if (!wanted.length) return notes;
	return notes.filter((note) => {
		const text = searchable(`${note.title}\n${note.markdown}`);
		return wanted.every((term) => text.includes(term));
	});
}
