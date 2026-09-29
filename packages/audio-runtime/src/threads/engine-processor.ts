/**
 * The engine's AudioWorklet processor: a module the browser loads into the
 * audio context's AudioWorkletGlobalScope.
 *
 * It only connects the scope to `EngineProcessorCore`, which holds everything
 * the processor does, so that behaviour is tested without a worklet, which a
 * test cannot make. The package is compiled with the DOM's types, which have
 * none for the worklet's scope, so the names this module reads from it are
 * declared here.
 */

import { EngineProcessorCore } from '../processor/engine-processor-core.js';
import { ENGINE_PROCESSOR_NAME } from '../processor/engine-processor-name.js';

/** The base class of a processor, with the port to the node on the main thread. */
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
}

declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

/** The context's rate, fixed for the scope's life. */
declare const sampleRate: number;

/** The context frame of the quantum being rendered. */
declare const currentFrame: number;

/** What a quantum is rendered into when the node has no output, made once. */
const NO_OUTPUT: readonly Float32Array[] = [];

class EngineProcessor extends AudioWorkletProcessor {
  readonly #core = new EngineProcessorCore({
    sampleRate,
    post: (message) => {
      this.port.postMessage(message);
    },
  });

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<unknown>) => {
      this.#core.receive(event.data);
    };
    // A message that could not be received arrives as this rather than as a
    // message, and the processor would otherwise wait on it for ever.
    this.port.onmessageerror = () => {
      this.#core.messageFailed();
    };
  }

  process(
    _inputs: readonly (readonly Float32Array[])[],
    outputs: readonly (readonly Float32Array[])[],
  ): boolean {
    this.#core.process(outputs[0] ?? NO_OUTPUT, currentFrame);
    // Kept alive while the node exists: the main thread halts it rather than
    // letting the worklet collect it, so a graph survives a pause.
    return true;
  }
}

registerProcessor(ENGINE_PROCESSOR_NAME, EngineProcessor);
