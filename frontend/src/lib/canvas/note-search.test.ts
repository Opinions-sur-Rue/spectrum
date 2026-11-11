import { expect, it } from 'vitest';
import type { NoteModel } from './models';
import { highlightParts, noteSnippet, searchNotes, textMatches } from './note-search';

const notes = [
	{ id: 'one', title: 'Énergie partagée', markdown: '## Proposition\nRéduire les coûts ensemble.' },
	{ id: 'two', title: 'Mobilité', markdown: 'Le train et le vélo.' }
] as NoteModel[];

it('searches titles and note content without accents or case sensitivity', () => {
	expect(searchNotes(notes, 'ENERGIE couts').map((n) => n.id)).toEqual(['one']);
	expect(searchNotes(notes, ' velo ').map((n) => n.id)).toEqual(['two']);
	expect(searchNotes(notes, 'absent')).toEqual([]);
});

it('preserves order and returns only notes supplied by the authorized view', () => {
	expect(searchNotes(notes, '   ')).toBe(notes);
	expect(searchNotes([notes[1]], 'energie')).toEqual([]);
	expect(searchNotes([], 'train')).toEqual([]);
	expect(notes.map((n) => n.id)).toEqual(['one', 'two']);
});

it('highlights matches in place while keeping the original accented text', () => {
	expect(highlightParts('Énergie partagée', 'energie')).toEqual([
		{ text: 'Énergie', match: true },
		{ text: ' partagée', match: false }
	]);
	expect(highlightParts('Vélo & train', 'velo')).toEqual([
		{ text: 'Vélo', match: true },
		{ text: ' & train', match: false }
	]);
	expect(highlightParts('Coût (réduit)', 'cout')).toEqual([
		{ text: 'Coût', match: true },
		{ text: ' (réduit)', match: false }
	]);
	expect(
		highlightParts('Coût (réduit)', 'cout (reduit)')
			.map((part) => part.text)
			.join('')
	).toBe('Coût (réduit)');
	expect(highlightParts('Texte', '')).toEqual([{ text: 'Texte', match: false }]);
	expect(highlightParts('a+b', 'a+b')).toEqual([{ text: 'a+b', match: true }]);
});

it('builds a short snippet when the match is only in the note body', () => {
	const snippet = noteSnippet(notes[0], 'couts');
	expect(snippet).toContain('Réduire les coûts');
	expect(snippet.length).toBeLessThanOrEqual(82);
	expect(noteSnippet(notes[0], 'energie')).toBe('');
	expect(noteSnippet(notes[0], '   ')).toBe('');
	expect(textMatches('Énergie partagée', 'energie')).toBe(true);
	expect(textMatches('Mobilité', 'energie')).toBe(false);
	expect(textMatches('Mobilité', '   ')).toBe(false);
	expect(textMatches('Vélo & train', 'velo')).toBe(true);
});
