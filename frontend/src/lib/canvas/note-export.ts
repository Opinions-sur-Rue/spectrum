import type { EdgeModel, NoteModel } from './models';

export interface ExportInput {
	roomId: string;
	notes: NoteModel[];
	edges: EdgeModel[];
	exportedAt?: Date;
}

function stamp(value: Date): string {
	return `${value.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function oneLine(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

/** Plain Markdown copy of the notes this caller is allowed to see.
 * Unknown link targets are kept by identifier so no note title is invented. */
export function buildMarkdownExport({
	roomId,
	notes,
	edges,
	exportedAt = new Date()
}: ExportInput): string {
	const titles = new Map(notes.map((note) => [note.id, oneLine(note.title) || note.id]));
	const lines = [`# Spectrum — ${roomId}`, '', `_Exported ${stamp(exportedAt)}_`, ''];
	lines.push(`${notes.length} note(s), ${edges.length} link(s).`, '');
	if (!notes.length) lines.push('_No note is visible in this room._', '');
	for (const note of notes.toSorted(
		(a, b) => oneLine(a.title).localeCompare(oneLine(b.title)) || a.id.localeCompare(b.id)
	)) {
		lines.push(`## ${titles.get(note.id)}`, '');
		if (note.moderation !== 'approved') lines.push(`_(${note.moderation})_`, '');
		lines.push(note.markdown.trim() || '_Empty note._', '');
		const outgoing = edges.filter((edge) => edge.from === note.id);
		if (outgoing.length) {
			lines.push('Links:');
			for (const edge of outgoing) {
				const label = oneLine(edge.label);
				lines.push(
					`- ${edge.relation} → ${titles.get(edge.to) ?? edge.to}${label ? ` (${label})` : ''}`
				);
			}
			lines.push('');
		}
	}
	return `${lines.join('\n').trimEnd()}\n`;
}

export function exportFilename(roomId: string, at = new Date()): string {
	const day = at.toISOString().slice(0, 10);
	return `spectrum-${roomId || 'room'}-${day}.md`;
}

export function downloadMarkdown(filename: string, content: string): void {
	const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	link.rel = 'noopener';
	document.body.append(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}
