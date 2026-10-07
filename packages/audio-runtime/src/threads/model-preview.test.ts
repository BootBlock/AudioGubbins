/**
 * A chain that runs a model, rendered by the preview worker as the application
 * wires it (ADR-0062): the preview worker's core runs the effect rack with
 * every processor type the thread makes, its machine-learning types running
 * their models through the thread's model channel; the page's end of that
 * channel answers files through a model library and hands the thread's channel
 * to the inference worker its host starts, whose core serves the fake runtime.
 * Every message crosses a channel as a structured clone, and the only stand-ins
 * are the runtime's arithmetic, DeepFilterNet 3's graphs written in TypeScript,
 * and the pack's files, read as though installed.
 *
 * So a chain holding DeepFilterNet 3 is heard from the preview worker's
 * render, the model having run; with its pack missing, or with the runtime
 * running another build than the one the model is pinned to, the render is
 * refused with which of REQ-AUDIO-139's conditions holds, and nothing plays
 * in its place.
 */

import { describe, expect, it } from 'vitest';

import { Blob as PlatformBlob } from 'node:buffer';

import {
  MAXIMUM_QUALITY,
  finalRenderSettings,
  fail,
  instantiateProcessor,
  sampleRate,
  succeed,
  unsafeBrandId,
  type DomainFailure,
  type DomainResult,
  type EffectChain,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  CachePurpose,
  PreviewClient,
  REFERENCE_DSP,
  previewPort,
} from '@audiogubbins/audio-engine';
import { rackedMedia, rackedPlan } from '@audiogubbins/audio-engine/testing';
import { chainProcessing } from '@audiogubbins/effect-rack';
import {
  InferenceHost,
  ModelChannel,
  ModelThreads,
  type ModelFileReader,
  type RuntimeIdentity,
} from '@audiogubbins/ml-runtime';
import {
  FAKE_RUNTIME,
  InProcessThread,
  TEST_ORIGIN,
  testSetup,
} from '@audiogubbins/ml-runtime/testing';
import {
  PINNED_RUNTIME_SHA256,
  PROCESSOR_CATALOGUE,
  ModelUnavailability,
  modelUnavailable,
  processorTypesWith,
} from '@audiogubbins/processors';
import {
  StandInInference,
  deepFilterNetGraphs,
  deepFilterNetPack,
} from '@audiogubbins/processors/testing';

import { ToPreviewWorkerKind } from '../protocol/preview-worker-messages.js';
import { fakeChannel } from '../testing/fake-message-channel.js';
import { PreviewWorkerCore } from '../preview/preview-worker-core.js';

const RATE = expectSuccess(sampleRate(48_000));
/** Half a second: one chunk of DeepFilterNet 3's, its warm-up and all. */
const LENGTH = 24_000;
const SAMPLES = [
  Float32Array.from({ length: LENGTH }, (_, frame) => 0.25 * Math.sin((2 * Math.PI * frame) / 96)),
];

/** DeepFilterNet 3's descriptor and the model it names, as the catalogue lists them. */
function deepFilterNet3() {
  const descriptor = PROCESSOR_CATALOGUE.get('deepfilternet-3');
  const model = descriptor?.version.model;
  if (descriptor === undefined || model === undefined) {
    throw new Error('The catalogue lists DeepFilterNet 3 with its model.');
  }
  return { descriptor, model };
}

const { descriptor: DESCRIPTOR, model: MODEL } = deepFilterNet3();

const CHAIN: EffectChain = {
  id: unsafeBrandId<'EffectChainId'>('00000000-de01'),
  slots: [instantiateProcessor(unsafeBrandId<'ProcessorId'>('00000000-de02'), DESCRIPTOR)],
};

/** The runtime build DeepFilterNet 3 is pinned to, as a session on it says. */
const PINNED_RUNTIME: RuntimeIdentity = {
  ...FAKE_RUNTIME,
  webAssemblySha256: PINNED_RUNTIME_SHA256,
};

/** DeepFilterNet 3's pack read as installed: each file the library is asked for. */
function installedPack(asked: string[]): ModelFileReader {
  const files = new Map(deepFilterNetPack().map((file) => [file.path, file]));
  return (pack, version, path) => {
    asked.push(`${pack}/${version}/${path}`);
    const file = files.get(path);
    if (pack !== MODEL.pack || version !== MODEL.version || file === undefined) {
      return Promise.resolve(
        modelUnavailable(ModelUnavailability.RequiredUnavailable, `${pack} is not installed.`, {
          pack,
          version,
          path,
        }),
      );
    }
    return Promise.resolve(succeed({ bytes: file.bytes.slice(), sha256: file.sha256 }));
  };
}

/** No pack installed: the library answers each file as a required model unavailable. */
const NOTHING_INSTALLED: ModelFileReader = (pack, version, path) =>
  Promise.resolve(
    modelUnavailable(
      ModelUnavailability.RequiredUnavailable,
      `No pack that serves ${pack} is installed.`,
      { pack, version, path },
    ),
  );

/**
 * The preview worker's core and a reader of its renders, wired as the
 * application wires them, its models answered by `files` and run by a fake
 * runtime that says it is `runtime`, whose graphs give silence.
 */
function previewWorker(files: ModelFileReader, runtime: RuntimeIdentity) {
  const inference = new StandInInference(deepFilterNetGraphs(0, 0), runtime);
  const workers: InProcessThread[] = [];
  const host = new InferenceHost({
    createWorker: () => {
      const worker = new InProcessThread(() => inference, TEST_ORIGIN);
      workers.push(worker);
      return worker;
    },
    setup: testSetup(),
  });
  const threads = new ModelThreads({
    inference: () => Promise.resolve(host),
    capabilities: testSetup().capabilities,
    files,
    createChannel: fakeChannel,
    reportFault: (summary) => {
      throw new Error(summary);
    },
  });
  // The thread's own composition: its model channel, and the types made with it.
  const models = new ModelChannel(fakeChannel);
  const core = new PreviewWorkerCore({
    post: () => undefined,
    schedule: (callback) => {
      const timer = setTimeout(callback, 0);
      return () => {
        clearTimeout(timer);
      };
    },
    processing: chainProcessing(processorTypesWith({ inference: models, models })),
    dsp: REFERENCE_DSP,
    bound: 64 * 2 ** 20,
    concurrency: 1,
    reportFault: (error) => {
      throw error;
    },
  });
  const disconnect = threads.connect({
    postMessage: (message) => {
      // The scope hands its model channel on before the core reads anything.
      if (!models.receive(message)) core.receive(message);
    },
  });
  const { port1, port2 } = fakeChannel();
  core.receive({
    kind: ToPreviewWorkerKind.Connect,
    connection: 1,
    purpose: CachePurpose.Playback,
    port: port1,
  });
  const reader = new PreviewClient(previewPort(port2));
  return { reader, inference, workers, disconnect };
}

/** What the reader hears of the racked sound's render, or why there is none. */
async function rendered(reader: PreviewClient): Promise<DomainResult<Float32Array>> {
  const stream = reader.open({
    plan: rackedPlan(CHAIN, LENGTH, RATE),
    place: 0,
    media: [rackedMedia(SAMPLES, RATE, 'memory:racked', (bytes) => new PlatformBlob([bytes]))],
    quality: finalRenderSettings(MAXIMUM_QUALITY),
  });
  const ready = await stream.ready;
  if (!ready.ok) return ready;
  const into = [new Float32Array(LENGTH)];
  try {
    await stream.read(0, LENGTH, into);
  } catch (error) {
    // A render refused is a read refused with the render's failure, which
    // the reader would play nothing for.
    const refusal: unknown = error instanceof Error ? Reflect.get(error, 'failure') : undefined;
    if (!isFailure(refusal)) throw error;
    return fail(refusal);
  } finally {
    stream.release();
  }
  return succeed(into[0] ?? new Float32Array());
}

function isFailure(value: unknown): value is DomainFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'code') === 'string' &&
    typeof Reflect.get(value, 'summary') === 'string'
  );
}

describe('a chain that runs a model, through the preview path', { timeout: 30_000 }, () => {
  it("is heard from the preview worker's render, the model run on the one inference worker the page starts", async () => {
    const asked: string[] = [];
    const { reader, inference, workers, disconnect } = previewWorker(
      installedPack(asked),
      PINNED_RUNTIME,
    );

    const heard = expectSuccess(await rendered(reader));

    // The graphs give every band and bin a gain of nothing, so what is heard
    // is the model's work and not the input passed on.
    expect(SAMPLES[0]?.some((sample) => sample !== 0)).toBe(true);
    expect(heard.every((sample) => sample === 0)).toBe(true);
    expect(asked).toEqual(
      deepFilterNetPack().map(({ path }) => `${MODEL.pack}/${MODEL.version}/${path}`),
    );
    expect(workers).toHaveLength(1);
    expect(inference.opened.every((options) => options.kind === 'pinned')).toBe(true);
    expect(inference.openSessions).toBe(0);
    disconnect();
  });

  it('is refused as a required model unavailable where its pack is not installed, and plays nothing', async () => {
    const { reader, workers } = previewWorker(NOTHING_INSTALLED, PINNED_RUNTIME);

    const refused = await rendered(reader);

    expect(refused.ok ? [] : refused.failures.map((one) => one.code)).toEqual([
      'model.unavailable',
    ]);
    expect(refused.ok ? '' : refused.failures[0].summary).toMatch(/^Required model unavailable: /);
    // No file was had, so no session was asked for and no runtime started.
    expect(workers).toHaveLength(0);
  });

  it('is refused as incompatible with the runtime where the runtime is not the build the model is pinned to', async () => {
    const asked: string[] = [];
    const { reader, inference } = previewWorker(installedPack(asked), FAKE_RUNTIME);

    const refused = await rendered(reader);

    expect(refused.ok ? [] : refused.failures.map((one) => one.code)).toEqual([
      'model.unavailable',
    ]);
    expect(refused.ok ? '' : refused.failures[0].summary).toMatch(
      /^Model incompatible with the current runtime: /,
    );
    expect(inference.openSessions).toBe(0);
  });
});
