/**
 * What each of a tool's intents runs: the same commands a key, a menu entry
 * or the palette runs (REQ-EDIT-065), named with the view the pointer was in.
 *
 * The razor resolves where a split would go, which is Phase 05's to make
 * (`REQ-EDIT-014`); until then its click places the playhead exactly there,
 * snapped as a split will be, and the tool says so.
 */

import type { ToolIntent } from '@audiogubbins/editor-view';

/** A command to run, and what it is given. */
export interface IntentCommand {
  readonly id: string;
  readonly args: Readonly<Record<string, string | number | boolean>>;
}

/** The commands `intent`, made in view `view`, runs. */
export function commandsOf(intent: ToolIntent, view: string): readonly IntentCommand[] {
  switch (intent.kind) {
    case 'select-time':
      return [
        {
          id: 'editor.select-time',
          args: {
            view,
            start: intent.range.start,
            end: intent.range.end,
            ...(intent.channels === undefined ? {} : { channels: intent.channels.join(',') }),
          },
        },
      ];
    case 'select-marker':
      return [{ id: 'editor.select-marker', args: { view, marker: intent.id, add: intent.add } }];
    case 'set-playhead':
      return [{ id: 'editor.set-playhead', args: { view, position: intent.position } }];
    case 'move-marker':
      return [{ id: 'editor.move-marker', args: { view, marker: intent.id, to: intent.to } }];
    case 'add-marker':
      return [{ id: 'editor.add-marker', args: { view, at: intent.at } }];
    case 'scroll':
      return [{ id: 'editor.scroll', args: { view, pixels: intent.dx } }];
    case 'zoom-to-range':
      return [
        {
          id: 'editor.zoom-to-range',
          args: { view, start: intent.range.start, end: intent.range.end },
        },
      ];
    case 'zoom-step':
      return [
        {
          id: intent.direction === 'in' ? 'editor.zoom-in' : 'editor.zoom-out',
          args: { view, anchor: intent.x },
        },
      ];
    case 'split-at':
      return [{ id: 'editor.set-playhead', args: { view, position: intent.position } }];
  }
}
