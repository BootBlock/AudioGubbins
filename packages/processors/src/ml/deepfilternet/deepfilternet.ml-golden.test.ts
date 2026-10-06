/**
 * DeepFilterNet 3's pinned golden render (ADR-0062): the real runtime, in
 * Node, from the pack's own files, read from the cache the pack build fills
 * and checked by hash, over a signal made here, held to one SHA-256 of the
 * bytes of its output.
 *
 * It runs in its own project, `ml-golden`, never in `pnpm test`, since it
 * needs the pack's files, which the repository does not hold (REQ-REPO-191):
 * `vitest run --project ml-golden`, with `AUDIOGUBBINS_PACK_CACHE` naming the
 * cache. Without the files it fails, saying how to make them; it never skips.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { StandardLayouts, succeed } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { sineOfTurns } from '@audiogubbins/audio-engine';
import { realInference } from '@audiogubbins/ml-runtime/testing';

import { modelPassOf, passOver } from '../../testing/model-runs.js';
import { runtimeWebAssembly } from '../../testing/model-services.js';
import { TEST_RATE } from '../../testing/processor-run.js';
import { PINNED_RUNTIME_SHA256 } from '../model-definition.js';
import type { ModelLibrary } from '../model-library.js';
import { deepFilterNet3 } from './deepfilternet.js';
import { DEEPFILTERNET_3_MODEL } from './deepfilternet-model.js';

/** The SHA-256 of the golden render's output, its samples' bytes in order. */
const GOLDEN_SHA256 = '81fdbd5f5d45026944f1a3205377029c0a151962b883f06e91eadad5cdcb6a7d';

const CACHE = process.env['AUDIOGUBBINS_PACK_CACHE'];
const { pack, version } = DEEPFILTERNET_3_MODEL.identity;

/** Where the pack build writes this pack's files, under the cache. */
function packFolder(): string {
  const how =
    `Build the pack with \`node tools/model-packs/build-packs.mjs ${pack}\` and set ` +
    'AUDIOGUBBINS_PACK_CACHE to the cache it used.';
  if (CACHE === undefined || CACHE === '') {
    throw new Error(
      `The golden render reads ${pack} from the pack cache, which no variable names. ${how}`,
    );
  }
  const folder = join(CACHE, 'catalogue', pack, version);
  if (!existsSync(folder))
    throw new Error(`The pack cache holds no ${pack} ${version} at ${folder}. ${how}`);
  return folder;
}

/** The model library over the pack build's output, each file hashed as it is read. */
function packLibrary(folder: string): ModelLibrary {
  return {
    file: (_pack, _version, path) => {
      const bytes = new Uint8Array(readFileSync(join(folder, path)));
      return Promise.resolve(
        succeed({ bytes, sha256: createHash('sha256').update(bytes).digest('hex') }),
      );
    },
  };
}

/**
 * Twelve seconds of a voiced harmonic signal in noise, at 48 kHz: a glottal
 * series of twenty harmonics whose pitch glides between 100 and 160 Hz,
 * gated into syllables, under white noise 15 dB below it, from a linear
 * congruential generator; the canonical sine throughout, so the input is the
 * same bits everywhere. Twelve seconds take the model over two runs, so the
 * golden holds the join between them too.
 */
function voicedInNoise(): Float32Array {
  const frames = 12 * 48_000;
  const signal = new Float32Array(frames);
  let phase = 0;
  let seed = 1;
  for (let frame = 0; frame < frames; frame += 1) {
    const pitch = 130 + 30 * sineOfTurns(frame / 48_000 / 1.7);
    phase = (phase + pitch / 48_000) % 1;
    let voice = 0;
    for (let harmonic = 1; harmonic <= 20; harmonic += 1) {
      voice += sineOfTurns((phase * harmonic) % 1) / harmonic;
    }
    const syllable = Math.max(0, sineOfTurns(frame / 48_000 / 0.45));
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    const noise = seed / 2_147_483_648 - 0.5;
    signal[frame] = 0.12 * voice * syllable + 0.08 * noise;
  }
  return signal;
}

describe('DeepFilterNet 3, pinned', { timeout: 120_000 }, () => {
  it('renders the golden output from the pack, on the pinned runtime', async () => {
    const folder = packFolder();
    const type = deepFilterNet3({
      inference: realInference(runtimeWebAssembly(), PINNED_RUNTIME_SHA256),
      models: packLibrary(folder),
    });
    const started = performance.now();
    const measured = expectSuccess(
      await passOver(
        modelPassOf(type, { layout: StandardLayouts.mono, sampleRate: TEST_RATE }),
        [voicedInNoise()],
        [16_384],
      ),
    );
    const seconds = (performance.now() - started) / 1_000;
    if (!(measured instanceof Float32Array)) throw new Error('A model pass makes samples.');
    const digest = createHash('sha256')
      .update(new Uint8Array(measured.buffer, measured.byteOffset, measured.byteLength))
      .digest('hex');
    expect({ frames: measured.length, digest }, `rendered in ${seconds.toFixed(1)} s`).toEqual({
      frames: 12 * 48_000,
      digest: GOLDEN_SHA256,
    });
  });
});
