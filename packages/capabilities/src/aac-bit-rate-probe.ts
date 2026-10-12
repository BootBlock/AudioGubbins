/**
 * The bit rates the browser's AAC encoder takes, found by asking it
 * (ADR-0091, ADR-0092, REQ-EXEC-216).
 *
 * AAC-LC is written by the browser's own encoder alone, and each browser's is
 * its platform's: Chromium on Windows hands it to Media Foundation, which
 * codes mono, stereo and 5.1 at 44.1 and 48 kHz, each at 96, 128, 160 or 192
 * kbit/s and at nothing else, and fails an encoder configured otherwise only
 * once it is given audio. Chromium's `isConfigSupported` answers by the same
 * limits (checked in its bundled build on Windows, which refuses 127 999 and
 * 128 001 bit/s alike), so asking it finds what the encoder takes without
 * encoding a sample.
 *
 * The probe asks in two rounds. First, for each stream AAC states (each
 * channel count of its configurations 1 to 7 at each rate its sampling
 * frequency index names), whether the encoder takes the stream at a bit rate
 * of its own choosing; a stream refused so is coded at none. Then, for each
 * stream taken, each multiple of 8 kbit/s from AAC's lowest to the most its
 * syntax holds for the stream. What it finds is one band for each stream
 * taken, stating the constant bit rates taken, so a bit rate between two it
 * was asked is never offered. At most four questions are open at once, and a
 * cancelled probe asks nothing more.
 */

import {
  AAC_LOWEST_BIT_RATE,
  aacHighestBitRate,
  codecDescriptor,
  statedChannelCounts,
  type BitRateBand,
} from '@audiogubbins/codecs';
import { throwIfCancelled, type CancellationSignal } from '@audiogubbins/domain';

import { supports, type AskSupport, type WebCodecsAudioConfig } from './config-support.js';

/** AAC-LC's codec string in the WebCodecs codec registry. */
const AAC_LC = 'mp4a.40.2';

/** The step, in kbit/s, between the bit rates the encoder is asked for. */
const AAC_PROBE_STEP = 8;

/** The most questions the probe holds open at once. */
const QUESTIONS_AT_ONCE = 4;

/** A stream AAC states: a channel count of its configurations at a rate it names. */
interface AacStream {
  readonly channels: number;
  readonly sampleRate: number;
}

/** Every stream AAC's writer states, by channel count, then rate. */
function aacStreams(): readonly AacStream[] {
  const support = codecDescriptor('aac-lc').write?.sampleRates;
  const rates = support?.kind === 'listed' ? support.rates : [];
  return (statedChannelCounts('aac-lc') ?? []).flatMap((channels) =>
    rates.map((sampleRate) => ({ channels, sampleRate })),
  );
}

/** The bit rates, in kbit/s, the encoder is asked for a stream: AAC's lowest, then each step to its highest. */
function candidateBitRates(stream: AacStream): readonly number[] {
  const highest = aacHighestBitRate(stream.channels, stream.sampleRate);
  const count = Math.max(0, Math.floor((highest - AAC_LOWEST_BIT_RATE) / AAC_PROBE_STEP) + 1);
  return Array.from({ length: count }, (_, index) => AAC_LOWEST_BIT_RATE + index * AAC_PROBE_STEP);
}

function configOf(stream: AacStream, kbps?: number): WebCodecsAudioConfig {
  const config = {
    codec: AAC_LC,
    sampleRate: stream.sampleRate,
    numberOfChannels: stream.channels,
  };
  return kbps === undefined ? config : { ...config, bitrate: kbps * 1000 };
}

/**
 * Whether the encoder takes each of `configs`, in their order, asked at most
 * `QUESTIONS_AT_ONCE` at a time; throws the cancellation's reason once
 * `signal` is cancelled, asking nothing more.
 */
async function askEach(
  ask: AskSupport,
  configs: readonly WebCodecsAudioConfig[],
  signal: CancellationSignal | undefined,
): Promise<readonly boolean[]> {
  const answers = Array.from({ length: configs.length }, () => false);
  let next = 0;
  const askNext = async (): Promise<void> => {
    while (next < configs.length) {
      const index = next;
      next += 1;
      throwIfCancelled(signal);
      const config = configs[index];
      if (config !== undefined) answers[index] = await supports(ask, config);
    }
  };
  const askers = Array.from({ length: Math.min(QUESTIONS_AT_ONCE, configs.length) }, askNext);
  await Promise.all(askers);
  throwIfCancelled(signal);
  return answers;
}

/**
 * The bands of constant bit rates the encoder whose `isConfigSupported` is
 * `ask` takes AAC-LC at, one for each stream it takes at any (see the module
 * comment); none where it takes no stream.
 */
export async function probeAacBitRates(
  ask: AskSupport,
  signal?: CancellationSignal,
): Promise<readonly BitRateBand[]> {
  const streams = aacStreams();
  const taken = await askEach(
    ask,
    streams.map((stream) => configOf(stream)),
    signal,
  );
  const served = streams.filter((_, index) => taken[index] === true);
  const asked = served.flatMap((stream) =>
    candidateBitRates(stream).map((kbps) => ({ stream, kbps })),
  );
  const answers = await askEach(
    ask,
    asked.map(({ stream, kbps }) => configOf(stream, kbps)),
    signal,
  );
  const found = new Map<AacStream, number[]>();
  asked.forEach(({ stream, kbps }, index) => {
    if (answers[index] !== true) return;
    const constant = found.get(stream);
    if (constant === undefined) found.set(stream, [kbps]);
    else constant.push(kbps);
  });
  return [...found].map(([stream, constant]) => ({
    channels: stream.channels,
    sampleRates: { minimum: stream.sampleRate, maximum: stream.sampleRate },
    constant,
  }));
}
