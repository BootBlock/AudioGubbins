/**
 * What one runtime can do with a codec (ADR-0090): a pure answer from the
 * registry and what the runtime was found to offer, never an assumption.
 *
 * The application's own codecs are TypeScript and need nothing, so they serve
 * everywhere. The codec module and the encoder modules need WebAssembly, and
 * serve until their load fails; a browser's codec serves only where the probes
 * (`packages/capabilities`) found it. An unavailable codec says why in a
 * sentence for the person and names the codecs that serve the same use here,
 * those that keep as much of the sound first: the other lossless codecs before
 * the lossy ones for a lossless codec, the other lossy ones first for a lossy
 * one, each group in the registry's order.
 */

import type {
  CodecCapability,
  CodecDescriptor,
  CodecDirection,
  CodecId,
  CodecUse,
} from './codec-descriptor.js';
import { CODEC_REGISTRY, codecDescriptor } from './codec-registry.js';

/** How far a module's load has gone: not yet asked for, done, or failed. */
export type ModuleLoad = 'not-loaded' | 'loaded' | 'failed';

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
}

/** The words a reason uses for each use. */
const USE_WORDS: Readonly<Record<CodecUse, { readonly doing: string; readonly done: string }>> = {
  read: { doing: 'Importing', done: 'imported' },
  write: { doing: 'Exporting', done: 'exported' },
};

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
      return environment.codecModule === 'failed'
        ? `The codec module could not be loaded, so ${name} cannot be ${words.done} here.`
        : undefined;
    case 'encoder-module':
      if (!environment.webAssembly) {
        return `${words.doing} ${name} needs WebAssembly, which this browser does not run.`;
      }
      return environment.encoderModules.get(descriptor.id) === 'failed'
        ? `The ${name} encoder could not be loaded, so ${name} cannot be ${words.done} here.`
        : undefined;
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
