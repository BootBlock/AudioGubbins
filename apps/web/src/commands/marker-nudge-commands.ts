/**
 * Nudging markers from the keyboard (REQ-UX-005, ADR-0047): the selected
 * markers moved back or forward by a pixel of the view or by a sample, each
 * nudge giving the move that reverses it, as every marker command does. A
 * marker was moved only by dragging it, so a person without a pointer could not
 * reposition one at all.
 *
 * A nudge that would take any of the markers past either end of the asset moves
 * none of them, rather than stopping one at the end, so the move back always
 * returns every marker to where it was.
 */

import { unchanged, commandId, type Command, type UnchangedOutcome } from '@audiogubbins/commands';
import { sampleCount, type Marker, type MarkerId, type SampleCount } from '@audiogubbins/domain';
import { formatPosition, samplesWithin, type TimeFormat } from '@audiogubbins/timeline';

import type { EditorAsset } from '../assets/editor-asset.js';
import { editorTarget, numberArgument, type EditorTarget } from './editor-target.js';
import { assetOf, markerCommand, selectedMarkers, type Done } from './marker-commands.js';
import { markerIdsOf } from './selection-commands.js';
import { textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** Where each of `markers` goes when moved by `frames`, or why one cannot go. */
function destinations(
  asset: EditorAsset,
  markers: readonly Marker[],
  frames: number,
): readonly { readonly marker: Marker; readonly to: SampleCount }[] | string {
  const placed: { readonly marker: Marker; readonly to: SampleCount }[] = [];
  for (const marker of markers) {
    const to = sampleCount(marker.position + frames);
    if (!to.ok || to.value > asset.length) {
      return `${marker.displayName} is too near the ${frames < 0 ? 'start' : 'end'} of ${asset.name} to move that far.`;
    }
    placed.push({ marker, to: to.value });
  }
  return placed;
}

/** Moves the markers of `asset` named by `ids` by `frames`, and says how to move them back. */
function movedBy(
  context: ShellContext,
  asset: EditorAsset,
  format: TimeFormat,
  ids: readonly MarkerId[],
  frames: number,
): Done | UnchangedOutcome | string {
  if (frames === 0) return unchanged('editor.marker-there', 'The markers are there already.');
  const held = context.content.of(asset).markers;
  const markers = held.filter((marker) => ids.includes(marker.id));
  if (markers.length !== new Set(ids).size) return `Those markers are not all in ${asset.name}.`;
  const placed = destinations(asset, markers, frames);
  if (typeof placed === 'string') return placed;
  for (const { marker, to } of placed) {
    const moved = context.content.moveMarker(asset, marker.id, to);
    if (!moved.ok) return moved.failures[0].summary;
  }
  const [only] = placed;
  return {
    inverse: {
      commandId: commandId('editor.move-markers-by'),
      arguments: { asset: asset.id, markers: ids.join(','), frames: -frames },
    },
    description:
      placed.length === 1 && only !== undefined
        ? `${only.marker.displayName} moved to ${formatPosition(only.to, asset.sampleRate, format)}`
        : `${String(placed.length)} markers moved`,
  };
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
      const ids = selectedMarkers(context, target.asset);
      if (typeof ids === 'string') return ids;
      return movedBy(context, target.asset, target.state.timeFormat, ids, frames(target));
    },
    { keywords },
  );
}

/** The move a nudge is reversed by: the markers named, by a whole number of frames. */
function moveMarkersBy(): Command<ShellContext> {
  return markerCommand(
    'editor.move-markers-by',
    'Move markers by a distance',
    (context, invocation) => {
      const found = assetOf(context, invocation);
      if (typeof found === 'string') return found;
      const ids = markerIdsOf(textArgument(invocation, 'markers'));
      const frames = numberArgument(invocation, 'frames');
      if (ids.length === 0 || frames === undefined || !Number.isInteger(frames)) {
        return 'A move needs markers and a whole number of frames.';
      }
      return movedBy(context, found.asset, found.format, ids, frames);
    },
    { discoverable: false },
  );
}

/** A pixel of the view, in frames, in the direction given. */
const aPixel = (sign: -1 | 1) => (target: EditorTarget) =>
  sign * samplesWithin(target.state.viewport, 1);

/** The commands that nudge markers, and the move that reverses a nudge. */
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
