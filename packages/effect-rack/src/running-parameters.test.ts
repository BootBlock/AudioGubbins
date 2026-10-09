/**
 * A numeric parameter changed while a chain plays (REQ-AUDIO-019): it reaches
 * the running chain through the reading's running parameters, smoothed by the
 * processor's kernel, with no new run; and a chain heard from a render, which
 * was made with the value it had, refuses the change, so the page makes the
 * render again.
 */

import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  createDeterministicIdGenerator,
  derivedSampleCount,
  instantiateProcessor,
  succeed,
  type EffectChain,
  type ProcessorId,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import {
  PcmDescriptionKind,
  ProcessedStart,
  REFERENCE_DSP,
  RunningParameters,
  allocateBlock,
  describedSource,
  rampFrames,
  type ChainProcessing,
  type PcmSource,
} from '@audiogubbins/audio-engine';
import { rackedMedia, rackedPlan } from '@audiogubbins/audio-engine/testing';
import { PROCESSOR_TYPES_BY_KEY } from '@audiogubbins/processors';
import {
  TEST_RATE,
  processorValues,
  scriptedWholePass,
  type PassCounts,
} from '@audiogubbins/processors/testing';

import { chainProcessing } from './chain-run.js';

const ids = createDeterministicIdGenerator(95);
const LENGTH = 48_000;
/** Where the change is made: what playback has read when the person moves the control. */
const CHANGED_AT = 12_000;
/** The catalogue's gain, and its one parameter, its level. */
function gainType() {
  const type = PROCESSOR_TYPES_BY_KEY.get('gain');
  const level = type?.descriptor.parameters[0];
  if (type === undefined || level === undefined) throw new Error('The catalogue has a gain.');
  return { type, level };
}

const { type: GAIN, level: LEVEL } = gainType();

const SAMPLES = [
  Float32Array.from({ length: LENGTH }, (_, frame) => Math.fround(Math.sin(frame / 11) * 0.5)),
];

function gainChain(decibels: number, processor: ProcessorId = ids.next()): EffectChain {
  return {
    id: ids.next(),
    slots: [
      {
        ...instantiateProcessor(processor, GAIN.descriptor),
        values: processorValues(GAIN, { gain: decibels }),
      },
    ],
  };
}

/** The rack's processing, each run it prepares counted. */
function counted(): { readonly processing: ChainProcessing; readonly prepared: () => number } {
  const rack = chainProcessing(PROCESSOR_TYPES_BY_KEY);
  let prepared = 0;
  return {
    prepared: () => prepared,
    processing: {
      listening: (request) => rack.listening(request),
      measurementBytes: (request) => rack.measurementBytes(request),
      prepareLive: (request) => rack.prepareLive(request),
      prepare: (...args) => {
        prepared += 1;
        return rack.prepare(...args);
      },
    },
  };
}

function previewOf(
  chain: EffectChain,
  processing: ChainProcessing,
  parameters: RunningParameters,
): PcmSource {
  return expectSuccess(
    describedSource(
      {
        kind: PcmDescriptionKind.Edited,
        sampleRate: TEST_RATE,
        plan: rackedPlan(chain, LENGTH, TEST_RATE),
        media: [rackedMedia(SAMPLES, TEST_RATE)],
      },
      StandardLayouts.mono,
      REFERENCE_DSP,
      { processing, quality: MAXIMUM_QUALITY.settings, start: ProcessedStart.Preview, parameters },
    ),
  );
}

async function readFrom(source: PcmSource, start: number, frames: number): Promise<Float32Array> {
  const block = allocateBlock(source.layout, source.sampleRate, frames);
  await source.read(derivedSampleCount(start), block);
  return block.channels[0] ?? new Float32Array();
}

/**
 * The chain run straight through, `change` made after `at` frames, each call
 * the size a processed stream gives it: chunks of 4,096 from each read.
 */
async function rendered(chain: EffectChain, change?: { at: number; to: number }) {
  const run = expectSuccess(
    await chainProcessing(PROCESSOR_TYPES_BY_KEY).prepare(
      {
        chain,
        input: StandardLayouts.mono,
        sampleRate: TEST_RATE,
        length: LENGTH,
        quality: MAXIMUM_QUALITY.settings,
        blockFrames: 4_096,
        dsp: REFERENCE_DSP,
        start: 0,
      },
      () => Promise.resolve(),
    ),
  );
  const input = SAMPLES[0] ?? new Float32Array();
  const output = new Float32Array(LENGTH);
  const reads =
    change === undefined
      ? [[0, LENGTH]]
      : [
          [0, change.at],
          [change.at, LENGTH],
        ];
  for (const [from = 0, to = 0] of reads) {
    if (from === change?.at) {
      const [processor] = chain.slots;
      if (processor?.kind !== 'processor') throw new Error('The chain holds its gain.');
      expectSuccess(run.setParameter(processor.id, LEVEL.id, change.to));
    }
    for (let done = from; done < to; done += 4_096) {
      const frames = Math.min(4_096, to - done);
      run.process(
        [input.subarray(done, done + frames)],
        [output.subarray(done, done + frames)],
        frames,
      );
    }
  }
  run.release();
  return output;
}

describe('a numeric parameter changed while its chain plays', () => {
  it('takes effect with no new run, as a render with the value changed at that frame does', async () => {
    const processor: ProcessorId = ids.next();
    const chain = gainChain(-6, processor);
    const { processing, prepared } = counted();
    const parameters = new RunningParameters();
    const preview = previewOf(chain, processing, parameters);
    const before = await readFrom(preview, 0, CHANGED_AT);

    expectSuccess(parameters.apply({ stream: 1, processor, parameter: LEVEL.id, value: 0 }));
    const after = await readFrom(preview, CHANGED_AT, LENGTH - CHANGED_AT);
    preview.release();

    expect(prepared()).toBe(1);
    const expected = await rendered(chain, { at: CHANGED_AT, to: 0 });
    expect(before).toEqual(expected.subarray(0, CHANGED_AT));
    expect(after).toEqual(expected.subarray(CHANGED_AT));
    // Once the ramp has run, it is the render at the new value; before the
    // change, the render at the old one.
    const settled = CHANGED_AT + rampFrames(TEST_RATE);
    const atNew = await rendered(gainChain(0, processor));
    const atOld = await rendered(gainChain(-6, processor));
    expect(after.subarray(settled - CHANGED_AT)).toEqual(atNew.subarray(settled));
    expect(before).toEqual(atOld.subarray(0, CHANGED_AT));
    // Smoothed: no frame of the ramp jumps straight to the new level.
    expect(after[1]).not.toBe(atNew[CHANGED_AT + 1]);
  });

  it('keeps the new value through a seek, which makes the run again', async () => {
    const processor: ProcessorId = ids.next();
    const { processing, prepared } = counted();
    const parameters = new RunningParameters();
    const preview = previewOf(gainChain(-6, processor), processing, parameters);
    await readFrom(preview, 0, 4_096);
    expectSuccess(parameters.apply({ stream: 1, processor, parameter: LEVEL.id, value: 0 }));
    const sought = await readFrom(preview, 30_000, 4_096);
    preview.release();
    expect(prepared()).toBe(2);
    expect(sought).toEqual((await rendered(gainChain(0, processor))).subarray(30_000, 34_096));
  });

  it('is refused where its chain is heard from a render, and where nothing playing holds it', () => {
    const counts: PassCounts = { released: 0, live: 0, measured: [] };
    const whole = scriptedWholePass({ result: () => Promise.resolve(succeed([1])) }, counts);
    const types = new Map([...PROCESSOR_TYPES_BY_KEY, [whole.descriptor.typeKey, whole]]);
    const processor: ProcessorId = ids.next();
    const chain: EffectChain = {
      id: ids.next(),
      slots: [
        {
          ...instantiateProcessor(processor, GAIN.descriptor),
          values: processorValues(GAIN, { gain: -6 }),
        },
        instantiateProcessor(ids.next(), whole.descriptor),
      ],
    };
    const parameters = new RunningParameters();
    const preview = previewOf(chain, chainProcessing(types), parameters);
    expect(
      expectFailureCode(parameters.apply({ stream: 1, processor, parameter: LEVEL.id, value: 0 })),
    ).toBe('playback.parameter-rendered');
    expect(
      expectFailureCode(
        parameters.apply({
          stream: 1,
          processor: ids.next<'ProcessorId'>(),
          parameter: LEVEL.id,
          value: 0,
        }),
      ),
    ).toBe('playback.parameter-not-heard');
    preview.release();
  });
});
