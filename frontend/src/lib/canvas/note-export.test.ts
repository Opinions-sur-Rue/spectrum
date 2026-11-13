import { expect, it } from 'vitest';
import type { EdgeModel, NoteModel } from './models';
import { buildMarkdownExport, exportFilename } from './note-export';

const notes = [
	{
		id: 'two',
		title: ' Mobilité ',
		markdown: '## Le train\n\nEt le vélo.',
		moderation: 'approved'
	},
	{ id: 'one', title: 'Énergie', markdown: '', moderation: 'pending' }
] as NoteModel[];

const edges = [
	{ id: 'e1', from: 'one', to: 'two', relation: 'supports', label: ' complète ' },
	{ id: 'e2', from: 'two', to: 'gone', relation: 'questions', label: '' }
] as EdgeModel[];

it('exports visible notes sorted by title with links and pending status', () => {
	const text = buildMarkdownExport({
		roomId: 'OSR-ABCD1234',
		notes,
		edges,
		exportedAt: new Date('2026-11-12T01:02:03Z')
	});
	expect(text).toContain('# Spectrum — OSR-ABCD1234');
	expect(text).toContain('_Exported 2026-11-12 01:02 UTC_');
	expect(text).toContain('2 note(s), 2 link(s).');
	expect(text.indexOf('## Énergie')).toBeLessThan(text.indexOf('## Mobilité'));
	expect(text).toContain('_(pending)_');
	expect(text).toContain('_Empty note._');
	expect(text).toContain('- supports → Mobilité (complète)');
	expect(text).toContain('- questions → gone');
	expect(text.endsWith('\n')).toBe(true);
});

it('handles an empty or invisible room without inventing data', () => {
	const text = buildMarkdownExport({ roomId: 'OSR-EMPTY', notes: [], edges: [] });
	expect(text).toContain('_No note is visible in this room._');
	expect(text).not.toContain('##');
});

it('names the file after the room and day', () => {
	expect(exportFilename('OSR-ABCD1234', new Date('2026-11-12T23:00:00Z'))).toBe(
		'spectrum-OSR-ABCD1234-2026-11-12.md'
	);
	expect(exportFilename('', new Date('2026-01-02T00:00:00Z'))).toBe('spectrum-room-2026-01-02.md');
});
