/**
 * A test tone: a sine on every channel of a layout, from the canonical
 * oscillator.
 *
 * The deterministic PCM the packet's outcome plays and renders, and the
 * signal a user checks their output with. The same tone on every channel, so
 * a missing or swapped channel is heard as one that is silent or late.
 *
 * The oscillator's phase at frame `n` is defined exactly, so a read anywhere
 * but where the last one ended seeks it there at once, and frame `n` has the
 * same bits however it was reached, at a cost that does not grow with `n`.
 */

import {
  failure,
  FailureKind,
  fail,
  flatMapResult,
  succeed,
  type ChannelLayout,
  type DomainResult,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';

import { throwIfCancelled } from '../cancellation.js';
import type { CanonicalDsp, CanonicalOscillator } from '../dsp/canonical-dsp.js';
import { assertReadableInto, framesAvailable, type PcmSource } from './pcm-source.js';

/** How the tone is made. */
export interface ToneSettings {
  readonly layout: ChannelLayout;
  readonly sampleRate: SampleRate;
  readonly frequency: number;
  /** Peak in full scale, at most 1. */
  readonly amplitude: number;
  /** Frames it lasts, or `undefined` to last for ever. */
  readonly length: SampleCount | undefined;
}

/** A tone source, or why the tone cannot be made. */
export function toneSource(dsp: CanonicalDsp, settings: ToneSettings): DomainResult<PcmSource> {
  if (!(settings.amplitude >= 0 && settings.amplitude <= 1)) {
    return fail(
      failure(
        'pcm.tone-amplitude-out-of-range',
        FailureKind.Rejected,
        'A test tone peaks between silence and full scale.',
        { details: { amplitude: String(settings.amplitude) } },
      ),
    );
  }
  const made = dsp.createOscillator({
    frequency: settings.frequency,
    sampleRate: settings.sampleRate,
    startPhase: 0,
    amplitude: settings.amplitude,
  });
  return flatMapResult(made, (oscillator) => succeed(sourceOver(settings, oscillator)));
}

function sourceOver(settings: ToneSettings, oscillator: CanonicalOscillator): PcmSource {
  let position = 0;
  return {
    layout: settings.layout,
    sampleRate: settings.sampleRate,
    length: settings.length,
    // Async, so a refused read rejects the promise rather than throwing
    // before the caller holds one.
    // eslint-disable-next-line @typescript-eslint/require-await -- the contract is a promise; a tone has nothing to wait for
    read: async (start, into, signal) => {
      throwIfCancelled(signal);
      assertReadableInto(settings, into);
      if (start !== position) oscillator.seek(start);
      const count = framesAvailable(settings.length, start, into.frames);
      const [firstChannel, ...others] = into.channels;
      if (firstChannel !== undefined) {
        oscillator.render(firstChannel.subarray(0, count));
        for (const channel of others) channel.set(firstChannel.subarray(0, count));
      }
      position = start + count;
      return count;
    },
    release: () => {
      oscillator.release();
    },
  };
}
