/**
 * A spectral tool's shape joining the spectral selection (ADR-0082): the
 * command a spectral marquee, lasso or brush runs on release, given the shape
 * as a mask of the one shape it drew, how it joins the selection, and the
 * channels a replacing shape scopes it to. What it makes of the selection is
 * the editor view's `withDrawnShape`, which the drag's preview showed, so the
 * selection a drag previews is the selection it makes. None is undoable: a
 * selection is not project content (REQ-EDIT-073).
 */

import type { Command } from '@audiogubbins/commands';
import { Malformed, channelCount, maskProblem, spectralMaskOf } from '@audiogubbins/domain';
import { withDrawnShape, type DrawnShape } from '@audiogubbins/editor-view';
import { SpectralCombination } from '@audiogubbins/timeline';

import type { EditorAsset } from '../assets/editor-asset.js';
import { isMemberOf } from '../state/stored-value.js';
import { channelsArgument } from './editor-target.js';
import { selectionCommand } from './selection-command.js';
import { textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** Why a drawn shape's mask cannot be read from `text`, or the mask. */
function drawnMaskOf(text: string | undefined): ReturnType<typeof spectralMaskOf> | string {
  const unreadable = 'A spectral shape needs a mask to join to the selection.';
  if (text === undefined) return unreadable;
  try {
    return spectralMaskOf(JSON.parse(text), 'mask');
  } catch (error) {
    // The text is an argument anyone may type, so a malformed one is refused
    // with a reason rather than taken as a fault.
    if (error instanceof SyntaxError || error instanceof Malformed) return unreadable;
    throw error;
  }
}

/**
 * The shape a spectral tool drew, as `editor.select-spectral` is given it: a
 * mask of the one shape and the softness, how it joins the selection, and
 * the channels a replacing shape scopes it to, each read as anything typed
 * is. Whether the mask may stand is asked of the selection it makes.
 */
function drawnShapeOf(
  invocation: Parameters<Command<ShellContext>['run']>[1],
  asset: EditorAsset,
): DrawnShape | string {
  const mask = drawnMaskOf(textArgument(invocation, 'mask'));
  if (typeof mask === 'string') return mask;
  const [shape, ...others] = mask.shapes;
  if (others.length > 0) return 'A spectral tool draws one shape at a time.';
  const combination = invocation.arguments?.['combination'];
  if (!isMemberOf(SpectralCombination, combination)) {
    return 'A spectral shape replaces the selection, adds to it or takes from it.';
  }
  return {
    shape,
    combination,
    feather: mask.feather,
    channels: channelsArgument(invocation, 'channels', channelCount(asset.layout)),
  };
}

/** The command that joins a spectral tool's shape to the selection. */
export function spectralSelectionCommands(): readonly Command<ShellContext>[] {
  return [
    selectionCommand(
      'editor.select-spectral',
      'Select a spectral area',
      (current, { asset }, _context, invocation) => {
        const drawn = drawnShapeOf(invocation, asset);
        if (typeof drawn === 'string') return drawn;
        const next = withDrawnShape(current, drawn, channelCount(asset.layout));
        if (next.spectral === undefined) return 'Nothing is selected to take that shape from.';
        // The one check of the shape and of what joining it made, which may
        // pass the shapes or points a selection may hold.
        return maskProblem(next.spectral, asset.length) ?? next;
      },
      { discoverable: false },
    ),
  ];
}
