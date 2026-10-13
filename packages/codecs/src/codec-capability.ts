/**
 * What one runtime can do with a codec (ADR-0090): a pure answer from the
 * registry and what the runtime was found to offer, never an assumption.
 *
 * The application's own codecs are TypeScript and need nothing, so they serve
 * everywhere. The codec module and the encoder modules need WebAssembly, and
 * serve until their load fails, when the reason says why it failed; a browser's
 * codec serves only where the probes (`packages/capabilities`) found it. An
 * unavailable codec says why in a sentence for the person and names the codecs
 * that serve the same use here, those that keep as much of the sound first: the
 * other lossless codecs before the lossy ones for a lossless codec, the other
 * lossy ones first for a lossy one, each group in the registry's order.
 */

import type {
  BitRateBand,
  CodecCapability,
  CodecDescriptor,
  CodecDirection,
  CodecId,
  CodecUse,
} from './codec-descriptor.js';
import { CODEC_REGISTRY, codecDescriptor } from './codec-registry.js';

/**
 * How far a module's load has gone: not yet asked for, done, or failed, with
 * why, as the error that failed it says, redacted for the person to read: its
 * formats' unavailability says it.
 */
export type ModuleLoad =
  | { readonly kind: 'not-loaded' }
  | { readonly kind: 'loaded' }
  | { readonly kind: 'failed'; readonly reason: string };

/** What a runtime offers the codecs, as its probes and loads found it (REQ-EXEC-216). */
export interface CodecEnvironment {
  /** Whether the runtime runs WebAssembly, which the codec module and the encoder modules are. */
  readonly webAssembly: boolean;

  /** How far the codec module's load has gone. */
  readonly codecModule: ModuleLoad;

  /** How far each encoder module's load has gone, by the codec it encodes; absent is not yet asked for. */
  readonly encoderModules: ReadonlyMap<CodecId, ModuleLoad>;

  /** The codecs the browser's decoder was probed to decode. */
  readonly browserDecoders: ReadonlySet<CodecId>;

  /** The codecs the browser's encoder was probed to encode. */
  readonly browserEncoders: ReadonlySet<CodecId>;

  /**
   * The bit rates the browser's encoder was probed to take, by the codec it
   * encodes, for each codec it encodes whose bit rates the browser alone
   * decides: its write direction's `bitRates` here (`codecDescriptorIn`).
   */
  readonly browserBitRates: ReadonlyMap<CodecId, readonly BitRateBand[]>;
}

/** The words a reason uses for each use. */
const USE_WORDS: Readonly<Record<CodecUse, { readonly doing: string; readonly done: string }>> = {
  read: { doing: 'Importing', done: 'imported' },
  write: { doing: 'Exporting', done: 'exported' },
};

/** The stop that closes a sentence. */
const SENTENCE_END = /[.!?]$/u;

/** A reason as the end of a sentence: closed with a full stop where it has no stop of its own. */
function closed(reason: string): string {
  const trimmed = reason.trim();
  return SENTENCE_END.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * Why `module`'s formats cannot serve, as `load` failed, or `undefined` where
 * it did not fail.
 */
function failedLoad(
  load: ModuleLoad | undefined,
  module: string,
  name: string,
  done: string,
): string | undefined {
  return load?.kind === 'failed'
    ? `${module} could not be loaded, so ${name} cannot be ${done} here: ${closed(load.reason)}`
    : undefined;
}

/** Why a direction cannot serve in this environment, or `undefined` where it can. */
function obstacle(
  descriptor: CodecDescriptor,
  use: CodecUse,
  direction: CodecDirection,
  environment: CodecEnvironment,
): string | undefined {
  const { name } = descriptor;
  const words = USE_WORDS[use];
  switch (direction.implementation) {
    case 'application':
      return undefined;
    case 'codec-module':
      if (!environment.webAssembly) {
        return `${words.doing} ${name} needs WebAssembly, which this browser does not run.`;
      }
      return failedLoad(environment.codecModule, 'The codec module', name, words.done);
    case 'encoder-module':
      if (!environment.webAssembly) {
        return `${words.doing} ${name} needs WebAssembly, which this browser does not run.`;
      }
      return failedLoad(
        environment.encoderModules.get(descriptor.id),
        `The ${name} encoder`,
        name,
        words.done,
      );
    case 'browser': {
      const probed = use === 'read' ? environment.browserDecoders : environment.browserEncoders;
      const part = use === 'read' ? 'decoder' : 'encoder';
      return probed.has(descriptor.id)
        ? undefined
        : `${words.doing} ${name} needs the browser's own ${part}, which this browser does not have.`;
    }
  }
}

/** Whether a codec serves a use here. */
function serves(
  descriptor: CodecDescriptor,
  use: CodecUse,
  environment: CodecEnvironment,
): boolean {
  const direction = descriptor[use];
  return direction !== undefined && obstacle(descriptor, use, direction, environment) === undefined;
}

/** The codecs that serve a use here in place of `descriptor`, in the order to offer them. */
function alternatives(
  descriptor: CodecDescriptor,
  use: CodecUse,
  environment: CodecEnvironment,
): readonly CodecId[] {
  const serving = [...CODEC_REGISTRY.values()].filter(
    (other) => other.id !== descriptor.id && serves(other, use, environment),
  );
  return [
    ...serving.filter((other) => other.lossless === descriptor.lossless),
    ...serving.filter((other) => other.lossless !== descriptor.lossless),
  ].map((other) => other.id);
}

/** What this environment can do with `codec` in `use`. */
export function codecCapability(
  environment: CodecEnvironment,
  codec: CodecId,
  use: CodecUse,
): CodecCapability {
  const descriptor = codecDescriptor(codec);
  const unavailable = (reason: string): CodecCapability => ({
    kind: 'unavailable',
    codec,
    use,
    reason,
    alternatives: alternatives(descriptor, use, environment),
  });
  const direction = descriptor[use];
  if (direction === undefined) {
    return unavailable(
      `AudioGubbins does not ${use === 'read' ? 'import' : 'export'} ${descriptor.name}.`,
    );
  }
  const reason = obstacle(descriptor, use, direction, environment);
  return reason === undefined
    ? { kind: 'available', codec, use, implementation: direction.implementation }
    : unavailable(reason);
}
