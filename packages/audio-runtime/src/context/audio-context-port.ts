/**
 * The members of an `AudioContext` the runtime uses, and nothing else.
 *
 * The runtime is given a context through this port rather than constructing
 * one, so its lifecycle is tested against a fake that suspends, resumes and
 * closes on the test's word: jsdom has no `AudioContext`, and a real one would
 * answer to the machine's devices rather than to the test. The browser's
 * adapter below is the one place a real context, worklet node and media stream
 * source are made.
 */

import type { AudioRuntimeCapabilities } from '@audiogubbins/capabilities';
import type { LatencyHint } from '@audiogubbins/audio-engine';

import { routeToDevice } from './device-routing.js';

/**
 * What the browser says a context is doing. `interrupted` is Safari's: the
 * system took the device, for a call or another application, and the context
 * resumes only when it is given back.
 */
export const AudioContextState = {
  Suspended: 'suspended',
  Running: 'running',
  Closed: 'closed',
  Interrupted: 'interrupted',
} as const;

/** What the browser says a context is doing. */
export type AudioContextState = (typeof AudioContextState)[keyof typeof AudioContextState];

/** Where a context's output goes: the device, as the context sees it. */
export interface AudioDestinationPort {
  /** The most channels the device takes. */
  readonly maxChannelCount: number;
  /** The channels the context sends it, at most `maxChannelCount`. */
  channelCount: number;
  /** Whether what arrives is mixed to `channelCount` (`explicit`) or to a count of its own. */
  channelCountMode: 'max' | 'clamped-max' | 'explicit';
  /** Whether channels are mixed as speakers or passed one by one (`discrete`). */
  channelInterpretation: 'speakers' | 'discrete';
}

/**
 * What a worklet port says: a message, or `messageerror` for one that arrived
 * and could not be received, which a browser reports in no other way.
 */
export type WorkletPortEvent = 'message' | 'messageerror';

/** The message port between the main thread and a worklet processor. */
export interface WorkletMessagePort {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: WorkletPortEvent, listener: (event: MessageEvent) => void): void;
  removeEventListener(type: WorkletPortEvent, listener: (event: MessageEvent) => void): void;
  /** Starts delivery, which a port listened to with `addEventListener` needs. */
  start(): void;
}

/**
 * A node running a worklet processor: one output, and the input its shape
 * gives it, which a media stream source feeds.
 */
export interface WorkletNodePort {
  readonly port: WorkletMessagePort;
  /**
   * Connects the output to the context's own destination, the only place it
   * plays to, with output channel `outputChannelOf[k]` on the destination's
   * channel `k`.
   */
  connect(destination: AudioDestinationPort, outputChannelOf: readonly number[]): void;
  disconnect(): void;
}

/**
 * How a worklet node is shaped. The engine renders its own graph and hands
 * the context finished channels, so its node has no input. The capture
 * processor has one, of the input's own channel count, taken channel by
 * channel: the browser neither mixes the input up or down to another count
 * nor reads its channels as speakers, so what the processor is given is what
 * the device captured (REQ-ARCH-157, ADR-0070).
 */
export type WorkletNodeShape =
  | {
      readonly outputChannelCount: readonly number[];
      readonly numberOfInputs: 0;
      readonly numberOfOutputs: 1;
    }
  | {
      readonly outputChannelCount: readonly number[];
      readonly numberOfInputs: 1;
      readonly numberOfOutputs: 1;
      /** The input's channels, exactly as many as the source captures. */
      readonly inputChannelCount: number;
    };

/** An input the application opened, as a source node of the context. */
export interface MediaStreamSourcePort {
  /** Feeds the input of `node`, a node of the same context with one input. */
  connect(node: WorkletNodePort): void;
  disconnect(): void;
}

/** The members of an audio context the runtime uses. */
export interface AudioContextPort {
  readonly state: AudioContextState;
  /** Frames per second the context runs at, fixed for its life. */
  readonly sampleRate: number;
  /** Seconds of audio the context has played, which stops advancing while it is not running. */
  readonly currentTime: number;
  /** Seconds the context itself adds between the processor and the device. */
  readonly baseLatency: number;
  /**
   * Seconds the device adds after the context, as the browser estimates it,
   * or `undefined` where the browser offers no estimate.
   */
  readonly outputLatency: number | undefined;
  readonly destination: AudioDestinationPort;

  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;

  addEventListener(type: 'statechange', listener: () => void): void;
  removeEventListener(type: 'statechange', listener: () => void): void;

  readonly audioWorklet: { addModule(url: string): Promise<void> };
  createWorkletNode(processorName: string, shape: WorkletNodeShape): WorkletNodePort;

  /**
   * A source of the input `stream` carries, which the application opened
   * through the capabilities' media input adapter and gave the runtime: the
   * runtime opens no input of its own (ADR-0070).
   */
  createMediaStreamSource(stream: MediaStream): MediaStreamSourcePort;

  /** Sends the output to another device; present only where output selection is a capability. */
  readonly setSinkId?: (deviceId: string) => Promise<void>;
}

/** What a context is created with. */
export interface AudioContextOptions {
  readonly latencyHint: LatencyHint;
  /** The rate to run at; the device's own where absent. */
  readonly sampleRate?: number;
}

/** Makes an audio context. */
export type CreateAudioContext = (options: AudioContextOptions) => AudioContextPort;

/** A context whose output device can be chosen. */
interface SinkSelectingContext extends AudioContext {
  setSinkId(deviceId: string): Promise<void>;
}

/**
 * Whether this context carries `setSinkId`, which the DOM definitions this
 * package compiles against do not yet declare. Asked only once the
 * capabilities have said output selection is offered, so it narrows the type
 * rather than deciding anything.
 */
function selectsSink(context: AudioContext): context is SinkSelectingContext {
  return typeof Reflect.get(context, 'setSinkId') === 'function';
}

/**
 * The device's output latency, or `undefined` where the browser offers no
 * estimate: the DOM definitions declare it on every context, but browsers
 * shipped contexts without it for years.
 */
function outputLatencyOf(context: AudioContext): number | undefined {
  const latency: unknown = Reflect.get(context, 'outputLatency');
  return typeof latency === 'number' ? latency : undefined;
}

/** The options a node of `shape` is made with. */
function workletOptions(shape: WorkletNodeShape): AudioWorkletNodeOptions {
  const outputs = {
    numberOfOutputs: shape.numberOfOutputs,
    outputChannelCount: [...shape.outputChannelCount],
  };
  if (shape.numberOfInputs === 0) return { ...outputs, numberOfInputs: 0 };
  return {
    ...outputs,
    numberOfInputs: 1,
    channelCount: shape.inputChannelCount,
    channelCountMode: 'explicit',
    channelInterpretation: 'discrete',
  };
}

/**
 * The context's worklet nodes and sources, as ports. Each port it hands out is
 * remembered with the node behind it, so a source connects only to a node of
 * its own context, which is the one kind of node the port names.
 */
class ContextNodes {
  readonly #context: AudioContext;
  readonly #nodes = new WeakMap<WorkletNodePort, AudioWorkletNode>();

  constructor(context: AudioContext) {
    this.#context = context;
  }

  workletNode(processorName: string, shape: WorkletNodeShape): WorkletNodePort {
    const context = this.#context;
    const node = new AudioWorkletNode(context, processorName, workletOptions(shape));
    let unroute = (): void => {
      node.disconnect();
    };
    const port: WorkletNodePort = {
      port: node.port,
      connect: (destination, outputChannelOf) => {
        // The port's destination is the context's own node, handed out below,
        // so anything else is a node from another context, which the browser
        // would refuse less clearly.
        if (destination !== context.destination) {
          throw new Error('A worklet node plays only to the destination of its own context.');
        }
        unroute = routeToDevice(context, node, outputChannelOf);
      },
      disconnect: () => {
        unroute();
      },
    };
    this.#nodes.set(port, node);
    return port;
  }

  mediaStreamSource(stream: MediaStream): MediaStreamSourcePort {
    const source = this.#context.createMediaStreamSource(stream);
    return {
      connect: (port) => {
        const node = this.#nodes.get(port);
        if (node === undefined) {
          throw new Error('A media stream source feeds only a worklet node of its own context.');
        }
        source.connect(node);
      },
      disconnect: () => {
        source.disconnect();
      },
    };
  }
}

/**
 * The browser's audio contexts, as ports.
 *
 * The application calls this only where the capabilities say playback is
 * possible, so the constructors it reaches are there; output selection is
 * offered on the port only where the capabilities say so.
 */
export function browserAudioContext(capabilities: AudioRuntimeCapabilities): CreateAudioContext {
  return (options) => {
    const context = new AudioContext({
      latencyHint: options.latencyHint,
      ...(options.sampleRate === undefined ? {} : { sampleRate: options.sampleRate }),
    });
    const nodes = new ContextNodes(context);
    const sinkSelection =
      capabilities.outputSelection && selectsSink(context)
        ? { setSinkId: (deviceId: string) => context.setSinkId(deviceId) }
        : {};
    return {
      get state() {
        return context.state;
      },
      get sampleRate() {
        return context.sampleRate;
      },
      get currentTime() {
        return context.currentTime;
      },
      get baseLatency() {
        return context.baseLatency;
      },
      get outputLatency() {
        return outputLatencyOf(context);
      },
      destination: context.destination,
      resume: () => context.resume(),
      suspend: () => context.suspend(),
      close: () => context.close(),
      addEventListener: (type, listener) => {
        context.addEventListener(type, listener);
      },
      removeEventListener: (type, listener) => {
        context.removeEventListener(type, listener);
      },
      audioWorklet: { addModule: (url) => context.audioWorklet.addModule(url) },
      createWorkletNode: (processorName, shape) => nodes.workletNode(processorName, shape),
      createMediaStreamSource: (stream) => nodes.mediaStreamSource(stream),
      ...sinkSelection,
    };
  };
}
