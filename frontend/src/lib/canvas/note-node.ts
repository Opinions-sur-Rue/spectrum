import Konva from 'konva';
import { MODERATION_STROKE, type NoteModel } from './models';

const CARD_FILL = '#ffffff';
const TITLE_FILL = '#1f2937';
const BODY_FILL = '#6b7280';
const PADDING = 16;

/**
 * Builds the Konva group of a note card. The group is positioned in world
 * coordinates; the caller owns the drag and click handlers.
 */
export function createNoteGroup(note: NoteModel): Konva.Group {
	const group = new Konva.Group({
		id: note.id,
		name: 'note',
		x: note.x,
		y: note.y,
		draggable: true
	});

	group.add(
		new Konva.Rect({
			name: 'note-body',
			width: note.width,
			height: note.height,
			cornerRadius: 12,
			fill: CARD_FILL,
			stroke: MODERATION_STROKE[note.moderation],
			strokeWidth: 2,
			shadowColor: '#000000',
			shadowBlur: 12,
			shadowOpacity: 0.15,
			shadowOffset: { x: 0, y: 4 }
		})
	);

	group.add(
		new Konva.Text({
			x: PADDING,
			y: PADDING - 2,
			width: note.width - PADDING * 2,
			text: note.title,
			fontSize: 16,
			fontStyle: 'bold',
			fontFamily: 'system-ui, sans-serif',
			fill: TITLE_FILL,
			wrap: 'none',
			ellipsis: true
		})
	);

	group.add(
		new Konva.Text({
			x: PADDING,
			y: PADDING + 26,
			width: note.width - PADDING * 2,
			height: note.height - PADDING * 2 - 26,
			text: note.markdown,
			fontSize: 13,
			fontFamily: 'system-ui, sans-serif',
			lineHeight: 1.35,
			fill: BODY_FILL,
			wrap: 'word',
			ellipsis: true
		})
	);

	if (note.moderation !== 'approved' || !note.visible) {
		group.add(
			new Konva.Text({
				x: PADDING,
				y: note.height - PADDING - 12,
				width: note.width - PADDING * 2,
				text: note.moderation === 'approved' ? 'hidden' : note.moderation,
				fontSize: 11,
				fontFamily: 'system-ui, sans-serif',
				fill: MODERATION_STROKE[note.moderation],
				align: 'right'
			})
		);
	}

	return group;
}
