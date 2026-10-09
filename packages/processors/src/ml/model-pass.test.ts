import { describe, expect, it } from 'vitest';

import {
  FailureKind,
  StandardLayouts,
  createCancellationSource,
  fail,
  failure,
  modelHashOf,
  sampleRate,
  succeed,
  type CancellationSignal,
  type DomainResult,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { REFERENCE_DSP, ResamplingQuality } from '@audiogubbins/audio-engine';
import type {
  InferenceOptions,
  InferencePort,
  InferenceSession,
  ModelBytes,
  Tensor,
} from '@audiogubbins/ml-runtime';

import { TEST_RATE } from '../testing/processor-run.js';
import { FakeModels, MemoryModelLibrary, sha256Of } from '../testing/model-services.js';
import { modelPassOf, passOver, planarChannels } from '../testing/model-runs.js';
import {
  RECURRENT_MODEL,
  RECURRENT_MODEL_BYTES,
  RECURRENT_MODEL_HASH,
  RECURRENT_MODEL_PATH,
  RECURRENT_MODEL_SHA256,
  RECURRENT_PACK,
  RECURRENT_VERSION,
  recurrence,
  recurrentDefinition,
  recurrentProcessor,
} from '../testing/recurrent-model.js';
import { MOST_OUTPUT_SAMPLES } from './model-pass.js';
import { modelProcessorType } from './model-processor.js';
import type { ModelServices } from './model-sessions.js';

const MODEL_RATE = expectSuccess(sampleRate(16_000));
const MONO = StandardLayouts.mono;
const STEREO = StandardLayouts.stereo;

function library(bytes: ModelBytes = RECURRENT_MODEL_BYTES): MemoryModelLibrary {
  return new MemoryModelLibrary([
    { pack: RECURRENT_PACK, version: RECURRENT_VERSION, path: RECURRENT_MODEL_PATH, bytes },
  ]);
}

function runtime(): FakeModels {
  return new FakeModels(new Map([[sha256Of(RECURRENT_MODEL_BYTES), RECURRENT_MODEL]]));
}

/** The test processor's type at the stream's rate over `services`. */
function typeOver(services: ModelServices, definition = recurrentDefinition(TEST_RATE)) {
  return modelProcessorType(recurrentProcessor(definition), services);
}

/** A stream of `frames` frames on each of `channels` channels, each channel distinct. */
function stream(frames: number, channels = 1): Float32Array[] {
  return Array.from({ length: channels }, (_, channel) =>
    Float32Array.from({ length: frames }, (_, frame) =>
      Math.fround((((frame * 7 + channel * 13) % 23) - 11) / 16),
    ),
  );
}

/**
 * What the join rule makes of one channel, stated here apart from the code:
 * runs of 256 + 64 frames, the first from frame 0 keeping its first 256, each
 * later one from 64 frames before its chunk, keeping the chunk alone.
 */
function scheduled(channel: Float32Array): Float32Array {
  const out = new Float32Array(channel.length);
  for (let kept = 0; kept < channel.length; kept += 256) {
    const first = kept === 0 ? 0 : kept - 64;
    const heard = new Float32Array(320);
    heard.set(channel.subarray(first, first + 320));
    const keep = Math.min(256, channel.length - kept);
    out.set(recurrence(heard).subarray(kept - first, kept - first + keep), kept);
  }
  return out;
}

function codesOf<T>(result: DomainResult<T>): readonly string[] {
  return result.ok ? [] : result.failures.map((one) => one.code);
}

describe("the test model's names", () => {
  it("are its file's hash and its pack's listing digest, which the chains' tests take as constants", () => {
    expect(sha256Of(RECURRENT_MODEL_BYTES)).toBe(RECURRENT_MODEL_SHA256);
    const files = [{ path: RECURRENT_MODEL_PATH, sha256: sha256Of(RECURRENT_MODEL_BYTES) }];
    expect(modelHashOf(files, (text) => sha256Of(new TextEncoder().encode(text)))).toBe(
      RECURRENT_MODEL_HASH,
    );
  });
});

describe('a model pass', () => {
  it('joins its runs by the schedule, the same however the stream is read in chunks', async () => {
    const input = stream(12_000, 2);
    const expected = input.map(scheduled);
    for (const chunks of [[12_000], [1], [7, 300, 64], [256], [5_000, 1]]) {
      const services = { inference: runtime(), models: library() };
      const measured = expectSuccess(
        await passOver(modelPassOf(typeOver(services), { layout: STEREO }), input, chunks),
      );
      expect(planarChannels(measured, 2), `chunks of ${chunks.join(', ')}`).toEqual(expected);
      expect(services.inference.openSessions).toBe(0);
    }
  });

  it("keeps a frame's output the same in a longer stream, its runs being fixed lengths", async () => {
    const services = { inference: runtime(), models: library() };
    const short = stream(700);
    const long = stream(2_000);
    const of = async (input: Float32Array[]) =>
      planarChannels(
        expectSuccess(await passOver(modelPassOf(typeOver(services), { layout: MONO }), input)),
        1,
      )[0];
    expect((await of(long))?.subarray(0, 512)).toEqual((await of(short))?.subarray(0, 512));
  });

  it("converts the stream to the model's rate by the canonical resampler, and back", async () => {
    // Heard at 16 kHz, a stream at 48 kHz is what the canonical resampler
    // makes of it, and the model's output is converted back the same way.
    const input = stream(4_800);
    const convert = (channel: Float32Array, from: number, to: number): Float32Array => {
      const resampler = expectSuccess(
        REFERENCE_DSP.createResampler({
          from: expectSuccess(sampleRate(from)),
          to: expectSuccess(sampleRate(to)),
          channels: 1,
          quality: ResamplingQuality.Maximum,
        }),
      );
      resampler.push([channel]);
      resampler.finish();
      const out = new Float32Array(Math.ceil((channel.length * to) / from) + 64);
      const written = resampler.pull([out]);
      resampler.release();
      return out.slice(0, written);
    };
    const heard = convert(input[0] ?? new Float32Array(0), 48_000, 16_000);
    const back = convert(scheduled(heard), 16_000, 48_000);
    const expected = new Float32Array(input[0]?.length ?? 0);
    expected.set(back.subarray(0, expected.length));
    const services = { inference: runtime(), models: library() };
    const measured = expectSuccess(
      await passOver(
        modelPassOf(typeOver(services, recurrentDefinition(MODEL_RATE)), { layout: MONO }),
        input,
        [1_000],
      ),
    );
    expect(planarChannels(measured, 1)).toEqual([expected]);
  });

  it('opens one pinned session for the whole pass, at the stated optimisation level', async () => {
    const services = { inference: runtime(), models: library() };
    const definition = recurrentDefinition(TEST_RATE);
    expectSuccess(
      await passOver(
        modelPassOf(typeOver(services, definition), { layout: STEREO }),
        stream(2_000, 2),
        [100],
      ),
    );
    expect(services.inference.opened).toEqual([definition.inference]);
    expect(services.models.asked).toEqual([
      `${RECURRENT_PACK}/${RECURRENT_VERSION}/${RECURRENT_MODEL_PATH}`,
    ]);
  });
});

describe('a model pass refuses, with the reason, and lets its sessions go', () => {
  it('a file whose bytes are not the model the build runs', async () => {
    const services = { inference: runtime(), models: library(new Uint8Array([1, 2, 3])) };
    const answer = await passOver(modelPassOf(typeOver(services), { layout: MONO }), stream(500));
    expect(codesOf(answer)).toEqual(['model.file-mismatch']);
    expect(services.inference.opened).toEqual([]);
  });

  it('a runtime that is not the build the model is pinned to, as a model incompatible with the runtime', async () => {
    const services = { inference: runtime(), models: library() };
    const pinnedElsewhere = recurrentDefinition(TEST_RATE, 'a'.repeat(64));
    const answer = await passOver(
      modelPassOf(typeOver(services, pinnedElsewhere), { layout: MONO }),
      stream(500),
    );
    expect(codesOf(answer)).toEqual(['model.unavailable']);
    expect(answer.ok ? undefined : answer.failures[0]).toMatchObject({
      details: { condition: 'incompatible', pack: RECURRENT_PACK },
      cause: { code: 'model.runtime-mismatch' },
    });
    expect(services.inference.opened).toHaveLength(1);
    expect(services.inference.openSessions).toBe(0);
  });

  it('a pack the library does not hold, saying which condition holds', async () => {
    const services = { inference: runtime(), models: new MemoryModelLibrary([]) };
    const answer = await passOver(modelPassOf(typeOver(services), { layout: MONO }), stream(500));
    expect(codesOf(answer)).toEqual(['model.unavailable']);
    expect(answer.ok ? {} : answer.failures[0].details).toMatchObject({
      condition: 'required-unavailable',
      pack: RECURRENT_PACK,
    });
  });

  it('a stream whose output would pass the bound, before it runs anything past it', async () => {
    const services = { inference: runtime(), models: library() };
    const pass = modelPassOf(typeOver(services), { layout: STEREO });
    const input = stream(1_000, 2);
    await pass.add(input, 1_000);
    expect(services.inference.openSessions).toBe(1);
    // Half the bound a channel, and a frame more: the stereo output passes it.
    await pass.add(input, MOST_OUTPUT_SAMPLES / 2 - 1_000 + 1);
    expect(services.inference.openSessions).toBe(0);
    const answer = await pass.result();
    pass.release();
    expect(codesOf(answer)).toEqual(['processor.model-output-too-long']);
  });

  it('a model that gives samples that are not finite, at the first of them, running nothing more', async () => {
    for (const [layout, spoilt, value, at] of [
      // The second run of the one channel: its kept chunk starts at 256.
      [MONO, 2, Number.NaN, { channel: 0, frame: 256 }],
      // The first run of the second channel.
      [STEREO, 2, Number.POSITIVE_INFINITY, { channel: 1, frame: 0 }],
      [STEREO, 3, Number.NEGATIVE_INFINITY, { channel: 0, frame: 256 }],
    ] as const) {
      const model = spoiling(spoilt, value);
      const services = {
        inference: new FakeModels(new Map([[sha256Of(RECURRENT_MODEL_BYTES), model]])),
        models: library(),
      };
      const answer = await passOver(
        modelPassOf(typeOver(services), { layout }),
        stream(3_000, layout.roles.length),
        [256],
      );
      expect(codesOf(answer)).toEqual(['processor.model-output-not-finite']);
      expect(answer.ok ? {} : answer.failures[0].details).toMatchObject(at);
      // Twelve runs a channel make the stream; the pass stops at the run after.
      expect(model.calls).toBeLessThanOrEqual(spoilt + layout.roles.length);
      expect(services.inference.openSessions).toBe(0);
    }
  });

  it('a run the runtime fails', async () => {
    const services = { inference: failingRun(runtime(), 2), models: library() };
    const answer = await passOver(modelPassOf(typeOver(services), { layout: MONO }), stream(3_000));
    expect(codesOf(answer)).toEqual(['inference.run-failed']);
    expect(services.inference.ran).toBe(2);
    expect(services.inference.inner.openSessions).toBe(0);
  });
});

describe('a cancelled model pass', () => {
  it('throws the cancellation, runs nothing more and lets its session go', async () => {
    const services = {
      inference: failingRun(runtime(), Number.POSITIVE_INFINITY),
      models: library(),
    };
    const source = createCancellationSource();
    const pass = modelPassOf(typeOver(services), { layout: MONO });
    const input = stream(1_000);
    await pass.add(input, 1_000, source.signal);
    const ran = services.inference.ran;
    source.cancel();
    await expect(pass.add(input, 1_000, source.signal)).rejects.toThrow();
    await expect(pass.result(source.signal)).rejects.toThrow();
    pass.release();
    expect(services.inference.ran).toBe(ran);
    expect(services.inference.inner.openSessions).toBe(0);
  });

  it('cancelled while a run is answered, throws rather than answering a refusal', async () => {
    const source = createCancellationSource();
    const services = {
      inference: failingRun(runtime(), Number.POSITIVE_INFINITY, () => {
        source.cancel();
      }),
      models: library(),
    };
    const pass = modelPassOf(typeOver(services), { layout: MONO });
    await expect(passOver(pass, stream(1_000), [1_000], source.signal)).rejects.toThrow();
    expect(services.inference.inner.openSessions).toBe(0);
  });
});

/**
 * The recurrent model, whose `spoilt`th call answers `value` in every sample,
 * counting its calls.
 */
function spoiling(spoilt: number, value: number) {
  const model = {
    ...RECURRENT_MODEL,
    calls: 0,
    run: (inputs: ReadonlyMap<string, Tensor>) => {
      model.calls += 1;
      const answer = RECURRENT_MODEL.run(inputs);
      if (model.calls === spoilt) answer.get('y')?.data.fill(value);
      return answer;
    },
  };
  return model;
}

/**
 * The port `inner` is, whose sessions' runs fail from the `failAt`th on and
 * call `during` as each is run, counting the runs.
 */
function failingRun(inner: FakeModels, failAt: number, during: () => void = () => undefined) {
  const port = {
    inner,
    ran: 0,
    async open(model: ModelBytes, options: InferenceOptions, signal?: CancellationSignal) {
      const opened = await inner.open(model, options, signal);
      if (!opened.ok) return opened;
      const session = opened.value;
      const wrapped: InferenceSession = {
        inputs: session.inputs,
        outputs: session.outputs,
        execution: session.execution,
        run: (inputs: ReadonlyMap<string, Tensor>, runSignal?: CancellationSignal) => {
          port.ran += 1;
          during();
          if (port.ran >= failAt) {
            return Promise.resolve(
              fail(failure('inference.run-failed', FailureKind.Unrecoverable, 'The run failed.')),
            );
          }
          return session.run(inputs, runSignal);
        },
        release: () => {
          session.release();
        },
      };
      return succeed(wrapped);
    },
  } satisfies InferencePort & { inner: FakeModels; ran: number };
  return port;
}
