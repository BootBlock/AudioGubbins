/**
 * A capture session wired end to end without a browser, for the session's
 * tests: a fake context whose capture nodes run the real processor and whose
 * sources play a fake input, a lifecycle over it, the session, and fake
 * channels for each take, read by the real capture channel reader.
 *
 * Time moves only when the test renders. Each render quantum advances the
 * context's clock by 128 frames while it runs, and every pending message
 * settles between quanta. Monitoring chains run through the real effect rack
 * over the processor catalogue unless a test gives another; a model is never
 * opened, since a chain with one is refused before it runs.
 */

import {
  createDiagnosticCentre,
  createLogStore,
  LogSeverity,
  type LogStore,
} from '@audiogubbins/diagnostics';
import {
  PRESET_SETTINGS,
  PerformanceProfile,
  type ChainProcessing,
  DspDeliveryKind,
} from '@audiogubbins/audio-engine';
import {
  instantiateProcessor,
  type ChainSlot,
  type IdGenerator,
  type ParameterValue,
} from '@audiogubbins/domain';
import { chainProcessing } from '@audiogubbins/effect-rack';
import {
  ModelUnavailability,
  PROCESSOR_TYPES_BY_KEY,
  modelUnavailable,
  processorTypesWith,
  type ModelServices,
} from '@audiogubbins/processors';
import { processorValues } from '@audiogubbins/processors/testing';

import { AudioContextState, type WorkletNodeShape } from '../context/audio-context-port.js';
import { ContextLifecycle } from '../context/context-lifecycle.js';
import { CaptureSession } from '../capture-session/capture-session.js';
import { RENDER_QUANTUM_FRAMES } from '../processor/loaded-graph.js';
import { FakeAudioContext, type FakeAudioContextSettings } from './fake-audio-context.js';
import { FakeCaptureNode } from './fake-capture-node.js';
import { FakeMediaStreamSource } from './fake-media-stream.js';
import { fakeChannel } from './fake-message-channel.js';
import { FakeDevices, FakeSchedule, settle } from './playback-rig.js';

/** The URL the rig says the capture processor's module is at. */
export const CAPTURE_MODULE_URL = 'capture-processor.js';

const NO_PACK = 'No model is run while capturing.';

/** Services no model runs through: a monitoring chain with one is refused before it asks. */
const NO_MODELS: ModelServices = {
  inference: {
    open: () => {
      throw new Error('No model is opened for monitoring.');
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

/** The effect rack over the whole catalogue, as the capture processor's module makes it. */
export const CAPTURE_PROCESSING: ChainProcessing = chainProcessing(processorTypesWith(NO_MODELS));

/**
 * A slot of the catalogue's processor `key`, identified from `ids`, with
 * `values` given by parameter key over its defaults: a slot of a chain a test
 * monitors through. Made here, as the rack is, since a core may not reach the
 * catalogue itself.
 */
export function catalogueSlot(
  ids: IdGenerator,
  key: string,
  values: Readonly<Record<string, ParameterValue>> = {},
): ChainSlot {
  const type = PROCESSOR_TYPES_BY_KEY.get(key);
  if (type === undefined) throw new Error(`The catalogue has no processor ${key}.`);
  return {
    ...instantiateProcessor(ids.next(), type.descriptor),
    values: processorValues(type, values),
  };
}

/** What a rig is made with. */
export interface CaptureRigOptions {
  readonly sharedMemory?: boolean;
  readonly context?: FakeAudioContextSettings;
  /** How monitoring chains run; the real rack, by default. */
  readonly processing?: ChainProcessing;
}

/** A capture session and everything it runs on. */
export class CaptureRig {
  readonly session: CaptureSession;
  readonly lifecycle: ContextLifecycle;
  readonly schedule = new FakeSchedule();
  readonly store: LogStore = createLogStore();
  readonly context: FakeAudioContext;
  readonly nodes: FakeCaptureNode[] = [];
  readonly sources: FakeMediaStreamSource[] = [];
  readonly modules: string[] = [];

  constructor(options: CaptureRigOptions = {}) {
    const logger = createDiagnosticCentre(
      this.store,
      { now: () => 0 },
      { defaultSeverity: LogSeverity.Trace, categoryOverrides: {} },
    ).loggerFor('audio-runtime');
    const context = new FakeAudioContext({ state: AudioContextState.Running, ...options.context });
    this.context = context;
    const processing = options.processing ?? CAPTURE_PROCESSING;
    Object.assign(context.audioWorklet, {
      addModule: (url: string): Promise<void> => {
        this.modules.push(url);
        return Promise.resolve();
      },
    });
    Object.assign(context, {
      createWorkletNode: (name: string, shape: WorkletNodeShape): FakeCaptureNode => {
        const node = new FakeCaptureNode(name, shape, context.sampleRate, processing);
        this.nodes.push(node);
        return node;
      },
      createMediaStreamSource: (stream: MediaStream): FakeMediaStreamSource => {
        const source = new FakeMediaStreamSource(stream);
        this.sources.push(source);
        return source;
      },
    });
    this.lifecycle = new ContextLifecycle({
      createContext: () => context,
      watchDevices: new FakeDevices().watch,
      latencyHint: PRESET_SETTINGS[PerformanceProfile.Balanced].latencyHint,
      schedule: this.schedule.schedule,
      logger,
    });
    this.session = new CaptureSession({
      lifecycle: this.lifecycle,
      capabilities: {
        playback: true,
        offlineRendering: true,
        webAssembly: true,
        sharedMemory: options.sharedMemory ?? false,
        outputSelection: false,
        gpu: false,
      },
      dsp: { kind: DspDeliveryKind.Unavailable, reason: 'This test compiles no DSP module.' },
      workletModuleUrl: CAPTURE_MODULE_URL,
      createChannel: fakeChannel,
      schedule: this.schedule.schedule,
      logger,
    });
  }

  /** The node made last. */
  get node(): FakeCaptureNode {
    const node = this.nodes.at(-1);
    if (node === undefined) throw new Error('No capture node has been made yet.');
    return node;
  }

  /** The context frame the context has reached. */
  get frame(): number {
    return Math.round(this.context.currentTime * this.context.sampleRate);
  }

  /** Renders `quanta` quanta: each connected node renders, the clock moves on, and everything settles. */
  async render(quanta: number): Promise<void> {
    const quantumMilliseconds = (RENDER_QUANTUM_FRAMES * 1000) / this.context.sampleRate;
    for (let quantum = 0; quantum < quanta; quantum += 1) {
      const frame = this.frame;
      for (const node of this.nodes) if (node.connectedTo !== undefined) node.render(frame);
      this.context.currentTime = (frame + RENDER_QUANTUM_FRAMES) / this.context.sampleRate;
      this.schedule.advance(quantumMilliseconds);
      await settle();
    }
  }
}
