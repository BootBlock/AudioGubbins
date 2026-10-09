/**
 * A worklet node whose processor is the real `CaptureProcessorCore`, for
 * testing capture from the page's side without a browser (ADR-0070).
 *
 * Every message crosses as a structured clone, each way, with its transfers,
 * a microtask later, as the engine's fake node carries them, so a take's
 * channel end crosses to the processor as a browser moves it. The node
 * renders only when the test says, one render quantum at a time: it takes the
 * quantum from the source connected to its input, as the browser hands a
 * processor its input, and keeps what it played with the context frame.
 */

import type { ChainProcessing } from '@audiogubbins/audio-engine';
import { crossingThreads } from '@audiogubbins/domain/testing';

import type {
  AudioDestinationPort,
  WorkletMessagePort,
  WorkletNodeShape,
  WorkletPortEvent,
} from '../context/audio-context-port.js';
import { CaptureProcessorCore } from '../capture-processor/capture-processor-core.js';
import { RENDER_QUANTUM_FRAMES } from '../processor/loaded-graph.js';
import type { FakeMediaStreamSource, FedNode } from './fake-media-stream.js';
import type { RenderedQuantum } from './fake-worklet-node.js';

type MessageListener = (event: MessageEvent) => void;

/** A node running the capture processor, driven by a test. */
export class FakeCaptureNode implements FedNode {
  readonly processorName: string;
  readonly shape: WorkletNodeShape;
  readonly core: CaptureProcessorCore;
  readonly port: WorkletMessagePort;
  /** Every quantum the node played, with its context frame. */
  readonly rendered: RenderedQuantum[] = [];
  /** Every message the page posted, as it was before it crossed. */
  readonly sent: unknown[] = [];
  connectedTo: AudioDestinationPort | undefined;
  outputChannelOf: readonly number[] = [];
  disconnected = false;
  source: FakeMediaStreamSource | undefined;

  readonly #listeners = new Set<MessageListener>();
  readonly #errorListeners = new Set<MessageListener>();
  readonly #held: unknown[] = [];
  #started = false;

  constructor(
    processorName: string,
    shape: WorkletNodeShape,
    sampleRate: number,
    processing: ChainProcessing,
  ) {
    this.processorName = processorName;
    this.shape = shape;
    this.core = new CaptureProcessorCore({
      sampleRate,
      processing,
      post: (message) => {
        const data = structuredClone(message);
        queueMicrotask(() => {
          if (this.#started) this.#deliver(data);
          else this.#held.push(data);
        });
      },
    });
    this.port = {
      postMessage: (message, transfer = []) => {
        this.sent.push(message);
        const data = crossingThreads(message, transfer);
        queueMicrotask(() => {
          this.core.receive(data);
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

  feedFrom(source: FakeMediaStreamSource | undefined): void {
    this.source = source;
  }

  connect(destination: AudioDestinationPort, outputChannelOf: readonly number[]): void {
    this.connectedTo = destination;
    this.outputChannelOf = outputChannelOf;
  }

  disconnect(): void {
    this.disconnected = true;
    this.connectedTo = undefined;
  }

  /** Renders the quantum at context frame `frame` from the connected source, and keeps what it played. */
  render(frame: number): void {
    const input = this.source?.quantum(frame, RENDER_QUANTUM_FRAMES) ?? [];
    const channels = Array.from(
      { length: this.shape.outputChannelCount[0] ?? 0 },
      () => new Float32Array(RENDER_QUANTUM_FRAMES),
    );
    this.core.process(input, channels, frame);
    this.rendered.push({ frame, channels });
  }

  #listenersFor(type: WorkletPortEvent): Set<MessageListener> {
    return type === 'message' ? this.#listeners : this.#errorListeners;
  }

  #deliver(data: unknown): void {
    const event = new MessageEvent('message', { data });
    for (const listener of [...this.#listeners]) listener(event);
  }
}
