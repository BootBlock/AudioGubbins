/**
 * The rack's live form (ADR-0070): a chain run over an input with no end, as
 * monitoring runs one on the audio thread, made with no pass, and refused with
 * its reason where the chain cannot be heard live.
 */

import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  createDeterministicIdGenerator,
  instantiateProcessor,
  type ChainSlot,
  type EffectChain,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { REFERENCE_DSP, type LiveChainRequest } from '@audiogubbins/audio-engine';
import {
  ModelUnavailability,
  modelUnavailable,
  processorTypesWith,
  type ModelServices,
  type ProcessorType,
} from '@audiogubbins/processors';
import { TEST_RATE, delayingProcessor, processorValues } from '@audiogubbins/processors/testing';
import { noise } from '@audiogubbins/test-fixtures';

import { chainProcessing } from './chain-run.js';

const ids = createDeterministicIdGenerator(707);

const NO_PACK = 'No pack is kept here.';

/** Services no model runs through: a live chain is refused before any model is opened. */
const NO_MODELS: ModelServices = {
  inference: {
    open: () => {
      throw new Error('No model is opened for a chain run live.');
    },
  },
  models: {
    available: (pack, version) =>
      Promise.resolve(
        modelUnavailable(ModelUnavailability.RequiredUnavailable, NO_PACK, { pack, version }),
      ),
    file: (pack, version) =>
      Promise.resolve(
        modelUnavailable(ModelUnavailability.RequiredUnavailable, NO_PACK, { pack, version }),
      ),
  },
};

const DELAY = delayingProcessor(53);
const TYPES: ReadonlyMap<string, ProcessorType> = new Map([
  ...processorTypesWith(NO_MODELS),
  [DELAY.descriptor.typeKey, DELAY],
]);
const PROCESSING = chainProcessing(TYPES);

function typeOf(key: string): ProcessorType {
  const type = TYPES.get(key);
  if (type === undefined) throw new Error(`The catalogue has a ${key} processor.`);
  return type;
}

/** A slot of the type `key` at `values`. */
function slot(key: string, values: Readonly<Record<string, number>> = {}): ChainSlot {
  const type = typeOf(key);
  return {
    ...instantiateProcessor(ids.next(), type.descriptor),
    values: processorValues(type, values),
  };
}

function chainOf(...slots: ChainSlot[]): EffectChain {
  return { id: ids.next(), slots };
}

function liveRequest(chain: EffectChain): LiveChainRequest {
  return {
    chain,
    input: StandardLayouts.mono,
    sampleRate: TEST_RATE,
    quality: MAXIMUM_QUALITY.settings,
    blockFrames: 128,
    dsp: REFERENCE_DSP,
  };
}

const LENGTH = 7_919;
/** Noise at a tenth of full scale, so the compressor works on it without clipping. */
const INPUT = Float32Array.from(
  noise(29).channels[0]?.slice(0, LENGTH) ?? new Float32Array(LENGTH),
  (sample) => sample / 10,
);

/** The run of `chain` prepared over the whole input as a stream, from its first frame. */
async function overStream(chain: EffectChain): Promise<{ out: Float32Array; latency: number }> {
  const run = expectSuccess(
    await PROCESSING.prepare(
      { ...liveRequest(chain), length: LENGTH, start: 0 },
      (from, frames, into) => {
        into[0]?.set(INPUT.subarray(from, from + frames));
        return Promise.resolve();
      },
    ),
  );
  const out = new Float32Array(LENGTH);
  run.process([INPUT], [out], LENGTH);
  run.release();
  return { out, latency: run.latency };
}

/** The live run of `chain` given the input a render quantum at a time, as the audio thread gives it. */
function live(chain: EffectChain): { out: Float32Array; latency: number } {
  const run = expectSuccess(PROCESSING.prepareLive(liveRequest(chain)));
  const out = new Float32Array(LENGTH);
  for (let from = 0; from < LENGTH; from += 128) {
    const frames = Math.min(128, LENGTH - from);
    run.process([INPUT.subarray(from, from + frames)], [out.subarray(from, from + frames)], frames);
  }
  run.release();
  return { out, latency: run.latency };
}

describe('a chain run live (ADR-0070)', () => {
  it('makes the bits a run over the same input as a stream makes, from its first frame', async () => {
    const chain = chainOf(
      slot('compressor', { threshold: -30, ratio: 4 }),
      slot(DELAY.descriptor.typeKey),
      slot('gain', { gain: -3 }),
    );
    const streamed = await overStream(chain);
    const heard = live(chain);

    expect(heard.out).toEqual(streamed.out);
    expect(heard.out.some((sample) => sample !== 0)).toBe(true);
  });

  it('says how late its output is, as the stream’s run does', async () => {
    const chain = chainOf(slot(DELAY.descriptor.typeKey), slot('gain', { gain: 6 }));

    expect(live(chain).latency).toBe(53);
    expect((await overStream(chain)).latency).toBe(53);
  });

  it('refuses a chain with a processor that measures its whole input, with the listening’s reason', () => {
    const chain = chainOf(slot('gain'), slot('peak-normalisation'));
    const listened = expectSuccess(PROCESSING.listening(liveRequest(chain)));
    if (listened.kind !== 'rendered')
      throw new Error('A peak normalisation is heard from a render.');

    const refused = PROCESSING.prepareLive(liveRequest(chain));

    expect(expectFailureCode(refused)).toBe('effect-rack.chain-not-live');
    expect(refused.ok ? undefined : refused.failures[0].summary).toBe(listened.reason);
    expect(listened.reason).toContain('measures the whole of its input');
  });

  it('refuses a chain that runs a model, before any model is opened', () => {
    const chain = chainOf(slot('deepfilternet-3'));
    const listened = expectSuccess(PROCESSING.listening(liveRequest(chain)));
    if (listened.kind !== 'rendered') throw new Error('A model is heard from a render.');

    const refused = PROCESSING.prepareLive(liveRequest(chain));

    expect(expectFailureCode(refused)).toBe('effect-rack.chain-not-live');
    expect(refused.ok ? undefined : refused.failures[0].summary).toBe(listened.reason);
    expect(listened.reason).toContain('DeepFilterNet 3');
  });

  it('refuses a processor that lacks the state it needs, with what the person is told to do', () => {
    const reduction = typeOf('noise-reduction').descriptor;
    const chain = chainOf(slot('noise-reduction'));

    const refused = PROCESSING.prepareLive(liveRequest(chain));

    expect(expectFailureCode(refused)).toBe('processor.state-missing');
    expect(refused.ok ? undefined : refused.failures[0].summary).toBe(reduction.state?.missing);
  });
});
