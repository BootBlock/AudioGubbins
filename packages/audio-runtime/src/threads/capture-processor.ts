/**
 * The capture processor: a module the browser loads into the audio context's
 * AudioWorkletGlobalScope, beside the engine's processor (ADR-0070).
 *
 * It only connects the scope, and the effect rack a monitoring chain runs live
 * through, to `CaptureProcessorCore`, which holds everything the processor
 * does, so that behaviour is tested without a worklet. The rack is made here,
 * over the processor catalogue, as the feeder's module makes its own, and given
 * to the core as the engine's port (ADR-0030 amended). The audio thread runs no
 * model: a chain with one is heard from a render, and so is refused for
 * monitoring before any model is asked for, so the types are given services
 * that say so rather than reach for one. The package is compiled with the DOM's
 * types, which have none for the worklet's scope, so the names this module
 * reads from it are declared here; `scopes/audio-worklet` compiles it again
 * against the scope's own globals alone.
 */

import { chainProcessing } from '@audiogubbins/effect-rack';
import {
  ModelUnavailability,
  modelUnavailable,
  processorTypesWith,
  type ModelServices,
} from '@audiogubbins/processors';
import { FailureKind, fail, failure } from '@audiogubbins/domain';

import { CaptureProcessorCore } from '../capture-processor/capture-processor-core.js';
import { CAPTURE_PROCESSOR_NAME } from '../capture-processor/capture-processor-name.js';

/** The base class of a processor, with the port to the node on the main thread. */
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
}

declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

/** The context's rate, fixed for the scope's life. */
declare const sampleRate: number;

/** The context frame of the quantum being rendered. */
declare const currentFrame: number;

/** What the audio thread says of any model a processor asks it for. */
const NO_MODEL_HERE = 'The audio thread runs no model.';

/** Services that run no model, for a thread that never runs one. */
const NO_MODELS: ModelServices = {
  inference: {
    open: () =>
      Promise.resolve(
        fail(failure('capture.no-inference', FailureKind.Unrecoverable, NO_MODEL_HERE)),
      ),
  },
  models: {
    available: (pack, version) =>
      Promise.resolve(
        modelUnavailable(ModelUnavailability.RequiredUnavailable, NO_MODEL_HERE, { pack, version }),
      ),
    file: (pack, version) =>
      Promise.resolve(
        modelUnavailable(ModelUnavailability.RequiredUnavailable, NO_MODEL_HERE, { pack, version }),
      ),
  },
};

const PROCESSING = chainProcessing(processorTypesWith(NO_MODELS));

/** What a quantum's input is when the node has none connected. */
const NO_INPUT: readonly Float32Array[] = [];

class CaptureProcessor extends AudioWorkletProcessor {
  readonly #core: CaptureProcessorCore = new CaptureProcessorCore({
    sampleRate,
    post: (message) => {
      this.port.postMessage(message);
    },
    processing: PROCESSING,
  });

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<unknown>) => {
      this.#core.receive(event.data);
    };
    // A message that could not be received arrives as this rather than as a
    // message, and what the page asked for would otherwise be lost unsaid.
    this.port.onmessageerror = () => {
      this.#core.messageFailed();
    };
  }

  process(
    inputs: readonly (readonly Float32Array[])[],
    outputs: readonly (readonly Float32Array[])[],
  ): boolean {
    this.#core.process(inputs[0] ?? NO_INPUT, outputs[0] ?? NO_INPUT, currentFrame);
    // Kept alive while the node exists: the page disconnects it when the input goes.
    return true;
  }
}

registerProcessor(CAPTURE_PROCESSOR_NAME, CaptureProcessor);
