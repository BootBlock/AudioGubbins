/**
 * The playhead of an asset (REQ-EDIT-012): setting it, moving it by a sample
 * or a pixel, sending it to either end, and playing the asset from it.
 *
 * An asset's playhead is where the transport is while the transport holds the
 * asset, and where it is parked otherwise (`cue-store.ts`); setting it moves
 * both, so the next Play starts where the person put it and a moving transport
 * goes on from there. A move the view cannot show brings the view to it.
 */

import { CommandCategory, unchanged, type Command } from '@audiogubbins/commands';
import { AUDIO_PLAYBACK } from '@audiogubbins/capabilities';
import { ZERO_SAMPLES, sampleCount, type SampleCount } from '@audiogubbins/domain';
import { TransportMode } from '@audiogubbins/audio-engine';
import { centredOn, pixelOf, samplesWithin } from '@audiogubbins/timeline';

import { assetProgramme } from '../audio/asset-playback.js';
import { modeOf, needing } from './audio-commands.js';
import {
  boundaryArgument,
  editorTarget,
  focusedEditor,
  needsEditor,
  parkHeld,
  playheadOf,
  type EditorTarget,
} from './editor-target.js';
import { shellCommand, type ShellCommandOptions } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** Moves `target`'s playhead to `position`, and brings the view to it where it is out of sight. */
export function setPlayhead(
  context: ShellContext,
  target: EditorTarget,
  position: SampleCount,
): void {
  context.cues.park(target.asset.id, position);
  context.playback.seek(target.asset.id, position);
  const { viewport } = target.state;
  const x = pixelOf(viewport, position);
  if (x < 0 || x > viewport.width) {
    context.editorViews.change(target.panel, (state) => ({
      ...state,
      viewport: centredOn(state.viewport, position, target.asset.length),
    }));
  }
}

type Destination = (
  target: EditorTarget,
  from: SampleCount,
  invocation: Parameters<Command<ShellContext>['run']>[1],
) => SampleCount | string;

function playheadCommand(
  id: string,
  label: string,
  destination: Destination,
  extra: ShellCommandOptions = {},
): Command<ShellContext> {
  return shellCommand(
    id,
    label,
    CommandCategory.Transport,
    (context, invocation) => {
      const target = editorTarget(context, invocation);
      if (typeof target === 'string') return target;
      const from = playheadOf(context, target.asset);
      const to = destination(target, from, invocation);
      if (typeof to === 'string') return to;
      if (to === from)
        return unchanged('editor.playhead-unchanged', 'The playhead is there already.');
      setPlayhead(context, target, to);
      return undefined;
    },
    { availability: needsEditor, ...extra },
  );
}

/** `from` moved by `frames`, kept within the asset. */
function movedBy(target: EditorTarget, from: SampleCount, frames: number): SampleCount {
  const read = sampleCount(Math.min(target.asset.length, Math.max(0, from + frames)));
  return read.ok ? read.value : from;
}

function playAsset(): Command<ShellContext> {
  return shellCommand(
    'transport.play',
    'Play',
    CommandCategory.Transport,
    (context) => {
      const target = focusedEditor(context);
      if (typeof target === 'string') return target;
      const holds = context.playback.programme() === target.asset.id;
      if (!holds) parkHeld(context);
      // Said by the playback once the audio is heard, or its reason if not.
      context.playback.play(
        assetProgramme(target.asset, context.hearing.get()),
        holds ? undefined : context.cues.of(target.asset.id),
      );
      return undefined;
    },
    {
      keywords: ['play', 'start', 'listen', 'asset', 'transport'],
      description: 'Plays the asset in the editor in use from its playhead, at its own rate.',
      availability: needing(AUDIO_PLAYBACK, (context) => {
        const target = focusedEditor(context);
        if (typeof target === 'string') return target;
        if (context.audio.get().starting) return 'Playback is starting.';
        return modeOf(context) === TransportMode.Playing &&
          context.playback.programme() === target.asset.id
          ? `${target.asset.name} is already playing.`
          : undefined;
      }),
    },
  );
}

/** The commands that move the playhead, and Play. */
export function playheadCommands(): readonly Command<ShellContext>[] {
  return [
    playAsset(),
    playheadCommand(
      'editor.set-playhead',
      'Set the playhead',
      ({ asset }, _from, invocation) =>
        boundaryArgument(invocation, 'position', asset) ??
        'The playhead needs a position within the asset.',
      { discoverable: false },
    ),
    playheadCommand(
      'editor.playhead-back-pixel',
      'Move the playhead back',
      (target, from) => movedBy(target, from, -samplesWithin(target.state.viewport, 1)),
      { keywords: ['playhead', 'cursor', 'back', 'left', 'nudge', 'pixel'] },
    ),
    playheadCommand(
      'editor.playhead-forward-pixel',
      'Move the playhead forward',
      (target, from) => movedBy(target, from, samplesWithin(target.state.viewport, 1)),
      { keywords: ['playhead', 'cursor', 'forward', 'right', 'nudge', 'pixel'] },
    ),
    playheadCommand(
      'editor.playhead-back-sample',
      'Move the playhead back one sample',
      (target, from) => movedBy(target, from, -1),
      { keywords: ['playhead', 'cursor', 'back', 'sample', 'exact'] },
    ),
    playheadCommand(
      'editor.playhead-forward-sample',
      'Move the playhead forward one sample',
      (target, from) => movedBy(target, from, 1),
      { keywords: ['playhead', 'cursor', 'forward', 'sample', 'exact'] },
    ),
    playheadCommand(
      'editor.playhead-to-start',
      'Move the playhead to the start',
      () => ZERO_SAMPLES,
      { keywords: ['playhead', 'start', 'beginning', 'home'] },
    ),
    playheadCommand(
      'editor.playhead-to-end',
      'Move the playhead to the end',
      ({ asset }) => asset.length,
      { keywords: ['playhead', 'end', 'finish'] },
    ),
  ];
}
