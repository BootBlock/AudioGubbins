/**
 * The golden tiles (ADR-0080): the same tiles made from the reference path and
 * from the WebAssembly DSP must be the same bytes, the pinned ones. One case is
 * the default settings at level 0, where the windows overlap and the sound is
 * read as one span; the other a coarse level of a short window, where the
 * windows lie apart and each is read alone. The sound is the spectral golden
 * sound of the engine's tests, every channel of it.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import {
  REFERENCE_DSP,
  StftWindow,
  frameBlock,
  memorySource,
  wasmDsp,
  type CanonicalDsp,
} from '@audiogubbins/audio-engine';
import {
  GOLDEN_INPUT,
  GOLDEN_LAYOUT,
  GOLDEN_RATE,
  dspModuleExports,
} from '@audiogubbins/audio-engine/testing';
import { createCancellationSource } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { DEFAULT_SPECTROGRAM_CONFIG, type SpectrogramConfig } from './spectrogram-config.js';
import { analyseTiles } from './tile-analysis.js';
import { spectrogramGeometry } from './tile-geometry.js';

/**
 * FNV-1a, 64 bits, over a tile's bytes in order: the engine's fingerprint of
 * samples (ADR-0032), taken over bytes, since a tile's length need not be a
 * whole number of samples.
 */
function bytesFingerprint(bytes: Uint8Array): bigint {
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash;
}

let wasm: CanonicalDsp;

beforeAll(async () => {
  wasm = expectSuccess(wasmDsp(await dspModuleExports()));
});

/** The golden sound `times` times over, end to end. */
function repeated(times: number): readonly Float32Array[] {
  return GOLDEN_INPUT.map((channel) => {
    const out = new Float32Array(channel.length * times);
    for (let time = 0; time < times; time += 1) out.set(channel, time * channel.length);
    return out;
  });
}

/** Each channel's tile at a place, made by `dsp`, fingerprinted over its bytes in order. */
async function tileFingerprints(
  dsp: CanonicalDsp,
  config: SpectrogramConfig,
  channels: readonly Float32Array[],
  level: number,
): Promise<readonly bigint[]> {
  const source = expectSuccess(
    memorySource(expectSuccess(frameBlock(GOLDEN_LAYOUT, GOLDEN_RATE, [...channels]))),
  );
  const geometry = spectrogramGeometry(config, source.length ?? 0, channels.length);
  const tiles = await analyseTiles(
    { geometry, level, index: 0, channels: channels.map((_, channel) => channel) },
    {
      source,
      dsp,
      yieldToHost: () => Promise.resolve(),
      signal: createCancellationSource().signal,
    },
  );
  return tiles.map(bytesFingerprint);
}

describe('the golden tiles', () => {
  it('are the same bits from both DSPs at the default settings, level 0', async () => {
    const reference = await tileFingerprints(
      REFERENCE_DSP,
      DEFAULT_SPECTROGRAM_CONFIG,
      GOLDEN_INPUT,
      0,
    );
    expect(await tileFingerprints(wasm, DEFAULT_SPECTROGRAM_CONFIG, GOLDEN_INPUT, 0)).toEqual(
      reference,
    );
    expect(reference).toEqual([
      0xb5dc8ef93051c10an,
      0xec0f7ee9e9e2cd5en,
      0x912b52972d7cb70dn,
      0xd0f7c20c9c32de82n,
    ]);
  });

  it('are the same bits from both DSPs at a coarse level whose windows lie apart', async () => {
    const config: SpectrogramConfig = { windowLength: 256, window: StftWindow.Hann, overlap: 1 };
    const sound = repeated(8);
    expect(spectrogramGeometry(config, sound[0]!.length, 4).levels[3]?.spacing).toBe(512);
    const reference = await tileFingerprints(REFERENCE_DSP, config, sound, 3);
    expect(await tileFingerprints(wasm, config, sound, 3)).toEqual(reference);
    expect(reference).toEqual([
      0x93fdee2ca0fb5b83n,
      0xafdb07c0fe881f74n,
      0x2302088ca1f99c39n,
      0x98f89456afddcc56n,
    ]);
  });
});
