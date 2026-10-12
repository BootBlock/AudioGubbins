import { createCancellationSource } from '@audiogubbins/domain';
import { describe, expect, it } from 'vitest';

import { probeAacBitRates } from './aac-bit-rate-probe.js';
import { probeCodecs, readCodecPlatform } from './codec-platform.js';
import type { ConfigSupport, WebCodecsAudioConfig } from './config-support.js';

/**
 * What Chromium's AAC encoder on Windows takes, as its bundled build answered
 * `isConfigSupported`: Media Foundation's mono, stereo and 5.1 at 44.1 and 48
 * kHz, each at 96, 128, 160 or 192 kbit/s exactly, or at a bit rate of its own.
 */
function mediaFoundation(config: WebCodecsAudioConfig): boolean {
  return (
    config.codec === 'mp4a.40.2' &&
    [1, 2, 6].includes(config.numberOfChannels) &&
    [44_100, 48_000].includes(config.sampleRate) &&
    (config.bitrate === undefined || [96_000, 128_000, 160_000, 192_000].includes(config.bitrate))
  );
}

/** `isConfigSupported` answering by `takes`, recording each configuration asked. */
function asking(takes: (config: WebCodecsAudioConfig) => boolean) {
  const asked: WebCodecsAudioConfig[] = [];
  const ask = (config: WebCodecsAudioConfig): Promise<ConfigSupport> => {
    asked.push(config);
    return Promise.resolve({ supported: takes(config) });
  };
  return { ask, asked };
}

const WINDOWS_RATES = [96, 128, 160, 192];

describe('probeAacBitRates', () => {
  it("finds the bit rates Media Foundation's encoder takes, one band for each stream it takes", async () => {
    const { ask } = asking(mediaFoundation);
    const bands = await probeAacBitRates(ask);
    expect(bands).toEqual(
      [1, 2, 6].flatMap((channels) =>
        [44_100, 48_000].map((rate) => ({
          channels,
          sampleRates: { minimum: rate, maximum: rate },
          constant: WINDOWS_RATES,
        })),
      ),
    );
  });

  it("asks each stream of AAC's configurations at each rate, and bit rates only of the streams taken", async () => {
    const { ask, asked } = asking(mediaFoundation);
    await probeAacBitRates(ask);
    const streams = asked.filter((config) => config.bitrate === undefined);
    expect(new Set(streams.map((config) => config.numberOfChannels))).toEqual(
      new Set([1, 2, 3, 4, 5, 6, 8]),
    );
    expect(streams).toHaveLength(7 * 12);
    const rated = asked.filter((config) => config.bitrate !== undefined);
    expect(new Set(rated.map((config) => config.numberOfChannels))).toEqual(new Set([1, 2, 6]));
    // Stereo at 48 kHz is asked every 8 kbit/s from 8 to 576, the most AAC holds.
    const stereo = rated
      .filter((config) => config.numberOfChannels === 2 && config.sampleRate === 48_000)
      .map((config) => (config.bitrate ?? 0) / 1000);
    expect(stereo[0]).toBe(8);
    expect(stereo.at(-1)).toBe(576);
    expect(stereo).toHaveLength(72);
  });

  it('finds no band where the encoder takes no stream', async () => {
    const { ask, asked } = asking(() => false);
    expect(await probeAacBitRates(ask)).toEqual([]);
    expect(asked.every((config) => config.bitrate === undefined)).toBe(true);
  });

  it('holds at most four questions open at once', async () => {
    let open = 0;
    let most = 0;
    const ask = async (config: WebCodecsAudioConfig): Promise<ConfigSupport> => {
      open += 1;
      most = Math.max(most, open);
      await Promise.resolve();
      await Promise.resolve();
      open -= 1;
      return { supported: mediaFoundation(config) };
    };
    await probeAacBitRates(ask);
    expect(most).toBe(4);
  });

  it('stops asking once cancelled, failing with the reason', async () => {
    const cancellation = createCancellationSource();
    const reason = new Error('The worker is closing.');
    let answered = 0;
    const ask = async (config: WebCodecsAudioConfig): Promise<ConfigSupport> => {
      await Promise.resolve();
      answered += 1;
      if (answered === 10) cancellation.cancel(reason);
      return { supported: mediaFoundation(config) };
    };
    await expect(probeAacBitRates(ask, cancellation.signal)).rejects.toBe(reason);
    // The four questions already open when it was cancelled are the last.
    expect(answered).toBeLessThanOrEqual(10 + 3);
  });
});

describe('probeCodecs', () => {
  /** A platform whose encoder answers by `takes`. */
  function encodingBy(takes: (config: WebCodecsAudioConfig) => boolean) {
    return readCodecPlatform({
      AudioEncoder: Object.assign(() => undefined, { isConfigSupported: asking(takes).ask }),
      AudioData: () => undefined,
    });
  }

  it('states the bit rates the AAC encoder takes, and counts AAC-LC encoded where it takes any', async () => {
    const probes = await probeCodecs(encodingBy(mediaFoundation));
    expect(probes.browserEncoders.has('aac-lc')).toBe(true);
    expect(probes.browserBitRates.get('aac-lc')).toHaveLength(6);
  });

  it('counts AAC-LC unencoded where its encoder takes no stream at any bit rate', async () => {
    const probes = await probeCodecs(
      encodingBy((config) => config.codec === 'mp4a.40.2' && config.bitrate === undefined),
    );
    expect(probes.browserEncoders.has('aac-lc')).toBe(false);
    expect(probes.browserBitRates.has('aac-lc')).toBe(false);
  });
});
