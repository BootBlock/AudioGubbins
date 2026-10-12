/**
 * A view's options: what it draws over the audio, what it snaps to
 * (REQ-EDIT-013), the format it writes positions in (REQ-EDIT-012), whether
 * it follows the playhead, and how its spectral tools draw
 * (`spectral-tool-commands.ts`). Each is the view's own (REQ-EDIT-061),
 * changed through the builder the presentation commands use.
 */

import { CommandCategory, type Command } from '@audiogubbins/commands';
import {
  FollowMode,
  type EditorViewState,
  type Overlays,
  type SpectralSettings,
} from '@audiogubbins/editor-view';
import {
  SnapKind,
  StandardFrameRates,
  TimeFormatKind,
  frameRatesEqual,
  type TimeFormat,
} from '@audiogubbins/timeline';

import { frequencyWords } from '../wording.js';
import { presentationCommand } from './editor-presentation-commands.js';
import { spectrogramCommands } from './spectrogram-commands.js';
import { spectralToolCommands } from './spectral-tool-commands.js';
import type { ShellContext } from './shell-context.js';

/** What each overlay is called. */
const OVERLAYS: Readonly<Record<keyof Overlays, string>> = {
  grid: 'Grid',
  rms: 'Loudness (RMS)',
  clipping: 'Clipping',
  markers: 'Markers',
  regions: 'Regions',
  filmstrip: 'Picture strip',
  spectralEdits: 'Spectral edit outlines',
};

const OVERLAY_ORDER: readonly (keyof Overlays)[] = [
  'grid',
  'rms',
  'clipping',
  'markers',
  'regions',
  'filmstrip',
  'spectralEdits',
];

/** What each snap target is called. */
const SNAP_KINDS: Readonly<Record<SnapKind, string>> = {
  [SnapKind.Marker]: 'Markers',
  [SnapKind.RegionBoundary]: 'Region boundaries',
  [SnapKind.LoopBoundary]: 'Loop boundaries',
  [SnapKind.SelectionEdge]: 'Selection edges',
  [SnapKind.Playhead]: 'Playhead',
  [SnapKind.Frame]: 'Picture frames',
  [SnapKind.ZeroCrossing]: 'Zero crossings',
  [SnapKind.Grid]: 'Grid',
};

/** What each time format is called. */
export const TIME_FORMATS: Readonly<Record<TimeFormatKind, string>> = {
  [TimeFormatKind.Clock]: 'Minutes and seconds',
  [TimeFormatKind.Milliseconds]: 'Milliseconds',
  [TimeFormatKind.Samples]: 'Samples',
  [TimeFormatKind.Timecode]: 'Timecode',
};

/** What each follow mode is called. */
const FOLLOW_MODES: Readonly<Record<FollowMode, string>> = {
  [FollowMode.Off]: 'Do not follow the playhead',
  [FollowMode.Page]: 'Follow the playhead a page at a time',
  [FollowMode.Centre]: 'Keep the playhead in the middle',
};

/** A time format of `kind`, timecode at the reference picture's rate or 25 frames a second. */
function formatOf(kind: TimeFormatKind, context: ShellContext): TimeFormat {
  if (kind !== TimeFormatKind.Timecode) return { kind };
  return { kind, frames: context.picture.get().binding?.frames ?? StandardFrameRates.pal };
}

function sameFormat(one: TimeFormat, other: TimeFormat): boolean {
  if (one.kind !== TimeFormatKind.Timecode || other.kind !== TimeFormatKind.Timecode) {
    return one.kind === other.kind;
  }
  return frameRatesEqual(one.frames, other.frames);
}

function snappingCommands(): readonly Command<ShellContext>[] {
  return [
    presentationCommand(
      'editor.toggle-snapping',
      'Snapping',
      CommandCategory.View,
      (state) => ({ ...state, snapping: { ...state.snapping, enabled: !state.snapping.enabled } }),
      (state) => (state.snapping.enabled ? 'Snapping is on.' : 'Snapping is off.'),
      { keywords: ['snap', 'snapping', 'magnet', 'align'] },
    ),
    ...Object.values(SnapKind).map((kind) =>
      presentationCommand(
        `editor.snap-${kind}`,
        `Snap to ${SNAP_KINDS[kind].toLowerCase()}`,
        CommandCategory.View,
        (state) => {
          const kinds = new Set(state.snapping.kinds);
          if (kinds.has(kind)) kinds.delete(kind);
          else kinds.add(kind);
          return { ...state, snapping: { ...state.snapping, kinds } };
        },
        (state) =>
          `${SNAP_KINDS[kind]} ${state.snapping.kinds.has(kind) ? 'are' : 'are not'} snapped to.`,
        { keywords: ['snap', SNAP_KINDS[kind].toLowerCase()] },
      ),
    ),
  ];
}

/** A capital letter, where an overlay's name joins two words. */
const CAPITAL = /[A-Z]/g;

/** An overlay's name as a command identifier writes it: `spectralEdits` as `spectral-edits`. */
function identifierOf(overlay: keyof Overlays): string {
  return overlay.replace(CAPITAL, (letter) => `-${letter.toLowerCase()}`);
}

function overlayCommands(): readonly Command<ShellContext>[] {
  return [
    ...OVERLAY_ORDER.map((overlay) =>
      presentationCommand(
        `editor.overlay-${identifierOf(overlay)}`,
        `Show ${OVERLAYS[overlay].toLowerCase()}`,
        CommandCategory.View,
        (state) => ({
          ...state,
          overlays: { ...state.overlays, [overlay]: !state.overlays[overlay] },
        }),
        (state) => `${OVERLAYS[overlay]} ${state.overlays[overlay] ? 'shown' : 'hidden'}.`,
        { keywords: ['overlay', 'show', 'hide', OVERLAYS[overlay].toLowerCase()] },
      ),
    ),
  ];
}

function timeFormatCommands(): readonly Command<ShellContext>[] {
  return [
    ...Object.values(TimeFormatKind).map((kind) =>
      presentationCommand(
        `editor.time-format-${kind}`,
        `Write times as ${TIME_FORMATS[kind].toLowerCase()}`,
        CommandCategory.View,
        (state, _target, _invocation, context) => {
          const format = formatOf(kind, context);
          return sameFormat(format, state.timeFormat) ? state : { ...state, timeFormat: format };
        },
        () => `Times are written as ${TIME_FORMATS[kind].toLowerCase()}.`,
        { keywords: ['time', 'format', 'ruler', TIME_FORMATS[kind].toLowerCase()] },
      ),
    ),
  ];
}

function followCommands(): readonly Command<ShellContext>[] {
  return [
    ...Object.values(FollowMode).map((follow) =>
      presentationCommand(
        `editor.follow-${follow}`,
        FOLLOW_MODES[follow],
        CommandCategory.View,
        (state) => (state.follow === follow ? state : { ...state, follow }),
        () => `${FOLLOW_MODES[follow]}.`,
        { keywords: ['follow', 'playhead', 'scroll', 'page', 'centre'] },
      ),
    ),
  ];
}

/** The lowest frequency a logarithmic scale reaches, which cannot start at nothing. */
const LOWEST_LOGARITHMIC = 20;

/** The top of hearing, where the audible band ends. */
const HIGHEST_AUDIBLE = 20_000;

/** `settings` with its band, and its lowest frequency kept above nothing on a logarithmic scale. */
function withBand(settings: SpectralSettings, lowest: number, highest: number): SpectralSettings {
  const floor = settings.frequencyScale === 'logarithmic' ? LOWEST_LOGARITHMIC : 0;
  return { ...settings, lowest: Math.max(floor, lowest), highest };
}

function sameSpectral(one: SpectralSettings, other: SpectralSettings): boolean {
  return (
    one.frequencyScale === other.frequencyScale &&
    one.lowest === other.lowest &&
    one.highest === other.highest
  );
}

/**
 * A view's spectral settings (REQ-EDIT-061, REQ-EDIT-062): the frequency
 * scale of its spectrogram lanes and the band they show, from all the asset
 * holds up to half its rate, or the audible part of it.
 */
function spectralCommands(): readonly Command<ShellContext>[] {
  const changed = (state: EditorViewState, spectral: SpectralSettings): EditorViewState =>
    sameSpectral(spectral, state.spectral) ? state : { ...state, spectral };
  const said = (state: EditorViewState): string =>
    `The spectrogram shows ${frequencyWords(state.spectral.lowest)} to ${frequencyWords(state.spectral.highest)}, ${state.spectral.frequencyScale}.`;
  return [
    ...(['linear', 'logarithmic'] as const).map((scale) =>
      presentationCommand(
        `editor.spectral-scale-${scale}`,
        `Space the spectrogram's frequencies ${scale === 'linear' ? 'evenly' : 'by octave'}`,
        CommandCategory.View,
        (state) => {
          const spectral = withBand(
            { ...state.spectral, frequencyScale: scale },
            state.spectral.lowest,
            state.spectral.highest,
          );
          return changed(state, spectral);
        },
        said,
        { keywords: ['spectrogram', 'frequency', 'scale', scale, 'octave'] },
      ),
    ),
    presentationCommand(
      'editor.spectral-band-whole',
      'Show every frequency in the spectrogram',
      CommandCategory.View,
      (state, { asset }) => changed(state, withBand(state.spectral, 0, asset.sampleRate / 2)),
      said,
      { keywords: ['spectrogram', 'frequency', 'band', 'range', 'nyquist', 'whole'] },
    ),
    presentationCommand(
      'editor.spectral-band-audible',
      'Show the audible frequencies in the spectrogram',
      CommandCategory.View,
      (state, { asset }) =>
        changed(
          state,
          withBand(
            state.spectral,
            LOWEST_LOGARITHMIC,
            Math.min(HIGHEST_AUDIBLE, asset.sampleRate / 2),
          ),
        ),
      said,
      { keywords: ['spectrogram', 'frequency', 'band', 'range', 'audible', 'hearing'] },
    ),
  ];
}

/** The commands that change a view's options. */
export function editorOptionCommands(): readonly Command<ShellContext>[] {
  return [
    ...snappingCommands(),
    ...overlayCommands(),
    ...timeFormatCommands(),
    ...followCommands(),
    ...spectralCommands(),
    ...spectrogramCommands(),
    ...spectralToolCommands(),
  ];
}
