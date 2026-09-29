/**
 * Audio described for another thread to make its source from.
 *
 * A source object cannot cross a thread, so the thread that has the audio
 * describes it and the thread that reads it makes the source (ADR-0045): a
 * render worker and the feeder for a graph's inputs, the peak worker for a
 * waveform. Audio in memory crosses as its planar arrays, transferred rather
 * than copied, so a long clip is never held twice; generated audio crosses as
 * its signal recipe. No layout crosses with either: the receiving thread knows
 * the layout it reads in, and a description whose channels do not fit it is
 * refused when the source is made.
 *
 * One reader, {@link pcmDescription}, validates a description that crossed a
 * thread, whoever sent it.
 */

import {
  FailureKind,
  fail,
  failure,
  flatMapResult,
  sampleCount,
  sampleRate,
  succeed,
  type ChannelLayout,
  type DomainFailure,
  type DomainResult,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';

import type { CanonicalDsp } from '../dsp/canonical-dsp.js';
import { frameBlock } from './frame-block.js';
import { memorySource } from './memory-source.js';
import type { PcmSource } from './pcm-source.js';
import { signalRecipe, type SignalRecipe } from './signal-recipe.js';
import { signalSource } from './signal-source.js';

/** How audio is described. */
export const PcmDescriptionKind = {
  /** Audio in memory: a decoded clip's planar samples. */
  Pcm: 'pcm',
  /** Generated audio, which the receiving thread makes from its recipe. */
  Signal: 'signal',
} as const;

export type PcmDescriptionKind = (typeof PcmDescriptionKind)[keyof typeof PcmDescriptionKind];

/** Audio, as it crosses to the thread that reads it. */
export type PcmDescription =
  | {
      readonly kind: typeof PcmDescriptionKind.Pcm;
      readonly sampleRate: SampleRate;
      /**
       * One array per channel, in the layout's order, all the same length.
       * Transferred: the sender's arrays are detached once posted.
       */
      readonly channels: readonly Float32Array[];
    }
  | {
      readonly kind: typeof PcmDescriptionKind.Signal;
      readonly sampleRate: SampleRate;
      readonly recipe: SignalRecipe;
    };

/** A description that could not be read: the part that was wrong, and what it should be. */
function unreadable(part: string, expected: string): DomainFailure {
  return failure(
    'pcm.description-unreadable',
    FailureKind.Rejected,
    `The description's ${part} is not ${expected}.`,
    { details: { part, expected } },
  );
}

type Fields = Readonly<Record<string, unknown>>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a value is a `Float32Array`, by its tag: a structured clone is made
 * in the receiving realm, whose class `instanceof` would not recognise.
 */
function isSamples(value: unknown): value is Float32Array {
  return Object.prototype.toString.call(value) === '[object Float32Array]';
}

function channelsOf(value: unknown): DomainResult<readonly Float32Array[]> {
  if (!Array.isArray(value) || !value.every(isSamples)) {
    return fail(unreadable('channels', 'a list of sample arrays'));
  }
  const [first] = value;
  if (first !== undefined && value.some((channel) => channel.length !== first.length)) {
    return fail(unreadable('channels', 'a list of sample arrays of one length'));
  }
  return succeed(value);
}

/** A description read from a value of any shape, or the part of it that is wrong. */
export function pcmDescription(value: unknown): DomainResult<PcmDescription> {
  if (!isFields(value)) return fail(unreadable('description', 'an object with named fields'));
  const rate =
    typeof value['sampleRate'] === 'number' ? sampleRate(value['sampleRate']) : undefined;
  if (rate?.ok !== true) return fail(unreadable('sampleRate', 'a sample rate'));
  switch (value['kind']) {
    case PcmDescriptionKind.Pcm:
      return flatMapResult(channelsOf(value['channels']), (channels) =>
        succeed({ kind: PcmDescriptionKind.Pcm, sampleRate: rate.value, channels }),
      );
    case PcmDescriptionKind.Signal: {
      const recipe = signalRecipe(value['recipe']);
      return recipe.ok
        ? succeed({ kind: PcmDescriptionKind.Signal, sampleRate: rate.value, recipe: recipe.value })
        : fail(unreadable('recipe', `a signal recipe (${recipe.failures[0].summary})`));
    }
    default:
      return fail(unreadable('kind', `one of ${Object.values(PcmDescriptionKind).join(', ')}`));
  }
}

/** The frames the described audio lasts. */
export function describedLength(description: PcmDescription): DomainResult<SampleCount> {
  return description.kind === PcmDescriptionKind.Signal
    ? succeed(description.recipe.length)
    : sampleCount(description.channels[0]?.length ?? 0);
}

/** The source of the described audio in `layout`, made with `dsp`, or why it cannot be made. */
export function describedSource(
  description: PcmDescription,
  layout: ChannelLayout,
  dsp: CanonicalDsp,
): DomainResult<PcmSource> {
  switch (description.kind) {
    case PcmDescriptionKind.Pcm:
      return flatMapResult(
        frameBlock(layout, description.sampleRate, description.channels),
        memorySource,
      );
    case PcmDescriptionKind.Signal:
      return signalSource(dsp, {
        layout,
        sampleRate: description.sampleRate,
        recipe: description.recipe,
      });
  }
}

/**
 * Each distinct buffer behind the described arrays, to transfer rather than
 * copy. A shared buffer is not transferred but shared, and two channels that
 * view one buffer must be listed once, or the post is refused.
 */
export function describedBuffers(descriptions: readonly PcmDescription[]): readonly ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const description of descriptions) {
    if (description.kind !== PcmDescriptionKind.Pcm) continue;
    for (const channel of description.channels) {
      if (channel.buffer instanceof ArrayBuffer) buffers.add(channel.buffer);
    }
  }
  return [...buffers];
}
