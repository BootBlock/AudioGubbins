/**
 * How a recognised file becomes an asset (ADR-0090): read in place, decoded
 * once into a rendition, or refused before anything is stored.
 *
 * The answer is the registry's. A codec whose read direction the application
 * serves in that container is read in place by `openAudio`; one another
 * implementation reads there is decoded; a container that names its codec only
 * past its start is decoded where any descriptor reads that container, and the
 * decoder finds the codec; anything else is refused, with the sentence that
 * names what the file is and what can be read.
 */

import type { DomainFailure } from '@audiogubbins/domain';

import type { CodecId, ContainerId } from './codec-descriptor.js';
import { CODEC_REGISTRY, codecDescriptor } from './codec-registry.js';
import { unsupportedFormat } from './codec-failures.js';
import type { ReadableContainer, RecognisedFormat } from './recognised-format.js';

/** The way a recognised file is imported. */
export type ImportRoute =
  /** Read where it lies by `openAudio`, block by block. */
  | {
      readonly kind: 'read-in-place';
      readonly container: ReadableContainer;
      readonly codec: CodecId;
    }
  /**
   * Decoded once, from start to end, into a rendition. `codec` is the codec the
   * container states, or `undefined` where it names it only past its start.
   */
  | {
      readonly kind: 'decode';
      readonly container: ContainerId;
      readonly codec: CodecId | undefined;
    }
  /** Refused before anything is stored, with the sentence that says why. */
  | { readonly kind: 'refuse'; readonly failure: DomainFailure };

/** The containers some descriptor reads, so a codec they leave unstated may still be decoded. */
const DECODED_CONTAINERS: ReadonlySet<ContainerId> = new Set(
  [...CODEC_REGISTRY.values()].flatMap((descriptor) =>
    descriptor.read === undefined || descriptor.read.implementation === 'application'
      ? []
      : descriptor.read.containers,
  ),
);

/** The containers the application reads in place, which `ReadableContainer` names. */
const READABLE: ReadonlyMap<ContainerId, ReadableContainer> = new Map([
  ['wav', 'wav'],
  ['rf64', 'rf64'],
  ['bw64', 'bw64'],
  ['aiff', 'aiff'],
  ['aifc', 'aifc'],
]);

/** How a recognised file is imported, by the registry. */
export function importRoute(format: RecognisedFormat): ImportRoute {
  const refuse: ImportRoute = { kind: 'refuse', failure: unsupportedFormat(format) };
  if (format.kind === 'unknown') return refuse;
  const { container, codec } = format;
  switch (codec.kind) {
    case 'unnamed':
      return refuse;
    case 'unstated':
      return DECODED_CONTAINERS.has(container)
        ? { kind: 'decode', container, codec: undefined }
        : refuse;
    case 'named': {
      const read = codecDescriptor(codec.codec).read;
      if (!read?.containers.includes(container)) return refuse;
      const readable = READABLE.get(container);
      if (read.implementation === 'application' && readable !== undefined) {
        return { kind: 'read-in-place', container: readable, codec: codec.codec };
      }
      return { kind: 'decode', container, codec: codec.codec };
    }
  }
}
