import { describe, expect, it } from 'vitest';

import {
  AssetOrigin,
  MAXIMUM_QUALITY,
  StandardLayouts,
  assetPlan,
  createDeterministicIdGenerator,
  derivedSampleCount,
  finalRenderSettings,
  treatmentChain,
  unsafeBrandId,
  type Asset,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  PcmDescriptionKind,
  ProcessedStart,
  REFERENCE_DSP,
  allocateBlock,
  describedSource,
  type MediaFile,
  type PcmSource,
} from '@audiogubbins/audio-engine';
import { PROCESSOR_CATALOGUE, PROCESSOR_TYPES_BY_KEY } from '@audiogubbins/processors';
import { TEST_RATE } from '@audiogubbins/processors/testing';
import { wavFile } from '@audiogubbins/test-fixtures';

import { chainProcessing } from './chain-run.js';

const LENGTH = 3 * TEST_RATE;
/** The peak worker's chunk, which its build reads one at a time. */
const CHUNK = 65_536;
/** Where a view's request for samples reads while the build is part way through. */
const REQUEST_AT = 60_000;
const REQUEST_FRAMES = 8_192;

/** A tone over a hum, with three clicks for the de-click to repair. */
function scratchy(): Float32Array {
  const samples = Float32Array.from(
    { length: LENGTH },
    (_, frame) =>
      0.3 * Math.sin((2 * Math.PI * 440 * frame) / TEST_RATE) +
      0.01 * Math.sin((2 * Math.PI * 60 * frame) / TEST_RATE),
  );
  for (const at of [36_000, 84_000, 120_000]) {
    for (let offset = 0; offset < 9; offset += 1) {
      samples[at + offset] = (samples[at + offset] ?? 0) + 0.3 * (offset % 2 === 0 ? -1 : 1);
    }
  }
  return samples;
}

const BYTES = wavFile({
  name: 'scratchy',
  sampleRate: TEST_RATE,
  channelLayout: StandardLayouts.mono,
  channels: [scratchy()],
  length: derivedSampleCount(LENGTH),
});

const FILE: MediaFile = {
  size: BYTES.length,
  slice: (start, end) => ({ arrayBuffer: () => Promise.resolve(BYTES.slice(start, end).buffer) }),
};

const ids = createDeterministicIdGenerator(3);
const CHAIN = expectSuccess(
  treatmentChain(
    [{ typeKey: 'de-click', values: { sensitivity: 8 } }],
    [undefined],
    PROCESSOR_CATALOGUE,
    ids,
  ),
);
const ASSET: Asset = {
  id: unsafeBrandId<'AssetId'>('0000eeee-0001'),
  displayName: 'Scratchy',
  origin: AssetOrigin.Imported,
  sampleRate: TEST_RATE,
  channelLayout: StandardLayouts.mono,
  length: derivedSampleCount(LENGTH),
  storageKey: 'content:scratchy',
  edits: [],
  rack: CHAIN.id,
};
const PLAN = expectSuccess(
  assetPlan(ASSET, { chains: new Map([[CHAIN.id, CHAIN]]), catalogue: PROCESSOR_CATALOGUE }),
);

/** The asset heard through its de-click rack, as the peak worker reads it. */
function racked(): PcmSource {
  return expectSuccess(
    describedSource(
      {
        kind: PcmDescriptionKind.Edited,
        sampleRate: TEST_RATE,
        plan: PLAN,
        media: [
          { asset: ASSET.id, sampleRate: TEST_RATE, channels: 1, length: ASSET.length, file: FILE },
        ],
      },
      StandardLayouts.mono,
      REFERENCE_DSP,
      {
        processing: chainProcessing(PROCESSOR_TYPES_BY_KEY),
        quality: finalRenderSettings(MAXIMUM_QUALITY),
        start: ProcessedStart.Canonical,
      },
    ),
  );
}

/** Reads `frames` frames of `source` from `start`, alone. */
async function readAlone(source: PcmSource, start: number, frames: number): Promise<Float32Array> {
  const block = allocateBlock(source.layout, source.sampleRate, frames);
  const read = await source.read(derivedSampleCount(start), block);
  return (block.channels[0] ?? new Float32Array()).slice(0, read);
}

describe('a processed source read by two readers at once (ADR-0060)', () => {
  it('gives each read what it would read alone, as a build and a request overlap', async () => {
    const alone = racked();
    const whole = await readAlone(alone, 0, LENGTH);
    alone.release();

    // The peak worker's build reads chunk by chunk, out of order once a view
    // has a focus, while a view's request reads another stretch of the same
    // source: each read starts before the other has settled.
    for (const order of [
      [0, 1, 2],
      [1, 0, 2],
    ]) {
      const shared = racked();
      for (const chunk of order) {
        const start = chunk * CHUNK;
        const [built, requested] = await Promise.all([
          readAlone(shared, start, Math.min(CHUNK, LENGTH - start)),
          readAlone(shared, REQUEST_AT, REQUEST_FRAMES),
        ]);
        expect(built).toEqual(whole.subarray(start, start + built.length));
        expect(requested).toEqual(whole.subarray(REQUEST_AT, REQUEST_AT + REQUEST_FRAMES));
      }
      shared.release();
    }
  });
});
