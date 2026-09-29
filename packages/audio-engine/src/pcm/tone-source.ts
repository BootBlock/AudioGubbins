/**
 * A test tone: a sine on every channel of a layout, from the canonical
 * oscillator.
 *
 * The deterministic PCM the packet's outcome plays and renders, and the
 * signal a user checks their output with. The same tone on every channel, so
 * a missing or swapped channel is heard as one that is silent or late.
 *
 * The oscillator accumulates its phase sample by sample, so frame `n` is
 * defined by the run from frame 0; a read anywhere but where the last one
 * ended starts the run again and skips to it, which keeps every read of frame
 * `n` the same bits, however it was reached.
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

/** Frames skipped at a time when a read starts somewhere new. */
const SKIP_CHUNK = 4_096;

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
  const make = (): DomainResult<CanonicalOscillator> =>
    dsp.createOscillator({
      frequency: settings.frequency,
      sampleRate: settings.sampleRate,
      startPhase: 0,
      amplitude: settings.amplitude,
    });
  return flatMapResult(make(), (first) => succeed(sourceOver(settings, first, make)));
}

function sourceOver(
  settings: ToneSettings,
  first: CanonicalOscillator,
  make: () => DomainResult<CanonicalOscillator>,
): PcmSource {
  let oscillator = first;
  let position = 0;
  const restartAt = (start: number): void => {
    oscillator.release();
    const again = make();
    // The settings were accepted once; the same settings are accepted again.
    if (!again.ok) throw new Error(again.failures[0].summary);
    oscillator = again.value;
    const skip = new Float32Array(SKIP_CHUNK);
    for (position = 0; position < start; position += SKIP_CHUNK) {
      oscillator.render(skip.subarray(0, Math.min(SKIP_CHUNK, start - position)));
    }
    position = start;
  };
  return {
    layout: settings.layout,
    sampleRate: settings.sampleRate,
    length: settings.length,
    // An executor, so a refused read rejects the promise rather than throwing
    // before the caller holds one.
    read: (start, into, signal) =>
      new Promise<number>((resolve) => {
        throwIfCancelled(signal);
        assertReadableInto(settings, into);
        if (start !== position) restartAt(start);
        const count = framesAvailable(settings.length, start, into.frames);
        const [firstChannel, ...others] = into.channels;
        if (firstChannel !== undefined) {
          oscillator.render(firstChannel.subarray(0, count));
          for (const channel of others) channel.set(firstChannel.subarray(0, count));
        }
        position += count;
        resolve(count);
      }),
    release: () => {
      oscillator.release();
    },
  };
}
