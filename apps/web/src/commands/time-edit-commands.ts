/**
 * The edits that change an asset's time or rate (REQ-AUDIO-018): inserting
 * generated silence, stretching a range to another length without changing
 * its pitch, and converting the asset to another sample rate (REQ-ARCH-085),
 * each run through the project's edit command as one change, which undo
 * reverses.
 *
 * Silence goes where a paste goes, over the selected range or in at the
 * playhead, and takes the asset's rate and channels. A stretch acts on the
 * selected range, or on the whole sound shown with nothing selected. A
 * conversion acts on the whole asset. Each changes time, so from a region's
 * view it changes the asset the region is part of, which is said.
 *
 * A value is read, never trusted, since a macro or a script can carry any:
 * one out of range is refused with the reason, never moved into range. A
 * stretch or a conversion asked for with no value opens the Inspector, where
 * the value is typed, since a command cannot open a dialogue and wait for it.
 * How finely a stretch is made is the render quality the person chose
 * (`QualityMode`), which every stretch is heard at, rather than a setting of
 * one edit.
 */

import { ENGINE_VERSIONS } from '@audiogubbins/audio-engine';
import {
  CommandCategory,
  unchanged,
  type Command,
  type CommandInvocation,
} from '@audiogubbins/commands';
import {
  MAXIMUM_STRETCH_RATIO,
  derivedSampleCount,
  sampleRate,
  secondsToSamples,
  shapesOf,
  silencePlan,
  type Asset,
  type EditShape,
  type SampleRate,
} from '@audiogubbins/domain';
import { formatPosition } from '@audiogubbins/timeline';
import { PanelKinds } from '@audiogubbins/workspace';

import { sampleRateWords } from '../wording.js';
import {
  RANGE_OR_WHOLE,
  editScope,
  editedView,
  insertionPlace,
  partOfTheChannels,
} from './edit-target.js';
import type { EditorTarget } from './editor-target.js';
import {
  chainInvocation,
  changeProject,
  needsProjectAsset,
  onWholeAsset,
} from './project-edits.js';
import { shellCommand, type BodyAnswer } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** How long the silence inserted is where the command names no length, in seconds. */
export const DEFAULT_SILENCE_SECONDS = 1;

/**
 * The sample rates the Inspector offers to convert to, lowest first: those
 * audio is commonly made at. A command may name any rate an asset may have.
 */
export const OFFERED_RATES: readonly number[] = [
  8_000, 11_025, 16_000, 22_050, 32_000, 44_100, 48_000, 88_200, 96_000, 176_400, 192_000, 352_800,
  384_000,
];

/** The timeline the asset's next edit acts on. */
function currentShape(asset: Asset): EditShape {
  const shape = shapesOf(asset).at(-1);
  if (shape === undefined) throw new Error('A chain always has a shape.');
  return shape;
}

/** A number of frames at `rate` as `view` speaks positions. */
function spoken(view: EditorTarget, frames: number, rate: SampleRate): string {
  return formatPosition(frames, rate, view.state.timeFormat);
}

/**
 * The positive number an invocation gives as `name`, `fallback` where it
 * gives none, or why what it gives is not one.
 */
function positiveArgument(
  invocation: CommandInvocation,
  name: string,
  what: string,
  fallback?: number,
): number | undefined | { readonly refused: string } {
  const value = invocation.arguments?.[name];
  if (value === undefined || value === null) return fallback;
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : { refused: `${what} is a number above zero.` };
}

/**
 * Brings the Inspector forward, where a value a command was not given is set,
 * and answers `asked`, which says what to set there. Where it cannot be
 * brought forward it is most often the panel in use already, and the answer
 * names it either way.
 */
function askInInspector(context: ShellContext, asked: string): string {
  const { workspace } = context;
  if (workspace.openingProblem(PanelKinds.Inspector) === undefined) {
    workspace.openPanel(PanelKinds.Inspector);
  }
  return asked;
}

function insertSilence(context: ShellContext, invocation: CommandInvocation): BodyAnswer {
  const seconds = positiveArgument(
    invocation,
    'seconds',
    'A length of silence',
    DEFAULT_SILENCE_SECONDS,
  );
  if (typeof seconds === 'object') return seconds.refused;
  const found = editedView(context, invocation);
  if (typeof found === 'string') return found;
  const { view, project } = found;
  const { owner, session } = project;
  const shape = currentShape(owner.asset);
  const frames = secondsToSamples(seconds ?? DEFAULT_SILENCE_SECONDS, shape.sampleRate);
  if (!frames.ok) return frames.failures[0].summary;
  if (frames.value === 0) {
    return `A length of silence is at least one frame, ${spoken(view, 1, shape.sampleRate)}.`;
  }
  const place = insertionPlace(context, view, owner);
  if (typeof place === 'string') return place;
  const asset = { asset: owner.asset.id };
  const at = place.kind === 'at' ? place.at : place.range.start;
  const insertion = chainInvocation(context, asset, {
    kind: 'insert',
    at,
    payload: silencePlan(shape.sampleRate, shape.layout, frames.value),
  });
  const length = spoken(view, frames.value, shape.sampleRate);
  changeProject(context, session, {
    description: 'Insert silence',
    invocations:
      place.kind === 'at'
        ? [insertion]
        : [chainInvocation(context, asset, { kind: 'delete', range: place.range }), insertion],
    said: onWholeAsset(
      owner,
      place.kind === 'at'
        ? `Inserted ${length} of silence into ${view.asset.name}.`
        : `Replaced the selection with ${length} of silence.`,
    ),
  });
  return undefined;
}

/** What a stretch is asked to make: a length in seconds, or a ratio of lengths. */
type StretchAsked =
  | { readonly kind: 'seconds'; readonly seconds: number }
  | { readonly kind: 'ratio'; readonly ratio: number };

/** What an invocation asks a stretch to make, `undefined` where it says nothing, or why it cannot. */
function stretchAsked(
  invocation: CommandInvocation,
): StretchAsked | undefined | { readonly refused: string } {
  const seconds = positiveArgument(invocation, 'seconds', 'A length to stretch to');
  const ratio = positiveArgument(invocation, 'ratio', 'A ratio to stretch by');
  if (typeof seconds === 'object') return seconds;
  if (typeof ratio === 'object') return ratio;
  if (seconds !== undefined && ratio !== undefined) {
    return { refused: 'Give a length to stretch to or a ratio to stretch by, not both.' };
  }
  if (seconds !== undefined) return { kind: 'seconds', seconds };
  return ratio === undefined ? undefined : { kind: 'ratio', ratio };
}

/** The frames a stretch of `before` frames at `rate` makes, as `asked`, or why it cannot. */
function stretchedLength(asked: StretchAsked, before: number, rate: SampleRate): number | string {
  if (asked.kind === 'ratio') return Math.round(before * asked.ratio);
  const frames = secondsToSamples(asked.seconds, rate);
  return frames.ok ? frames.value : frames.failures[0].summary;
}

function stretch(context: ShellContext, invocation: CommandInvocation): BodyAnswer {
  const asked = stretchAsked(invocation);
  if (asked === undefined) {
    return askInInspector(
      context,
      'Say the length to stretch to, or the ratio to stretch by. Type it in the Inspector, under Time and rate.',
    );
  }
  if ('refused' in asked) return asked.refused;
  const scope = editScope(context, invocation, RANGE_OR_WHOLE);
  if (typeof scope === 'string') return scope;
  const split = partOfTheChannels(scope);
  if (split !== undefined) return split;
  const { view, project } = scope;
  const { owner, session } = project;
  const rate = currentShape(owner.asset).sampleRate;
  const { range } = scope.target;
  const before = range.end - range.start;
  const length = stretchedLength(asked, before, rate);
  if (typeof length === 'string') return length;
  const shortest = Math.ceil(before / MAXIMUM_STRETCH_RATIO);
  const longest = before * MAXIMUM_STRETCH_RATIO;
  if (length < shortest || length > longest) {
    return `A stretch changes a length by at most ${String(MAXIMUM_STRETCH_RATIO)} times either way, so ${spoken(view, before, rate)} stretches to between ${spoken(view, shortest, rate)} and ${spoken(view, longest, rate)}.`;
  }
  if (length === before) {
    return unchanged(
      'edit.stretch-same-length',
      `That is ${spoken(view, before, rate)}, the length it is already, so nothing is stretched.`,
    );
  }
  const what = scope.whole
    ? `all of ${view.asset.name}`
    : `${spoken(view, before, rate)} of ${view.asset.name}`;
  changeProject(context, session, {
    description: 'Stretch',
    invocations: [
      chainInvocation(context, scope.target, {
        kind: 'stretch',
        range,
        length: derivedSampleCount(length),
        version: ENGINE_VERSIONS.stretch,
      }),
    ],
    said: onWholeAsset(owner, `Stretched ${what} to ${spoken(view, length, rate)}.`),
  });
  return undefined;
}

function convertRate(context: ShellContext, invocation: CommandInvocation): BodyAnswer {
  const given = invocation.arguments?.['rate'];
  if (given === undefined || given === null) {
    return askInInspector(
      context,
      'Say the sample rate to convert to. Choose it in the Inspector, under Time and rate.',
    );
  }
  if (typeof given !== 'number') return 'A sample rate is a whole number of hertz, such as 48000.';
  const rate = sampleRate(given);
  if (!rate.ok) return rate.failures[0].summary;
  const found = editedView(context, invocation);
  if (typeof found === 'string') return found;
  const { owner, session } = found.project;
  const name = owner.asset.displayName;
  const from = currentShape(owner.asset).sampleRate;
  if (from === rate.value) {
    return unchanged(
      'edit.rate-already',
      `${name} is at ${sampleRateWords(from)} already, so there is nothing to convert.`,
    );
  }
  changeProject(context, session, {
    description: 'Convert the sample rate',
    invocations: [
      chainInvocation(
        context,
        { asset: owner.asset.id },
        { kind: 'convert-rate', sampleRate: rate.value, version: ENGINE_VERSIONS.resampler },
      ),
    ],
    said: onWholeAsset(
      owner,
      `Converted ${name} from ${sampleRateWords(from)} to ${sampleRateWords(rate.value)}.`,
    ),
  });
  return undefined;
}

/** A command that changes the time or rate of the asset of the editor in use. */
function timeCommand(
  id: string,
  label: string,
  run: (context: ShellContext, invocation: CommandInvocation) => BodyAnswer,
  keywords: readonly string[],
  description: string,
): Command<ShellContext> {
  return shellCommand(id, label, CommandCategory.Edit, run, {
    availability: needsProjectAsset,
    keywords,
    description,
  });
}

/** Inserting silence, stretching, and converting the sample rate. */
export function timeEditCommands(): readonly Command<ShellContext>[] {
  return [
    timeCommand(
      'edit.insert-silence',
      'Insert silence',
      insertSilence,
      ['silence', 'insert', 'gap', 'pause', 'generate', 'blank'],
      `Inserts silence at the playhead, or in place of the selected range, at the audio’s own rate and channels: ${String(DEFAULT_SILENCE_SECONDS)} second of it, or the length named in seconds (seconds).`,
    ),
    timeCommand(
      'edit.stretch',
      'Stretch to another length',
      stretch,
      ['stretch', 'time stretch', 'tempo', 'speed', 'length', 'slower', 'faster'],
      `Makes the selected range, or the whole sound with nothing selected, another length without changing its pitch: a length in seconds (seconds) or a ratio of the new length to the old (ratio), at most ${String(MAXIMUM_STRETCH_RATIO)} times longer or shorter. It is heard at the render quality chosen in the audio settings.`,
    ),
    timeCommand(
      'edit.convert-rate',
      'Convert the sample rate',
      convertRate,
      ['sample rate', 'resample', 'convert', 'rate', 'hertz', 'kHz'],
      'Converts the whole asset to another sample rate, in hertz (rate), by the canonical resampler. Every edit, marker and region keeps its place in the sound.',
    ),
  ];
}
