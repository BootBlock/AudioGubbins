/**
 * A source that makes a signal recipe's frames on demand.
 *
 * Any frame is made directly: the segment it falls in is found by a binary
 * search of the channel's programme, and a tone's oscillator is moved to the
 * frame's offset in its segment, so a read at the fourth hour costs what a read
 * at the first does and gives the bits a read from the start would (ADR-0045).
 * One oscillator is made for each distinct tone of the recipe, once, and shared
 * by every segment and channel that plays it.
 */

import {
  FailureKind,
  channelCount,
  fail,
  failure,
  succeed,
  throwIfCancelled,
  type ChannelLayout,
  type DomainFailure,
  type DomainResult,
  type SampleRate,
} from '@audiogubbins/domain';

import type { CanonicalDsp, CanonicalOscillator } from '../dsp/canonical-dsp.js';
import { assertReadableInto, framesAvailable, type PcmSource } from './pcm-source.js';
import {
  programmeLength,
  type ChannelProgramme,
  type SignalRecipe,
  type SignalSegment,
} from './signal-recipe.js';

/** How the signal is made. */
export interface SignalSettings {
  readonly layout: ChannelLayout;
  readonly sampleRate: SampleRate;
  readonly recipe: SignalRecipe;
}

/** The most distinct tones one source makes an oscillator for. */
const MAXIMUM_TONES = 1024;

/** A channel's programme, with where each segment starts in one pass. */
interface Timed {
  readonly segments: readonly SignalSegment[];
  readonly starts: readonly number[];
  readonly period: number;
  readonly repeats: boolean;
}

function timed(programme: ChannelProgramme): Timed {
  const starts: number[] = [];
  let at = 0;
  for (const segment of programme.segments) {
    starts.push(at);
    at += segment.length;
  }
  return {
    segments: programme.segments,
    starts,
    period: programmeLength(programme),
    repeats: programme.repeats,
  };
}

function toneKey(frequency: number, amplitude: number): string {
  return `${String(frequency)}/${String(amplitude)}`;
}

/** The index of the last segment starting at or before `offset`. */
function segmentAt(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((starts[middle] ?? 0) <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** Writes `into.length` frames of one channel from frame `from`. */
function writeChannel(
  channel: Timed,
  from: number,
  into: Float32Array,
  oscillators: ReadonlyMap<string, CanonicalOscillator>,
): void {
  let written = 0;
  while (written < into.length) {
    const frame = from + written;
    const offset = channel.repeats ? frame % channel.period : frame;
    if (channel.segments.length === 0 || offset >= channel.period) {
      into.fill(0, written);
      return;
    }
    const index = segmentAt(channel.starts, offset);
    const segment = channel.segments[index];
    const start = channel.starts[index];
    if (segment === undefined || start === undefined) throw new Error('A segment was not found.');
    const within = offset - start;
    const run = Math.min(segment.length - within, into.length - written);
    const part = into.subarray(written, written + run);
    switch (segment.kind) {
      case 'silence':
        part.fill(0);
        break;
      case 'impulse':
        part.fill(0);
        if (within === 0) part[0] = segment.amplitude;
        break;
      case 'tone': {
        const oscillator = oscillators.get(toneKey(segment.frequency, segment.amplitude));
        if (oscillator === undefined) throw new Error('A tone has no oscillator.');
        oscillator.seek(within);
        oscillator.render(part);
        break;
      }
    }
    written += run;
  }
}

function mismatched(recipe: SignalRecipe, layout: ChannelLayout): DomainFailure {
  return failure(
    'pcm.signal-channels-mismatched',
    FailureKind.Rejected,
    `The signal describes ${String(recipe.channels.length)} channels and the layout has ${String(channelCount(layout))}.`,
  );
}

function tooManyTones(count: number): DomainFailure {
  return failure(
    'pcm.signal-too-many-tones',
    FailureKind.Rejected,
    `The signal has ${String(count)} distinct tones; a source makes at most ${String(MAXIMUM_TONES)}.`,
  );
}

/** Makes one oscillator for each distinct tone, or releases them and says why it cannot. */
function oscillatorsFor(
  dsp: CanonicalDsp,
  settings: SignalSettings,
): DomainResult<ReadonlyMap<string, CanonicalOscillator>> {
  const tones = new Map<string, { readonly frequency: number; readonly amplitude: number }>();
  for (const programme of settings.recipe.channels) {
    for (const segment of programme.segments) {
      if (segment.kind === 'tone') {
        tones.set(toneKey(segment.frequency, segment.amplitude), segment);
      }
    }
  }
  if (tones.size > MAXIMUM_TONES) return fail(tooManyTones(tones.size));
  const made = new Map<string, CanonicalOscillator>();
  for (const [key, tone] of tones) {
    const oscillator = dsp.createOscillator({
      frequency: tone.frequency,
      amplitude: tone.amplitude,
      sampleRate: settings.sampleRate,
      startPhase: 0,
    });
    if (!oscillator.ok) {
      for (const each of made.values()) each.release();
      return oscillator;
    }
    made.set(key, oscillator.value);
  }
  return succeed(made);
}

/** A source of the recipe's frames, or why it cannot be made in this layout at this rate. */
export function signalSource(dsp: CanonicalDsp, settings: SignalSettings): DomainResult<PcmSource> {
  const { recipe, layout } = settings;
  if (recipe.channels.length !== channelCount(layout)) return fail(mismatched(recipe, layout));
  const oscillators = oscillatorsFor(dsp, settings);
  if (!oscillators.ok) return oscillators;
  const channels = recipe.channels.map(timed);
  return succeed({
    layout,
    sampleRate: settings.sampleRate,
    length: recipe.length,
    // Async, so a refused read rejects the promise rather than throwing before
    // the caller holds one.
    // eslint-disable-next-line @typescript-eslint/require-await -- the contract is a promise; a recipe has nothing to wait for
    read: async (start, into, signal) => {
      throwIfCancelled(signal);
      assertReadableInto(settings, into);
      const count = framesAvailable(recipe.length, start, into.frames);
      channels.forEach((channel, index) => {
        const target = into.channels[index];
        if (target !== undefined)
          writeChannel(channel, start, target.subarray(0, count), oscillators.value);
      });
      return count;
    },
    release: () => {
      for (const oscillator of oscillators.value.values()) oscillator.release();
    },
  });
}
