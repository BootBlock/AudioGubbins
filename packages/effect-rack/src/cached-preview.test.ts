/**
 * The cached preview producer over the rack's own chains (ADR-0061): a chain
 * holding a processor that measures its whole input is heard from a render
 * made once, however many times playback starts, and a waveform drawn out of
 * order reads that render rather than run the chain again from the start for
 * every read behind the last.
 */

import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  createDeterministicIdGenerator,
  derivedSampleCount,
  finalRenderSettings,
  instantiateProcessor,
  succeed,
  type EffectChain,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  CachePurpose,
  PcmDescriptionKind,
  PreviewProducer,
  ProcessedStart,
  REFERENCE_DSP,
  allocateBlock,
  describedSource,
  type CachedStreams,
  type ChainProcessing,
  type PcmSource,
} from '@audiogubbins/audio-engine';
import { rackedMedia, rackedPlan } from '@audiogubbins/audio-engine/testing';
import { PROCESSOR_TYPES_BY_KEY } from '@audiogubbins/processors';
import { TEST_RATE, scriptedWholePass, type PassCounts } from '@audiogubbins/processors/testing';

import { chainProcessing } from './chain-run.js';

const ids = createDeterministicIdGenerator(91);
const LENGTH = 50_000;
const SAMPLES = [
  Float32Array.from({ length: LENGTH }, (_, frame) => Math.fround(Math.sin(frame / 7) * 0.5)),
];

/** A whole-pass processor whose passes are counted, and the rack that runs it. */
function measuredRack() {
  const counts: PassCounts = { released: 0, live: 0, measured: [] };
  const type = scriptedWholePass({ result: () => Promise.resolve(succeed([1])) }, counts);
  const chain: EffectChain = {
    id: ids.next(),
    slots: [instantiateProcessor(ids.next(), type.descriptor)],
  };
  const processing = chainProcessing(new Map([[type.descriptor.typeKey, type]]));
  return { counts, chain, processing };
}

/** The racked asset as playback reads it, previewing, its renders read from `cached`. */
function played(
  rack: ReturnType<typeof measuredRack>,
  cached: CachedStreams | undefined,
): PcmSource {
  return expectSuccess(
    describedSource(
      {
        kind: PcmDescriptionKind.Edited,
        sampleRate: TEST_RATE,
        plan: rackedPlan(rack.chain, LENGTH, TEST_RATE),
        media: [rackedMedia(SAMPLES, TEST_RATE)],
      },
      StandardLayouts.mono,
      REFERENCE_DSP,
      {
        processing: rack.processing,
        quality: MAXIMUM_QUALITY.settings,
        start: ProcessedStart.Preview,
        ...(cached === undefined ? {} : { cached }),
      },
    ),
  );
}

/** Reads `frames` frames of `source` from `start`. */
async function readFrom(source: PcmSource, start: number, frames: number): Promise<Float32Array> {
  const block = allocateBlock(source.layout, source.sampleRate, frames);
  await source.read(derivedSampleCount(start), block);
  return block.channels[0] ?? new Float32Array();
}

function producerFor(rack: ReturnType<typeof measuredRack>): PreviewProducer {
  return new PreviewProducer({
    processing: rack.processing,
    dsp: REFERENCE_DSP,
    bound: 64 * 2 ** 20,
    concurrency: 1,
  });
}

describe('a chain with a whole-pass processor, previewed', () => {
  it('measures its whole pass once across two playback starts, and plays what it measured', async () => {
    const rack = measuredRack();
    const producer = producerFor(rack);
    const cached = producer.streams(CachePurpose.Playback);

    // Play from part way, then start again from the start: a seek back.
    const first = played(rack, cached);
    await readFrom(first, 20_000, 4_096);
    const heard = await readFrom(first, 0, 4_096);
    first.release();
    // Play again after a new load of the same sound.
    const second = played(rack, cached);
    expect(await readFrom(second, 0, 4_096)).toEqual(heard);
    second.release();

    expect(rack.counts.released).toBe(1);
    expect(producer.rendersBegun).toBe(1);
    // The kernel passes its input on: the render is the stream itself.
    expect(heard).toEqual(SAMPLES[0]?.subarray(0, 4_096));
  });

  it('is measured at every start where no render is kept, which the producer exists to end', async () => {
    const rack = measuredRack();
    const source = played(rack, undefined);
    await readFrom(source, 20_000, 4_096);
    await readFrom(source, 0, 4_096);
    source.release();
    expect(rack.counts.released).toBe(2);
  });
});

describe('a waveform of racked audio drawn out of order', () => {
  it('reads its render, so a read behind the last never starts the chain again', async () => {
    const type = PROCESSOR_TYPES_BY_KEY.get('compressor');
    if (type === undefined) throw new Error('The catalogue has a compressor.');
    let prepared = 0;
    const rack = chainProcessing(PROCESSOR_TYPES_BY_KEY);
    const counted: ChainProcessing = {
      listening: (request) => rack.listening(request),
      measurementBytes: (request) => rack.measurementBytes(request),
      prepare: (...args: Parameters<typeof rack.prepare>) => {
        prepared += 1;
        return rack.prepare(...args);
      },
    };
    const chain: EffectChain = {
      id: ids.next(),
      slots: [instantiateProcessor(ids.next(), type.descriptor)],
    };
    const quality = finalRenderSettings(MAXIMUM_QUALITY);
    const producer = new PreviewProducer({
      processing: counted,
      dsp: REFERENCE_DSP,
      bound: 64 * 2 ** 20,
      concurrency: 1,
    });
    const description = {
      kind: PcmDescriptionKind.Edited,
      sampleRate: TEST_RATE,
      plan: rackedPlan(chain, LENGTH, TEST_RATE),
      media: [rackedMedia(SAMPLES, TEST_RATE)],
    } as const;
    const read = (cached: CachedStreams | undefined) =>
      expectSuccess(
        describedSource(description, StandardLayouts.mono, REFERENCE_DSP, {
          processing: counted,
          quality,
          start: ProcessedStart.Canonical,
          ...(cached === undefined ? {} : { cached }),
        }),
      );
    const alone = read(undefined);
    const whole = await readFrom(alone, 0, LENGTH);
    alone.release();
    prepared = 0;

    const drawn = read(producer.streams(CachePurpose.Waveform));
    // The peak worker's focus first, then the chunks before it.
    for (const start of [32_768, 16_384, 0]) {
      expect(await readFrom(drawn, start, 16_384)).toEqual(
        whole.subarray(start, Math.min(LENGTH, start + 16_384)).length === 16_384
          ? whole.subarray(start, start + 16_384)
          : expect.anything(),
      );
    }
    drawn.release();
    expect(prepared).toBe(1);
  });
});
