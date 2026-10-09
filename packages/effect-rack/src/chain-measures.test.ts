/**
 * The domain's walk of a chain against the rack that runs it (ADR-0061): the
 * latency the domain finds is the latency the graph's analysis finds, for
 * every type of the catalogue alone, in series and in parallel; and the
 * lead-in the same walk finds lets a run started part way through a chain of
 * several stages give what a run from the stream's start gives.
 */

import { describe, expect, it } from 'vitest';

import {
  AmbisonicNormalisation,
  AmbisonicOrdering,
  MAXIMUM_QUALITY,
  QualityLevel,
  StandardLayouts,
  SummingLaw,
  ambisonicLayout,
  chainLatency,
  createDeterministicIdGenerator,
  instantiateProcessor,
  layoutsMatch,
  namedQualityMode,
  type ChainSlot,
  type ChannelLayout,
  type EffectChain,
  type ProcessorDescriptor,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { compileGraph } from '@audiogubbins/audio-graph';
import { BUILT_IN_NODES, REFERENCE_DSP, type ChainRequest } from '@audiogubbins/audio-engine';
import {
  ModelUnavailability,
  PROCESSOR_CATALOGUE,
  PROCESSOR_TYPES_BY_KEY,
  modelUnavailable,
  processorTypesWith,
  type ModelServices,
  type ProcessorType,
} from '@audiogubbins/processors';
import { TEST_RATE, processorValues } from '@audiogubbins/processors/testing';
import { noise } from '@audiogubbins/test-fixtures';

import { chainGraph } from './chain-graph.js';
import { chainProcessing } from './chain-run.js';

const ids = createDeterministicIdGenerator(97);

/** The layouts a type is tried on, in turn, until one is a layout it takes. */
const LAYOUTS: readonly ChannelLayout[] = [
  StandardLayouts.mono,
  StandardLayouts.stereo,
  expectSuccess(
    ambisonicLayout({
      order: 1,
      ordering: AmbisonicOrdering.Acn,
      normalisation: AmbisonicNormalisation.Sn3d,
    }),
  ),
];

/** Services no model is run through: a graph is only built and analysed here. */
const NO_MODELS: ModelServices = {
  inference: {
    open: () => {
      throw new Error('No model is run while a graph is analysed.');
    },
  },
  models: {
    file: (pack, version) =>
      Promise.resolve(
        modelUnavailable(ModelUnavailability.RequiredUnavailable, 'No pack is kept here.', {
          pack,
          version,
        }),
      ),
  },
};

/** Every type of the catalogue, those that run a model among them. */
const TYPES = processorTypesWith(NO_MODELS);

function slotOf(descriptor: ProcessorDescriptor): ChainSlot {
  return instantiateProcessor(ids.next(), descriptor);
}

function groupOf(branches: readonly (readonly ChainSlot[])[]): ChainSlot {
  return {
    kind: 'group',
    id: ids.next(),
    enabled: true,
    soloed: false,
    mix: 0.5,
    summing: SummingLaw.Mean,
    branches: branches.map((slots) => ({ slots })),
  };
}

/** The latency the graph's own analysis finds for `chain` run on `input`. */
function graphLatency(
  chain: EffectChain,
  input: ChannelLayout,
  quality: ChainRequest['quality'],
): number {
  const built = expectSuccess(
    chainGraph(chain, TYPES, input, quality, { start: 0, measured: new Map() }),
  );
  const implementations = new Map(BUILT_IN_NODES);
  for (const type of TYPES.values()) implementations.set(type.type, type);
  const compiled = compileGraph(built.graph, implementations, TEST_RATE);
  if (!compiled.ok) throw new Error(compiled.diagnostics.map((one) => one.message).join(' '));
  const latency = compiled.plan.sinks.find((sink) => sink.node === built.output)?.latency;
  if (latency?.kind !== 'known') throw new Error('The graph cannot say its latency.');
  return latency.frames;
}

describe('a chain’s latency, as the domain walks it and as the graph analyses it', () => {
  it('agrees for every type of the catalogue alone, in series and in parallel', () => {
    let compared = 0;
    for (const descriptor of PROCESSOR_CATALOGUE.values()) {
      const input = LAYOUTS.find((layout) => descriptor.outputLayout(layout, new Map()).ok);
      if (input === undefined) throw new Error(`No layout is taken by ${descriptor.typeKey}.`);
      // A type that changes the layout cannot follow itself, nor stand
      // beside a branch that keeps it.
      const keepsLayout = layoutsMatch(
        expectSuccess(descriptor.outputLayout(input, new Map())),
        input,
      );
      const shapes: readonly (readonly ChainSlot[])[] = [
        [slotOf(descriptor)],
        ...(keepsLayout
          ? [
              [slotOf(descriptor), slotOf(descriptor)],
              [groupOf([[slotOf(descriptor)], [slotOf(descriptor), slotOf(descriptor)], []])],
            ]
          : []),
      ];
      for (const slots of shapes) {
        const chain: EffectChain = { id: ids.next(), slots };
        for (const quality of [MAXIMUM_QUALITY, namedQualityMode(QualityLevel.Draft)]) {
          const settings = { sampleRate: TEST_RATE, quality: quality.settings };
          const walked = expectSuccess(chainLatency(chain, PROCESSOR_CATALOGUE, settings));
          expect(walked.kind, descriptor.typeKey).toBe('known');
          expect(walked.kind === 'known' ? walked.frames : undefined, descriptor.typeKey).toBe(
            graphLatency(chain, input, quality.settings),
          );
          compared += 1;
        }
      }
    }
    // Ambisonic encoding and decoding change the layout; every other type is
    // tried in all three shapes, at both qualities.
    expect(compared).toBe((PROCESSOR_CATALOGUE.size * 3 - 2 * 2) * 2);
  });
});

const LENGTH = TEST_RATE * 3;
const INPUT = noise(13, { length: LENGTH, amplitude: 0.3 }).channels[0] ?? new Float32Array(0);
const DELAY_TYPE = PROCESSOR_TYPES_BY_KEY.get('delay');
if (DELAY_TYPE === undefined) throw new Error('The catalogue has a delay.');
const DELAY: ProcessorType = DELAY_TYPE;

/** A half-second delay heard alone, with no feedback, so it settles exactly. */
function halfSecondDelay(): ChainSlot {
  return {
    ...instantiateProcessor(ids.next(), DELAY.descriptor),
    values: processorValues(DELAY, { time: 500, feedback: 0 }),
  };
}

/** A request to run `chain` over `INPUT` from frame `start`. */
function request(chain: EffectChain, start: number): ChainRequest {
  return {
    chain,
    input: StandardLayouts.mono,
    sampleRate: TEST_RATE,
    length: LENGTH,
    quality: MAXIMUM_QUALITY.settings,
    blockFrames: 4_096,
    dsp: REFERENCE_DSP,
    start,
  };
}

/** What a run of `chain` begun at `start` gives for frames `start` on, its latency run off. */
async function heardFrom(chain: EffectChain, start: number): Promise<Float32Array> {
  const processing = chainProcessing(PROCESSOR_TYPES_BY_KEY);
  const run = expectSuccess(
    await processing.prepare(request(chain, start), async (from, frames, into) => {
      into[0]?.set(INPUT.subarray(from, from + frames));
      await Promise.resolve();
    }),
  );
  const total = LENGTH - start + run.latency;
  const out = new Float32Array(total);
  for (let done = 0; done < total; done += 4_096) {
    const frames = Math.min(4_096, total - done);
    const real = INPUT.subarray(start + done, Math.min(LENGTH, start + done + frames));
    const block = new Float32Array(frames);
    block.set(real);
    run.process([block], [out.subarray(done, done + frames)], frames);
  }
  const { latency } = run;
  run.release();
  return out.subarray(latency);
}

/**
 * What a preview of `chain` heard from frame `from` gives there, begun where
 * a preview begins: the grid point at or before `from` less the lead-in.
 */
async function previewFrom(chain: EffectChain, from: number): Promise<Float32Array> {
  const listening = expectSuccess(
    chainProcessing(PROCESSOR_TYPES_BY_KEY).listening(request(chain, from)),
  );
  const { leadIn, frameGrid } = listening.partWay;
  const start = Math.floor(Math.max(0, from - leadIn) / frameGrid) * frameGrid;
  return (await heardFrom(chain, start)).subarray(from - start);
}

describe('a chain of several stages started part way through, as a preview starts one', () => {
  const FROM = TEST_RATE * 2;

  it('settles for two delays in series, each echoing what the other echoed', async () => {
    const chain: EffectChain = { id: ids.next(), slots: [halfSecondDelay(), halfSecondDelay()] };
    const whole = await heardFrom(chain, 0);
    expect(await previewFrom(chain, FROM)).toEqual(whole.subarray(FROM));
  });

  it('settles for a branch of two delays beside the input as it is', async () => {
    const chain: EffectChain = {
      id: ids.next(),
      slots: [groupOf([[halfSecondDelay(), halfSecondDelay()], []])],
    };
    const whole = await heardFrom(chain, 0);
    expect(await previewFrom(chain, FROM)).toEqual(whole.subarray(FROM));
  });
});
