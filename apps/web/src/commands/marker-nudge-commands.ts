/**
 * Nudging markers from the keyboard (REQ-UX-005, ADR-0047): the selected
 * markers moved back or forward by a pixel of the view or by a sample, as one
 * change of the project that undo reverses. A marker was moved only by
 * dragging it, so a person without a pointer could not reposition one at all.
 *
 * A nudge that would take any of the markers past either end of the asset moves
 * none of them, rather than stopping one at the end, so undoing it always
 * returns every marker to where it was.
 */

import { unchanged, type Command, type CommandInvocation } from '@audiogubbins/commands';
import { sampleCount, type MarkerId, type SampleCount, type Marker } from '@audiogubbins/domain';
import { samplesWithin } from '@audiogubbins/timeline';

import { editorTarget, numberArgument, type EditorTarget } from './editor-target.js';
import {
  markedAsset,
  markerCommand,
  markersNamed,
  moveMarkers,
  selectedMarkers,
  type MarkedAsset,
} from './marker-commands.js';
import { markerIdsOf } from './selection-commands.js';
import { textArgument, type BodyAnswer } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** Moves the markers named by `ids` by `frames` of the view, or says why they cannot go. */
function movedBy(
  context: ShellContext,
  found: MarkedAsset,
  ids: readonly MarkerId[],
  frames: number,
): BodyAnswer {
  if (frames === 0) return unchanged('editor.marker-there', 'The markers are there already.');
  const markers = markersNamed(found, ids);
  if (typeof markers === 'string') return markers;
  const shown = new Map(found.asset.markers.map((marker) => [marker.id, marker.position]));
  const moves: { readonly marker: Marker; readonly to: SampleCount }[] = [];
  for (const marker of markers) {
    const to = sampleCount((shown.get(marker.id) ?? 0) + frames);
    if (!to.ok || to.value > found.asset.length) {
      return `${marker.displayName} is too near the ${frames < 0 ? 'start' : 'end'} of ${found.asset.name} to move that far.`;
    }
    moves.push({ marker, to: to.value });
  }
  return moveMarkers(context, found, moves);
}

/** A nudge of the selected markers by `frames` of the view it acts on. */
function nudge(
  id: string,
  label: string,
  frames: (target: EditorTarget) => number,
  keywords: readonly string[],
): Command<ShellContext> {
  return markerCommand(
    id,
    label,
    (context, invocation) => {
      const target = editorTarget(context, invocation);
      if (typeof target === 'string') return target;
      const found = markedAsset(context, invocation);
      if (typeof found === 'string') return found;
      const ids = selectedMarkers(context, target.asset);
      if (typeof ids === 'string') return ids;
      return movedBy(context, found, ids, frames(target));
    },
    { keywords },
  );
}

/** A move of the markers named by a whole number of frames, as a macro records one. */
function moveMarkersBy(): Command<ShellContext> {
  return markerCommand(
    'editor.move-markers-by',
    'Move markers by a distance',
    (context, invocation: CommandInvocation) => {
      const found = markedAsset(context, invocation);
      if (typeof found === 'string') return found;
      const ids = markerIdsOf(textArgument(invocation, 'markers'));
      const frames = numberArgument(invocation, 'frames');
      if (ids.length === 0 || frames === undefined || !Number.isInteger(frames)) {
        return 'A move needs markers and a whole number of frames.';
      }
      return movedBy(context, found, ids, frames);
    },
    { discoverable: false },
  );
}

/** A pixel of the view, in frames, in the direction given. */
const aPixel = (sign: -1 | 1) => (target: EditorTarget) =>
  sign * samplesWithin(target.state.viewport, 1);

/** The commands that nudge markers, and the move by a distance. */
export function markerNudgeCommands(): readonly Command<ShellContext>[] {
  const keywords = ['marker', 'nudge', 'move'];
  return [
    nudge('editor.nudge-markers-back', 'Nudge the selected markers back', aPixel(-1), [
      ...keywords,
      'back',
      'left',
      'pixel',
    ]),
    nudge('editor.nudge-markers-forward', 'Nudge the selected markers forward', aPixel(1), [
      ...keywords,
      'forward',
      'right',
      'pixel',
    ]),
    nudge(
      'editor.nudge-markers-back-sample',
      'Nudge the selected markers back one sample',
      () => -1,
      [...keywords, 'back', 'left', 'sample', 'exact'],
    ),
    nudge(
      'editor.nudge-markers-forward-sample',
      'Nudge the selected markers forward one sample',
      () => 1,
      [...keywords, 'forward', 'right', 'sample', 'exact'],
    ),
    moveMarkersBy(),
  ];
}
