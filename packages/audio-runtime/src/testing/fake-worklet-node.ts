/**
 * A worklet node whose processor is the real `EngineProcessorCore`, for
 * testing the main thread's side of playback without a browser.
 *
 * Every message crosses as a structured clone, each way, with its transfers,
 * as a `MessagePort` carries it: the processor reads what arrives with its
 * reader, the main thread with its own, and a message that relied on sharing
 * an object with the other side would fail here as it would in a browser.
 * Delivery is a microtask later, not at once, since a port delivers a message
 * as a task of the receiving side, never inside `postMessage`. The processor
 * renders only when the test says, one render quantum at a time, and keeps
 * what it rendered with the context frame it rendered at.
 */

import { EngineProcessorCore } from '../processor/engine-processor-core.js';
import { RENDER_QUANTUM_FRAMES } from '../processor/loaded-graph.js';
import type {
  AudioDestinationPort,
  WorkletMessagePort,
  WorkletNodePort,
  WorkletNodeShape,
  WorkletPortEvent,
} from '../context/audio-context-port.js';

/** One rendered quantum: its first context frame and its samples, one array per channel. */
export interface RenderedQuantum {
  readonly frame: number;
  readonly channels: readonly Float32Array[];
}

type MessageListener = (event: MessageEvent) => void;

/** A node running the engine's processor, driven by a test. */
export class FakeWorkletNode implements WorkletNodePort {
  readonly processorName: string;
  readonly shape: WorkletNodeShape;
  readonly rendered: RenderedQuantum[] = [];
  readonly port: WorkletMessagePort;
  /** Every message the main thread posted, as it was read before cloning. */
  readonly sent: unknown[] = [];
  connectedTo: AudioDestinationPort | undefined;
  /** For each device channel, the output channel it carries, as `connect` was given it. */
  outputChannelOf: readonly number[] = [];
  disconnected = false;

  readonly #core: EngineProcessorCore;
  readonly #listeners = new Set<MessageListener>();
  readonly #errorListeners = new Set<MessageListener>();
  /** Replies that arrived before the main thread started the port, which a port holds. */
  readonly #held: unknown[] = [];
  #started = false;

  /**
   * `lost` says which of the main thread's messages never arrive, as a
   * browser drops one it cannot deliver to a worklet without a word to the
   * sender.
   */
  constructor(
    processorName: string,
    shape: WorkletNodeShape,
    sampleRate: number,
    lost: (message: unknown) => boolean = () => false,
  ) {
    this.processorName = processorName;
    this.shape = shape;
    this.#core = new EngineProcessorCore({
      sampleRate,
      post: (message) => {
        this.reply(structuredClone(message));
      },
    });
    this.port = {
      postMessage: (message, transfer = []) => {
        this.sent.push(message);
        if (lost(message)) return;
        const data: unknown = structuredClone(message, { transfer });
        queueMicrotask(() => {
          this.#core.receive(data);
        });
      },
      addEventListener: (type, listener) => {
        this.#listenersFor(type).add(listener);
      },
      removeEventListener: (type, listener) => {
        this.#listenersFor(type).delete(listener);
      },
      start: () => {
        this.#started = true;
        for (const data of this.#held.splice(0)) this.#deliver(data);
      },
    };
  }

  /** How many listeners hear the processor's replies and their failures. */
  get listenerCount(): number {
    return this.#listeners.size + this.#errorListeners.size;
  }

  connect(destination: AudioDestinationPort, outputChannelOf: readonly number[]): void {
    this.connectedTo = destination;
    this.outputChannelOf = outputChannelOf;
  }

  /** What each device channel heard of a rendered quantum, in the device's order. */
  atDevice(quantum: RenderedQuantum): readonly (Float32Array | undefined)[] {
    return this.outputChannelOf.map((output) => quantum.channels[output]);
  }

  disconnect(): void {
    this.disconnected = true;
    this.connectedTo = undefined;
  }

  /** Renders the quantum at context frame `frame` and keeps it. */
  render(frame: number): void {
    const channels = Array.from(
      { length: this.shape.outputChannelCount[0] ?? 0 },
      () => new Float32Array(RENDER_QUANTUM_FRAMES),
    );
    this.#core.process(channels, frame);
    this.rendered.push({ frame, channels });
  }

  /** Sends the main thread `data` as if the processor had, whatever it is. */
  reply(data: unknown): void {
    queueMicrotask(() => {
      if (this.#started) this.#deliver(data);
      else this.#held.push(data);
    });
  }

  /** Says a reply arrived that could not be received, as a port says it with `messageerror`. */
  replyFails(): void {
    queueMicrotask(() => {
      const event = new MessageEvent('messageerror');
      for (const listener of [...this.#errorListeners]) listener(event);
    });
  }

  #listenersFor(type: WorkletPortEvent): Set<MessageListener> {
    return type === 'message' ? this.#listeners : this.#errorListeners;
  }

  #deliver(data: unknown): void {
    const event = new MessageEvent('message', { data });
    for (const listener of [...this.#listeners]) listener(event);
  }
}
