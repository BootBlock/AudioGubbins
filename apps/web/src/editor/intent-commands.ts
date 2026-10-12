/**
 * What each of a tool's intents runs: the same commands a key, a menu entry
 * or the palette runs (REQ-EDIT-065), named with the view the pointer was in.
 * The razor splits where it is clicked, and the region tool makes a region of
 * the range it was dragged over by selecting it and making a region of the
 * selection, as a person with a keyboard does. A region's end dragged in the
 * strip moves to where it was let go. A spectral tool's shape joins the
 * spectral selection, given as a mask of the one shape it drew.
 */

import { RegionBoundary } from '@audiogubbins/domain';
import type { DrawnShape, ToolIntent } from '@audiogubbins/editor-view';

/** A command to run, and what it is given. */
export interface IntentCommand {
  readonly id: string;
  readonly args: Readonly<Record<string, string | number | boolean>>;
}

/** The command that joins a spectral tool's shape, drawn in view `view`, to the selection. */
function spectralSelection(drawn: DrawnShape, view: string): IntentCommand {
  const { shape, feather, combination, channels } = drawn;
  return {
    id: 'editor.select-spectral',
    args: {
      view,
      mask: JSON.stringify({ shapes: [shape], feather }),
      combination,
      ...(channels === undefined ? {} : { channels: channels.join(',') }),
    },
  };
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
    case 'select-region':
      return [{ id: 'editor.select-region', args: { view, region: intent.id, add: intent.add } }];
    case 'set-playhead':
      return [{ id: 'editor.set-playhead', args: { view, position: intent.position } }];
    case 'move-marker':
      return [{ id: 'editor.move-marker', args: { view, marker: intent.id, to: intent.to } }];
    case 'move-region-boundary':
      return [
        {
          id: intent.boundary === RegionBoundary.Start ? 'region.move-start' : 'region.move-end',
          args: { view, region: intent.id, to: intent.to },
        },
      ];
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
      return [{ id: 'edit.split', args: { view, at: intent.position } }];
    case 'make-region':
      return [
        {
          id: 'editor.select-time',
          args: { view, start: intent.range.start, end: intent.range.end },
        },
        { id: 'region.create', args: { view } },
      ];
    case 'select-spectral':
      return [spectralSelection(intent.drawn, view)];
  }
}
