/**
 * Reading the audio shape an asset's provenance keeps of the file it was
 * imported from (REQ-STOR-166, REQ-AUDIO-220, REQ-EXEC-136.12), and checking
 * it against the asset.
 *
 * The asset's own rate and length are what it plays at. The shape is what the
 * file stated, kept for tracing a sound back to it, so the two must agree: a
 * document whose provenance says one rate while its asset plays another holds
 * a record of a different file, and is refused rather than one of them
 * believed.
 */

import type { Asset } from '@audiogubbins/domain';

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
import { SOURCE_CONTAINERS, type SourceAudioShape, type SourceEncoding } from './project-state.js';
import { integerConverter, oneOfConverter } from './scalar-reading.js';
import { asChannelLayout, asSampleCount, asSampleRate } from './value-reading.js';

const AUDIO_MEMBERS: ReadonlySet<string> = new Set([
  'container',
  'sampleRate',
  'encoding',
  'statedLayout',
  'frames',
  'declaredFrames',
]);

const PCM_MEMBERS: ReadonlySet<string> = new Set(['kind', 'bits', 'byteOrder']);
const G711_MEMBERS: ReadonlySet<string> = new Set(['kind']);
const ADPCM_MEMBERS: ReadonlySet<string> = new Set(['kind', 'framesPerBlock']);

const asContainer = oneOfConverter(SOURCE_CONTAINERS);
const asEncodingKind = oneOfConverter([
  'integer',
  'float',
  'g711-alaw',
  'g711-ulaw',
  'ima-adpcm',
  'ms-adpcm',
] as const);
const asByteOrder = oneOfConverter(['little', 'big'] as const);

/** Bits per sample, as a container states them. */
const asBitDepth = integerConverter(1, 64);

/** The frames of an ADPCM block, which its 16-bit block size bounds. */
const asFramesPerBlock = integerConverter(1, 0x20000);

/** How a file stores its samples where they are read in place. */
const asSourceEncoding: Converter<SourceEncoding> = (reading, value, parent, key) => {
  const object = anyObjectOf(reading, value, parent, key);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const kind = required(reading, object, at, 'kind', asEncodingKind);
  switch (kind) {
    case undefined:
      return undefined;
    case 'integer':
    case 'float': {
      checkMembers(reading, object, at, PCM_MEMBERS);
      const bits = required(reading, object, at, 'bits', asBitDepth);
      const byteOrder = required(reading, object, at, 'byteOrder', asByteOrder);
      return bits === undefined || byteOrder === undefined ? undefined : { kind, bits, byteOrder };
    }
    case 'g711-alaw':
    case 'g711-ulaw':
      checkMembers(reading, object, at, G711_MEMBERS);
      return { kind };
    case 'ima-adpcm':
    case 'ms-adpcm': {
      checkMembers(reading, object, at, ADPCM_MEMBERS);
      const framesPerBlock = required(reading, object, at, 'framesPerBlock', asFramesPerBlock);
      return framesPerBlock === undefined ? undefined : { kind, framesPerBlock };
    }
  }
};

/** Reads the audio shape of an imported file. */
export const readSourceAudioShape: Converter<SourceAudioShape> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, AUDIO_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);

  const container = required(reading, object, at, 'container', asContainer);
  const sampleRate = required(reading, object, at, 'sampleRate', asSampleRate);
  const encoding = required(reading, object, at, 'encoding', asSourceEncoding);
  const statedLayout = optional(reading, object, at, 'statedLayout', asChannelLayout);
  const frames = required(reading, object, at, 'frames', asSampleCount);
  const declaredFrames = required(reading, object, at, 'declaredFrames', asSampleCount);

  if (
    container === undefined ||
    sampleRate === undefined ||
    encoding === undefined ||
    frames === undefined ||
    declaredFrames === undefined
  ) {
    return undefined;
  }
  if (frames > declaredFrames) {
    // A file is read to its last whole frame, never past what it declared.
    reading.refuse(
      'source.audio-frames-past-declared',
      'More frames were read from the file than its header declared.',
      pathOf(at, 'frames'),
    );
    return undefined;
  }
  return {
    container,
    sampleRate,
    encoding,
    ...(statedLayout === undefined ? {} : { statedLayout }),
    frames,
    declaredFrames,
  };
};

/**
 * Checks an audio shape at `at` against the asset imported from its file: the
 * same rate, and the asset as long as the frames read. True where they agree.
 */
export function checkAudioAgainstAsset(
  reading: Reading,
  audio: SourceAudioShape,
  asset: Asset,
  at: string,
): boolean {
  let agrees = true;
  if (audio.sampleRate !== asset.sampleRate) {
    reading.refuse(
      'source.audio-rate-mismatch',
      "The imported file's sample rate is not its asset's.",
      pathOf(at, 'sampleRate'),
      { assetId: asset.id },
    );
    agrees = false;
  }
  if (audio.frames !== asset.length) {
    reading.refuse(
      'source.audio-length-mismatch',
      'The asset is not as long as the audio read from its file.',
      pathOf(at, 'frames'),
      { assetId: asset.id },
    );
    agrees = false;
  }
  return agrees;
}
