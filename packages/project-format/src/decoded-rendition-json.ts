/**
 * Writing and reading the compressed file an asset's media was decoded from
 * (`decoded-rendition.ts`, REQ-EXEC-136.12), and checking it against the
 * asset: a rendition is the asset's media, so the asset is the stream's rate,
 * channels and decoded length, and its media is managed, since the rendition
 * is kept in the store.
 */

import type { DecoderIdentity } from '@audiogubbins/codecs';
import { layoutsMatch, type Asset } from '@audiogubbins/domain';

import type { JsonObject } from './canonical-json.js';
import {
  anyObjectOf,
  checkMembers,
  objectOf,
  optional,
  pathOf,
  required,
  type Converter,
  type Reading,
} from './document-reading.js';
import { presentMembers } from './document-writing.js';
import { readExternalIdentity, writeExternalIdentity } from './external-identity-json.js';
import type { AssetSource, DecodedRendition, KeptCompressedSource } from './project-state.js';
import { asCodec, asContainer, asImplementation } from './codec-names-reading.js';
import { asContentId, integerConverter, oneOfConverter, textConverter } from './scalar-reading.js';
import { writeLayout } from './value-writing.js';
import { asChannelLayout, asSampleCount, asSampleRate } from './value-reading.js';

const RENDITION_MEMBERS: ReadonlySet<string> = new Set([
  'container',
  'codec',
  'sampleRate',
  'layout',
  'frames',
  'statedFrames',
  'bitRate',
  'leadingFrames',
  'decoder',
  'kept',
]);
const DECODER_MEMBERS: ReadonlySet<string> = new Set(['implementation', 'name', 'version']);
const COPIED_MEMBERS: ReadonlySet<string> = new Set(['kind', 'contentId']);
const LINKED_MEMBERS: ReadonlySet<string> = new Set(['kind', 'identity', 'retainedCopy']);

const asDecoderText = textConverter({ maximumLength: 256 });
const asKeptKind = oneOfConverter(['copied', 'linked'] as const);

/** A bit rate in bits a second: above zero, and far below any a file could state. */
const asBitRate = integerConverter(1, 2 ** 32);

const asDecoder: Converter<DecoderIdentity> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, DECODER_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const implementation = required(reading, object, at, 'implementation', asImplementation);
  const name = required(reading, object, at, 'name', asDecoderText);
  const version = required(reading, object, at, 'version', asDecoderText);
  return implementation === undefined || name === undefined || version === undefined
    ? undefined
    : { implementation, name, version };
};

const asKept: Converter<KeptCompressedSource> = (reading, value, parent, key) => {
  const object = anyObjectOf(reading, value, parent, key);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const kind = required(reading, object, at, 'kind', asKeptKind);
  if (kind === 'copied') {
    checkMembers(reading, object, at, COPIED_MEMBERS);
    const contentId = required(reading, object, at, 'contentId', asContentId);
    return contentId === undefined ? undefined : { kind, contentId };
  }
  if (kind === 'linked') {
    checkMembers(reading, object, at, LINKED_MEMBERS);
    const identity = required(reading, object, at, 'identity', readExternalIdentity);
    const retainedCopy = optional(reading, object, at, 'retainedCopy', asContentId);
    return identity === undefined
      ? undefined
      : { kind, identity, ...(retainedCopy === undefined ? {} : { retainedCopy }) };
  }
  return undefined;
};

/** Reads the compressed file an asset's media was decoded from. */
export const readDecodedRendition: Converter<DecodedRendition> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, RENDITION_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const container = required(reading, object, at, 'container', asContainer);
  const codec = required(reading, object, at, 'codec', asCodec);
  const sampleRate = required(reading, object, at, 'sampleRate', asSampleRate);
  const layout = required(reading, object, at, 'layout', asChannelLayout);
  const frames = required(reading, object, at, 'frames', asSampleCount);
  const statedFrames = optional(reading, object, at, 'statedFrames', asSampleCount);
  const bitRate = optional(reading, object, at, 'bitRate', asBitRate);
  const leadingFrames = required(reading, object, at, 'leadingFrames', asSampleCount);
  const decoder = required(reading, object, at, 'decoder', asDecoder);
  const kept = required(reading, object, at, 'kept', asKept);
  if (
    container === undefined ||
    codec === undefined ||
    sampleRate === undefined ||
    layout === undefined ||
    frames === undefined ||
    leadingFrames === undefined ||
    decoder === undefined ||
    kept === undefined
  ) {
    return undefined;
  }
  return {
    container,
    codec,
    sampleRate,
    layout,
    frames,
    ...(statedFrames === undefined ? {} : { statedFrames }),
    ...(bitRate === undefined ? {} : { bitRate }),
    leadingFrames,
    decoder,
    kept,
  };
};

/** Writes the compressed file an asset's media was decoded from. */
export function writeDecodedRendition(rendition: DecodedRendition): JsonObject {
  return presentMembers({
    container: rendition.container,
    codec: rendition.codec,
    sampleRate: rendition.sampleRate,
    layout: writeLayout(rendition.layout),
    frames: rendition.frames,
    statedFrames: rendition.statedFrames,
    bitRate: rendition.bitRate,
    leadingFrames: rendition.leadingFrames,
    decoder: { ...rendition.decoder },
    kept: writeKept(rendition.kept),
  });
}

function writeKept(kept: KeptCompressedSource): JsonObject {
  return kept.kind === 'copied'
    ? { kind: kept.kind, contentId: kept.contentId }
    : presentMembers({
        kind: kept.kind,
        identity: writeExternalIdentity(kept.identity),
        retainedCopy: kept.retainedCopy,
      });
}

/**
 * Checks a rendition's record, at `at`, against the asset decoded into it and
 * the source holding it: the media is managed, the asset holds no audio shape
 * or recording beside it, and it is at the stream's rate, in its channels and
 * as long as the frames decoded. True where it agrees.
 */
export function checkRenditionAgainstAsset(
  reading: Reading,
  rendition: DecodedRendition,
  source: AssetSource,
  asset: Asset,
  at: string,
): boolean {
  const refuse = (code: string, summary: string, member: string): false => {
    reading.refuse(code, summary, pathOf(at, member), { assetId: asset.id });
    return false;
  };
  if (source.media.kind !== 'managed') {
    return refuse(
      'source.rendition-not-managed',
      'A decoded rendition is kept in the media store.',
      'kept',
    );
  }
  if (source.provenance?.audio !== undefined || source.provenance?.recording !== undefined) {
    return refuse(
      'source.rendition-beside-shape',
      'An asset decoded from a compressed file holds no other record of how its audio was read.',
      'codec',
    );
  }
  if (rendition.sampleRate !== asset.sampleRate) {
    return refuse(
      'source.rendition-rate-mismatch',
      'The decoded stream’s sample rate is not its asset’s.',
      'sampleRate',
    );
  }
  if (!layoutsMatch(rendition.layout, asset.channelLayout)) {
    return refuse(
      'source.rendition-layout-mismatch',
      'The decoded stream’s channels are not its asset’s.',
      'layout',
    );
  }
  return rendition.frames === asset.length
    ? true
    : refuse(
        'source.rendition-length-mismatch',
        'The asset is not as long as the stream decoded into it.',
        'frames',
      );
}
