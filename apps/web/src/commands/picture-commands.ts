/**
 * The reference picture's commands (REQ-AUDIO-156, ADR-0046): opening a file
 * beside the audio, binding it to an asset's timeline, the frame-rate
 * interpretation, calibrating its offset by frames or by lining a frame up with
 * the playhead, a marker at the frame shown, full screen, and its own sound
 * opened as an asset.
 *
 * None changes the audio or its content except the marker, which is the marker
 * commands' own step and reverses as they do. The picture is reference media:
 * closing it, or a file the browser cannot decode, leaves the asset and its
 * editor as they were.
 */

import {
  AVAILABLE,
  CommandCategory,
  unavailable,
  unchanged,
  type Command,
  type CommandAvailability,
} from '@audiogubbins/commands';
import { FeatureStatus, FULL_SCREEN_PICTURE } from '@audiogubbins/capabilities';
import { sampleCount } from '@audiogubbins/domain';
import {
  StandardFrameRates,
  frameRatesEqual,
  framesPerSecond,
  type FrameRate,
} from '@audiogubbins/timeline';
import { frameBoundary, pictureFrameAt, pictureTimecodeAt } from '@audiogubbins/video-reference';

import type { EditorAsset } from '../assets/editor-asset.js';
import { focusedEditor, playheadOf } from './editor-target.js';
import { addedMarker, markerCommand } from './marker-commands.js';
import { availableUnless, shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The frame rates offered, by what a person calls them, in the order offered. */
export const FRAME_RATES: readonly {
  readonly key: string;
  readonly name: string;
  readonly rate: FrameRate;
}[] = [
  { key: 'film', name: '24', rate: StandardFrameRates.film },
  { key: 'film-pulled-down', name: '23.976', rate: StandardFrameRates.filmPulledDown },
  { key: 'pal', name: '25', rate: StandardFrameRates.pal },
  { key: 'ntsc-drop-frame', name: '29.97 drop-frame', rate: StandardFrameRates.ntscDropFrame },
  { key: 'ntsc', name: '29.97', rate: StandardFrameRates.ntscNonDrop },
  { key: 'thirty', name: '30', rate: StandardFrameRates.thirty },
  { key: 'pal-double', name: '50', rate: StandardFrameRates.palDouble },
  {
    key: 'ntsc-double-drop-frame',
    name: '59.94 drop-frame',
    rate: StandardFrameRates.ntscDoubleDropFrame,
  },
  { key: 'ntsc-double', name: '59.94', rate: StandardFrameRates.ntscDoubleNonDrop },
  { key: 'sixty', name: '60', rate: StandardFrameRates.sixty },
];

/** The asset the picture is bound to, or why there is none. */
function boundAsset(context: ShellContext): EditorAsset | string {
  const { media, asset } = context.picture.get();
  if (media.kind !== 'ready') return 'No reference picture is open. Open one in the Picture panel.';
  const found = asset === undefined ? undefined : context.assets.find(asset);
  return found ?? 'The picture is not bound to an open asset. Bind it to the editor in use.';
}

function needsBound(context: ShellContext): CommandAvailability {
  const bound = boundAsset(context);
  return typeof bound === 'string' ? unavailable(bound) : AVAILABLE;
}

function needsPicture(context: ShellContext): CommandAvailability {
  return context.picture.get().media.kind === 'none'
    ? unavailable('No reference picture is open.')
    : AVAILABLE;
}

/**
 * The file whose sound can be extracted now, or why none can: a picture opened,
 * whose sound is neither on its way nor open already, and that fits in the
 * memory the page can spare.
 */
function soundSource(context: ShellContext): File | string {
  const { media, sound } = context.picture.get();
  const { file } = context.picture;
  if (media.kind !== 'ready' || file === undefined) return 'No reference picture is open.';
  if (sound.kind === 'decoding') return 'The picture’s sound is being extracted.';
  if (sound.kind === 'decoded') return 'The picture’s sound is open as an asset already.';
  return context.pictureSound.refusal(file, media.duration) ?? file;
}

function openCommand(): Command<ShellContext> {
  return shellCommand(
    'picture.open',
    'Open a reference picture',
    CommandCategory.File,
    (context, invocation) => {
      const token = textArgument(invocation, 'file');
      const file = token === undefined ? undefined : context.chosenFiles.take(token);
      if (file === undefined) return 'Choose a video file in the Picture panel to open it.';
      const target = focusedEditor(context);
      context.pictureSound.abandon();
      context.picture.open(file, typeof target === 'string' ? undefined : target.asset);
      context.interaction.announce(`Opening ${file.name} as the reference picture.`);
      return undefined;
    },
    { discoverable: false },
  );
}

function bindingCommands(): readonly Command<ShellContext>[] {
  return [
    shellCommand(
      'picture.close',
      'Close the reference picture',
      CommandCategory.File,
      (context) => {
        context.pictureSound.abandon();
        context.picture.close();
        context.interaction.announce('The reference picture is closed.');
      },
      { keywords: ['picture', 'video', 'close', 'reference'], availability: needsPicture },
    ),
    shellCommand(
      'picture.bind-to-editor',
      'Bind the picture to the editor in use',
      CommandCategory.View,
      (context) => {
        const target = focusedEditor(context);
        if (typeof target === 'string') return target;
        if (context.picture.get().asset === target.asset.id) {
          return unchanged('picture.bound-already', 'The picture is bound to that asset already.');
        }
        context.picture.bind(target.asset);
        context.interaction.announce(`The picture follows ${target.asset.name}.`);
        return undefined;
      },
      {
        keywords: ['picture', 'video', 'bind', 'sync', 'asset'],
        availability: (context) => {
          const picture = needsPicture(context);
          if (!picture.available) return picture;
          const target = focusedEditor(context);
          return typeof target === 'string' ? unavailable(target) : AVAILABLE;
        },
      },
    ),
  ];
}

function frameRateCommands(): readonly Command<ShellContext>[] {
  return [
    ...FRAME_RATES.map(({ key, name, rate }) =>
      shellCommand(
        `picture.frame-rate-${key}`,
        `Count the picture at ${name} frames a second`,
        CommandCategory.View,
        (context) => {
          const { binding } = context.picture.get();
          if (binding !== undefined && frameRatesEqual(binding.frames, rate)) {
            return unchanged('picture.rate-already', `The picture is counted at ${name} already.`);
          }
          context.picture.interpretAt(rate);
          context.interaction.announce(
            `The picture is counted at ${name} frames a second, ${framesPerSecond(rate).toFixed(3)} exactly.`,
          );
          return undefined;
        },
        { keywords: ['picture', 'frame', 'rate', 'fps', name], availability: needsBound },
      ),
    ),
  ];
}

function nudge(id: string, label: string, frames: number): Command<ShellContext> {
  return shellCommand(
    id,
    label,
    CommandCategory.View,
    (context) => {
      context.picture.nudge(frames);
      context.interaction.announce(
        frames > 0 ? 'The picture is a frame later.' : 'The picture is a frame earlier.',
      );
    },
    { keywords: ['picture', 'nudge', 'offset', 'calibrate', 'frame'], availability: needsBound },
  );
}

function calibrationCommands(): readonly Command<ShellContext>[] {
  return [
    nudge('picture.nudge-later', 'Move the picture a frame later', 1),
    nudge('picture.nudge-earlier', 'Move the picture a frame earlier', -1),
    shellCommand(
      'picture.align-with-playhead',
      'Line this frame up with the playhead',
      CommandCategory.View,
      (context) => {
        const asset = boundAsset(context);
        if (typeof asset === 'string') return asset;
        const before = context.picture.get().binding?.offset;
        context.picture.alignWith(playheadOf(context, asset));
        if (context.picture.get().binding?.offset === before) {
          return unchanged('picture.aligned-already', 'That frame starts at the playhead already.');
        }
        context.interaction.announce('The frame shown now starts at the playhead.');
        return undefined;
      },
      { keywords: ['picture', 'align', 'sync', 'calibrate', 'offset'], availability: needsBound },
    ),
  ];
}

/**
 * Extracts the picture's sound as an asset. Asked for rather than done on
 * opening, because the file is read whole and its sound held whole: it is
 * weighed against the memory the page can spare first, and refused with the
 * reason past it.
 */
function extractSoundCommand(): Command<ShellContext> {
  return shellCommand(
    'picture.extract-sound',
    'Open the picture’s sound as an asset',
    CommandCategory.File,
    (context) => {
      const file = soundSource(context);
      if (typeof file === 'string') return file;
      context.pictureSound.decode(file);
      context.interaction.announce(`Extracting the sound of ${file.name}.`);
      return undefined;
    },
    {
      keywords: ['picture', 'video', 'sound', 'audio', 'extract', 'asset'],
      availability: (context) => {
        const file = soundSource(context);
        return availableUnless(typeof file === 'string' ? file : undefined);
      },
    },
  );
}

function fullScreenCommand(): Command<ShellContext> {
  return shellCommand(
    'picture.full-screen',
    'Show the picture full screen',
    CommandCategory.View,
    (context) => {
      void context.picture.enlarge().then((refused) => {
        if (refused !== undefined) context.interaction.announce(refused, true);
      });
    },
    {
      keywords: ['picture', 'video', 'full', 'screen', 'enlarge'],
      availability: (context) => {
        const feature = context.capabilities.featureAvailability(FULL_SCREEN_PICTURE);
        if (feature.status === FeatureStatus.Unavailable) return unavailable(feature.explanation);
        return context.picture.get().media.kind === 'ready'
          ? AVAILABLE
          : unavailable('No reference picture is open.');
      },
    },
  );
}

function markFrameCommand(): Command<ShellContext> {
  return markerCommand(
    'picture.mark-frame',
    'Add a marker at this frame',
    (context) => {
      const asset = boundAsset(context);
      if (typeof asset === 'string') return asset;
      const { binding } = context.picture.get();
      if (binding === undefined) return 'The picture is not bound to an asset.';
      const at = playheadOf(context, asset);
      const frame = pictureFrameAt(binding, at);
      const start = sampleCount(Math.min(asset.length, Math.max(0, frameBoundary(binding, frame))));
      if (!start.ok) return 'This frame starts outside the asset.';
      return addedMarker(
        context,
        asset,
        { kind: 'timecode', frames: binding.frames },
        start.value,
        {
          name: `Frame ${pictureTimecodeAt(binding, start.value)}`,
        },
      );
    },
    { keywords: ['picture', 'marker', 'frame', 'mark', 'hit'], availability: needsBound },
  );
}

/** The commands of the reference picture. */
export function pictureCommands(): readonly Command<ShellContext>[] {
  return [
    openCommand(),
    ...bindingCommands(),
    ...frameRateCommands(),
    ...calibrationCommands(),
    extractSoundCommand(),
    fullScreenCommand(),
    markFrameCommand(),
  ];
}
