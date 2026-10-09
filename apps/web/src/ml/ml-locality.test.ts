/**
 * The machine-learning path keeps the person's audio and project on their
 * device (REQ-AUDIO-138, ADR-0062): the ML locality test.
 *
 * Every way the platform offers out of the page is replaced by a recorder:
 * `fetch`, `XMLHttpRequest`, `navigator.sendBeacon`, `WebSocket`,
 * `EventSource`, `RTCPeerConnection` and `WebTransport`. The recorded `fetch`
 * answers the build's catalogue of model packs, which offers DeepFilterNet 3's
 * pack of stand-in graphs, and nothing else. Then the person's work runs as the
 * application composes it: a window over a storage worker in memory, its pack
 * downloads by the real HTTP adapter; the page's end of the model channels
 * reading the installed pack through the storage worker; and the preview,
 * render and detection workers' real cores, each running the chain with
 * DeepFilterNet 3 over its own model channel, its model on the fake runtime of
 * the inference workers the page starts.
 *
 * Opening a project, opening again one that names a pack, held or not with the
 * catalogue served, applying a chain that runs a model, previewing, rendering
 * and analysing it make no request at all. Installing the pack makes only the
 * requests the download is for: a bodiless `GET` of the catalogue and of each
 * of the pack's files, with no credentials, no referrer and no header, at a URL
 * that is the catalogue's and the pack's alone.
 *
 * What the stand-ins change. The pack's files are stand-ins whose manifest
 * states their own hashes, so the installer's integrity check passes them, and
 * the threads run DeepFilterNet 3 held to those hashes
 * (`typesRunningDeepFilterNetFiles`); the catalogue's descriptor and the
 * identity an instance persists are the real ones. The page's own entry for the
 * racked sound refuses the stand-ins as not the model the instance was made
 * with, as it must, so what the threads are asked to hear is described here
 * from the project, by the plan building the page uses. The runtime is the fake
 * one, so the read of the runtime's WebAssembly from the application's own
 * origin, the second network exception, is not made here: the adapter's own
 * test holds that read (`origin-runtime-files.test.ts`).
 */

import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  assetPlan,
  derivedSampleCount,
  finalRenderSettings,
  sampleRate,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import {
  BuiltInNodeType,
  CachePurpose,
  JobPriority,
  PcmDescriptionKind,
  PreviewClient,
  createPriorityScheduler,
  previewPort,
  type AudioFrameBlock,
  type MediaEntry,
  type PcmDescription,
} from '@audiogubbins/audio-engine';
import { graphOf, named, nodeOf, wire } from '@audiogubbins/audio-engine/testing';
import {
  DspDeliveryKind,
  PreviewHost,
  createRenderHost,
  type RenderHost,
} from '@audiogubbins/audio-runtime';
import {
  fakeChannel,
  localPreviewWorker,
  localRenderWorker,
  type LocalChainWorker,
} from '@audiogubbins/audio-runtime/testing';
import { DetectionHost, ToDetectionWorkerKind } from '@audiogubbins/detection-runtime';
import { LocalDetectionWorker } from '@audiogubbins/detection-runtime/testing';
import { InferenceHost, ModelThreads, type RuntimeIdentity } from '@audiogubbins/ml-runtime';
import { InProcessThread, TEST_ORIGIN, testSetup } from '@audiogubbins/ml-runtime/testing';
import {
  HttpPackSource,
  manifestJson,
  type LocalInferenceSupport,
  type ModelPackManifest,
} from '@audiogubbins/model-packs';
import { sampleManifest } from '@audiogubbins/model-packs/testing';
import { PINNED_RUNTIME_SHA256, PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import {
  StandInInference,
  deepFilterNetGraphs,
  deepFilterNetPack,
  typesRunningDeepFilterNetFiles,
} from '@audiogubbins/processors/testing';
import { sine } from '@audiogubbins/test-fixtures';

import { TEST_CATALOGUE } from '../testing/pack-managers.js';
import { holdPlatformFiles, windowWithAudio, type AudioWindow } from '../testing/project-audio.js';
import { projectWorld, type ProjectWindow } from '../testing/project-context.js';
import { installedModelFiles } from './installed-model-files.js';
import { createModelAvailabilityStore } from './model-availability.js';

holdPlatformFiles();

/** A request out of the page, as the entry point it went through was given it. */
interface Recorded {
  readonly api: string;
  readonly url: string;
  readonly method?: string;
  readonly headers?: unknown;
  readonly body?: unknown;
  readonly credentials?: unknown;
  readonly referrerPolicy?: unknown;
}

/** Every request recorded in the test running, in order. */
let recorded: Recorded[] = [];

/** The files the catalogue serves, by URL. */
const SERVED = new Map<string, Uint8Array<ArrayBuffer>>();

/** The URL `input` names, as `fetch` reads it. */
function urlOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return String(input);
}

/** `fetch`, recorded, answering what the catalogue serves and nothing else. */
function recordingFetch(input: unknown, init?: RequestInit): Promise<Response> {
  const url = urlOf(input);
  recorded.push({
    api: 'fetch',
    url,
    method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
    headers: init?.headers,
    body: init?.body ?? undefined,
    credentials: init?.credentials,
    referrerPolicy: init?.referrerPolicy,
  });
  const bytes = SERVED.get(url);
  return Promise.resolve(
    bytes === undefined ? new Response(null, { status: 404 }) : new Response(bytes.slice()),
  );
}

/** A connection the platform would open, recorded and never opened. */
function recordingConnection(api: string) {
  return class {
    constructor(url: unknown) {
      recorded.push({ api, url: urlOf(url) });
    }
    send(body: unknown): void {
      recorded.push({ api, url: '', body });
    }
    close(): void {
      // Nothing was opened.
    }
    addEventListener(): void {
      // Nothing will arrive.
    }
  };
}

/** `XMLHttpRequest`, recorded and never sent anywhere. */
class RecordingRequest {
  #url = '';
  #method = '';
  open(method: string, url: unknown): void {
    this.#method = method;
    this.#url = urlOf(url);
    recorded.push({ api: 'XMLHttpRequest', url: this.#url, method });
  }
  send(body?: unknown): void {
    recorded.push({ api: 'XMLHttpRequest', url: this.#url, method: this.#method, body });
  }
  setRequestHeader(): void {
    // Kept with nothing: the request is never made.
  }
  addEventListener(): void {
    // Nothing will arrive.
  }
  abort(): void {
    // Nothing was sent.
  }
}

beforeEach(() => {
  recorded = [];
  vi.stubGlobal('fetch', recordingFetch);
  vi.stubGlobal('XMLHttpRequest', RecordingRequest);
  vi.stubGlobal('WebSocket', recordingConnection('WebSocket'));
  vi.stubGlobal('EventSource', recordingConnection('EventSource'));
  vi.stubGlobal('RTCPeerConnection', recordingConnection('RTCPeerConnection'));
  vi.stubGlobal('WebTransport', recordingConnection('WebTransport'));
  vi.stubGlobal(
    'navigator',
    Object.create(navigator, {
      sendBeacon: {
        value: (url: unknown, body?: unknown) => {
          recorded.push({ api: 'sendBeacon', url: urlOf(url), body });
          return true;
        },
      },
    }),
  );
});

afterEach(() => {
  SERVED.clear();
});

/** The requests recorded since `from` were counted. */
function since(from: number): readonly Recorded[] {
  return recorded.slice(from);
}

const RATE = expectSuccess(sampleRate(48_000));
/** Half a second of a tone: one chunk of DeepFilterNet 3's, its warm-up and all. */
const LENGTH = 24_000;
const TONE = sine(440, { length: LENGTH, amplitude: 0.25 });
const MONO = StandardLayouts.mono;

/** DeepFilterNet 3's pack of stand-ins, as the catalogue offers it. */
const STAND_INS = deepFilterNetPack().map(({ path, bytes }) => ({
  path,
  bytes,
  sha256: createHash('sha256').update(bytes).digest('hex'),
}));
/** The processor types of a thread that runs chains, DeepFilterNet 3's running the stand-ins. */
const STAND_IN_TYPES = typesRunningDeepFilterNetFiles(
  STAND_INS.map(({ path, sha256 }) => ({ path, sha256 })),
);
const PACK: ModelPackManifest = {
  ...sampleManifest({
    id: 'deepfilternet-3',
    version: '1.0.0',
    processors: ['deepfilternet-3'],
    files: STAND_INS.map(({ path, bytes, sha256 }) => ({ path, bytes: bytes.length, sha256 })),
  }),
  name: 'DeepFilterNet 3',
};

/** The catalogue's URL of each of the pack's files. */
const FILE_URLS = STAND_INS.map(({ path }) => `${TEST_CATALOGUE}deepfilternet-3/1.0.0/${path}`);
const CATALOGUE_URL = `${TEST_CATALOGUE}catalogue.json`;

/** Has the recorded `fetch` serve the catalogue and the pack's files. */
function serveCatalogue(): void {
  SERVED.set(
    CATALOGUE_URL,
    new TextEncoder().encode(JSON.stringify({ format: 1, packs: [manifestJson(PACK)] })),
  );
  for (const [index, file] of STAND_INS.entries()) SERVED.set(FILE_URLS[index] ?? '', file.bytes);
}

/** The runtime the page ships, as the fake runtime says it is: the build every model is pinned to. */
const PINNED_RUNTIME: RuntimeIdentity = {
  name: 'onnxruntime-web',
  version: '1.30.0',
  webAssemblySha256: PINNED_RUNTIME_SHA256,
};

const CAPABLE_DEVICE: LocalInferenceSupport = {
  status: 'full',
  explanation: '',
  missingRequired: [],
  missingPreferred: [],
};

/**
 * The project of `audio` closed and opened again, once `opened` holds of the
 * page: what opening reads the project for has been made.
 */
async function reopened(
  audio: AudioWindow,
  opened: (window: ProjectWindow) => unknown,
): Promise<AudioWindow> {
  const { window } = audio;
  const project = window.projects.project.session()?.project ?? '';
  await window.runAndHear('file.close-project');
  await window.runAndHear('file.open', { project });
  const session = window.projects.project.session();
  if (session === undefined) throw new Error('The project did not open again to change.');
  await expect.poll(() => opened(window), { timeout: 5000 }).toBeTruthy();
  return { ...audio, session };
}

/** Why the page leaves the sound of `audio` unopened, once it has said. */
function unopenedReason(audio: AudioWindow): (window: ProjectWindow) => string | undefined {
  return (window) => window.context.assets.get().unopened.get(audio.entry)?.reason;
}

/**
 * A window whose storage worker downloads packs by HTTP from the catalogue,
 * with the tone imported into a project, which is closed and opened again,
 * and its sound open in an editor in use.
 */
async function openedProject(): Promise<AudioWindow> {
  const world = projectWorld(undefined, (catalogue) => new HttpPackSource(catalogue));
  const imported = await windowWithAudio({ world, fixture: TONE, name: 'Quay' });
  const audio = await reopened(imported, (window) => window.context.assets.find(imported.entry));
  const { window } = audio;
  const asset = audio.asset();
  window.context.editorViews.open('editor', asset);
  window.context.editorViews.measured('editor', 1000, asset.length);
  window.context.editorViews.focus('editor');
  return audio;
}

/**
 * Gives the open sound a rack holding DeepFilterNet 3, as the Effects rack
 * panel does, before any pack is installed: the rack is kept, and the model
 * said to be missing, from what the device keeps alone.
 */
async function racked(audio: AudioWindow): Promise<void> {
  expect(await audio.window.runAndHear('rack.add-processor', { typeKey: 'deepfilternet-3' })).toBe(
    'Gave “Quay” a rack, with “DeepFilterNet 3” in it. It cannot run yet: DeepFilterNet 3 cannot run because the model it needs is not available. No pack this device keeps or the catalogue offers serves deepfilternet-3.',
  );
}

/** Installs the pack the catalogue offers, as the Model packs panel does. */
async function installed(window: ProjectWindow): Promise<void> {
  expect(await window.runAndHear('packs.refresh-catalogue')).toBe(
    'The catalogue offers 1 model pack version.',
  );
  await window.runAndHear('packs.install', { id: PACK.id, version: PACK.version });
  expect(await window.nextSaid()).toBe(
    'Installed DeepFilterNet 3 1.0.0. Every file matched its SHA-256.',
  );
}

/** The file the sound reads, as the page describes it to a thread before any rack. */
function mediaOf(audio: AudioWindow): readonly MediaEntry[] {
  const described = audio.asset().describe();
  if (described.kind !== PcmDescriptionKind.Edited) throw new Error('The sound is edited audio.');
  return described.media;
}

/**
 * The racked sound as the threads are asked to hear it: its plan, built as the
 * page builds it from the project's records and chains, and the file it reads.
 */
function heard(audio: AudioWindow, media: readonly MediaEntry[]): PcmDescription {
  const { state } = audio.session.getSnapshot().model;
  const asset = state.project.assets.get(audio.assetId);
  if (asset === undefined) throw new Error('The sound is in the project.');
  const plan = expectSuccess(
    assetPlan(asset, { chains: state.project.effectChains, catalogue: PROCESSOR_CATALOGUE }),
  );
  return { kind: PcmDescriptionKind.Edited, sampleRate: RATE, plan, media };
}

/**
 * The threads that run chains as the page starts them, each connected to the
 * page's end of the model channels as it starts (`model-services.ts`): the
 * model library reads the window's installed packs through its storage
 * worker, and the inference workers run the stand-in graphs on the fake
 * runtime, which says it is the build every model is pinned to.
 */
function chainThreads(window: ProjectWindow) {
  const availability = createModelAvailabilityStore({
    packs: window.services.client.packs,
    runtime: () => Promise.resolve(PINNED_RUNTIME),
    device: () => CAPABLE_DEVICE,
    unknown: (reason) => {
      throw new Error(`Which model packs can run could not be read: ${reason}`);
    },
  });
  // A gain and a tap of a half: the model's work is heard, and is not silence.
  const inference = new StandInInference(deepFilterNetGraphs(0.5, 0.5), PINNED_RUNTIME);
  const host = new InferenceHost({
    createWorker: () => new InProcessThread(() => inference, TEST_ORIGIN),
    setup: testSetup(),
  });
  const threads = new ModelThreads({
    inference: () => Promise.resolve(host),
    capabilities: testSetup().capabilities,
    files: installedModelFiles({
      files: window.services.client.packs,
      context: availability.current,
    }),
    createChannel: fakeChannel,
    reportFault: (summary) => {
      throw new Error(summary);
    },
  });
  const started = (worker: LocalChainWorker): LocalChainWorker => {
    threads.connect(worker);
    return worker;
  };
  const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('audio');
  const previews = new PreviewHost({
    createWorker: () => started(localPreviewWorker(STAND_IN_TYPES)),
    createChannel: fakeChannel,
    logger,
  });
  const renders = createRenderHost({
    createWorker: () => started(localRenderWorker(STAND_IN_TYPES)),
    scheduler: expectSuccess(
      createPriorityScheduler({ concurrency: 1, backgroundConcurrencyWhileInteractive: 1 }),
    ),
    dsp: { kind: DspDeliveryKind.Unavailable, reason: 'The test renders on the reference DSP.' },
    schedule: (callback, milliseconds) => {
      const timer = setTimeout(callback, milliseconds);
      return () => {
        clearTimeout(timer);
      };
    },
  });
  // As `detection-threads.ts` starts the detection worker: connected to the
  // model channels, and to the preview worker, whose render it analyses.
  const detections = new DetectionHost({
    createWorker: () => {
      const worker = new LocalDetectionWorker({
        types: STAND_IN_TYPES,
        createChannel: fakeChannel,
      });
      threads.connect(worker);
      worker.post(
        {
          kind: ToDetectionWorkerKind.Previews,
          port: previews.connect(CachePurpose.Analysis).port,
        },
        [],
      );
      return worker;
    },
  });
  return { inference, previews, renders, detections };
}

/** What the preview worker's render of `described` gives a reader, as playback reads it. */
async function previewed(previews: PreviewHost, described: PcmDescription): Promise<Float32Array> {
  if (described.kind !== PcmDescriptionKind.Edited) throw new Error('The sound is edited audio.');
  const reader = new PreviewClient(previewPort(previews.connect(CachePurpose.Playback).port));
  const stream = reader.open({
    plan: described.plan,
    place: 0,
    media: described.media,
    quality: finalRenderSettings(MAXIMUM_QUALITY),
  });
  expectSuccess(await stream.ready);
  const into = [new Float32Array(LENGTH)];
  await stream.read(0, LENGTH, into);
  stream.release();
  return into[0] ?? new Float32Array();
}

/** What a render worker's final render of `described` writes. */
async function rendered(renders: RenderHost, described: PcmDescription): Promise<Float32Array> {
  const graph = graphOf(
    [
      nodeOf('sound', BuiltInNodeType.GraphInput, MONO, { outputs: ['out'] }),
      nodeOf('out', BuiltInNodeType.Output, MONO, { inputs: ['in'] }),
    ],
    [wire('sound.out', 'out.in')],
  );
  const written = new Float32Array(LENGTH);
  let at = 0;
  const sink = {
    write: (block: AudioFrameBlock) => {
      written.set(block.channels[0]?.subarray(0, block.frames) ?? [], at);
      at += block.frames;
      return Promise.resolve();
    },
  };
  expectSuccess(
    await renders.render(
      {
        graph,
        sampleRate: RATE,
        range: { start: derivedSampleCount(0), length: derivedSampleCount(LENGTH) },
        chunkFrames: 4_800,
        quality: MAXIMUM_QUALITY,
        sources: [{ ...described, node: named('sound') }],
      },
      { priority: JobPriority.Foreground, sinks: new Map([[named('out'), sink]]) },
    ),
  );
  return written;
}

/** Whether two signals differ anywhere. */
function differ(one: Float32Array, other: Float32Array): boolean {
  return one.some((sample, frame) => sample !== other[frame]);
}

// Each test imports audio and runs a storage worker, and the last a model on
// three threads, in the test's own thread, which takes seconds under the
// whole suite's load.
describe(
  'the machine-learning path, kept on the device (REQ-AUDIO-138)',
  { timeout: 60_000, tags: ['ml-locality'] },
  () => {
    it('opens a project and applies a chain that runs a model, making no request', async () => {
      const from = recorded.length;

      await racked(await openedProject());

      expect(since(from)).toEqual([]);
    });

    it('opens again a project that names a pack this device does not hold, the catalogue served, making no request', async () => {
      serveCatalogue();
      const audio = await openedProject();
      await racked(audio);
      const from = recorded.length;

      const again = await reopened(audio, unopenedReason(audio));

      expect(since(from)).toEqual([]);
      expect(unopenedReason(audio)(again.window)).toMatch(
        /^DeepFilterNet 3 cannot run because the model it needs is not available\. /,
      );
    });

    it('opens again a project that names a pack this device holds, making no request', async () => {
      serveCatalogue();
      const audio = await openedProject();
      await racked(audio);
      await installed(audio.window);
      const from = recorded.length;

      // The page refuses the stand-ins as not the model the instance was made
      // with, which it can say only once it has read the installed pack.
      const again = await reopened(audio, (window) =>
        unopenedReason(audio)(window)?.includes('is not the model'),
      );

      expect(since(from)).toEqual([]);
      expect(unopenedReason(audio)(again.window)).toMatch(
        /The installed DeepFilterNet 3 1\.0\.0 is not the model this instance was made with\.$/,
      );
    });

    it('installs the pack by bodiless GETs of its catalogue and files alone, carrying nothing of the person or the project', async () => {
      serveCatalogue();
      const audio = await openedProject();
      await racked(audio);
      const from = recorded.length;

      await installed(audio.window);

      const requests = since(from);
      expect(requests.map((one) => one.url).toSorted()).toEqual(
        [CATALOGUE_URL, ...FILE_URLS].toSorted(),
      );
      for (const request of requests) {
        expect(request).toEqual({
          api: 'fetch',
          url: request.url,
          method: 'GET',
          headers: {},
          body: undefined,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
      }
      // Named, though the URLs above are the catalogue's and the pack's alone.
      const project = audio.window.projects.project.session()?.project ?? '';
      for (const part of [project, 'Harbour', 'Quay', audio.assetId]) {
        expect(requests.filter((one) => one.url.includes(part))).toEqual([]);
      }
    });

    it('previews, renders and analyses the chain, its model run from the installed pack, making no request', async () => {
      serveCatalogue();
      const audio = await openedProject();
      const media = mediaOf(audio);
      await racked(audio);
      await installed(audio.window);
      const { inference, previews, renders, detections } = chainThreads(audio.window);
      const from = recorded.length;

      const preview = await previewed(previews, heard(audio, media));
      const render = await rendered(renders, heard(audio, media));
      const analysed = await detections.detect({
        target: 'asset',
        identity: 'the racked sound',
        channels: 1,
        describe: () => heard(audio, media),
        quality: MAXIMUM_QUALITY,
        range: { start: derivedSampleCount(0), end: derivedSampleCount(LENGTH) },
        assistants: ['classification', 'repair', 'restoration'],
      });

      expect(since(from)).toEqual([]);
      // The model ran, from the files the installer kept, on pinned sessions,
      // and what was heard is its work, not the tone passed on. The preview
      // worker's pass and the render worker's own each open every graph.
      expect(inference.opened.length).toBeGreaterThanOrEqual(2 * STAND_INS.length);
      expect(inference.opened.every((options) => options.kind === 'pinned')).toBe(true);
      const tone = TONE.channels[0] ?? new Float32Array();
      expect(differ(preview, tone)).toBe(true);
      expect(differ(render, tone)).toBe(true);
      expect(differ(render, preview)).toBe(false);
      expect(analysed.kind).toBe('done');
    });
  },
);
