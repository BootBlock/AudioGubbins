/**
 * A deterministic writer of AIFF and AIFF-C fixture files.
 *
 * It writes every uncompressed AIFF-C type in its own byte order and width, a
 * compression type the reader must refuse, a `CHAN` chunk, a sample rate of any
 * value as an 80-bit extended float, extra chunks of odd sizes, `COMM` after
 * the samples, an `SSND` offset, and a file cut short.
 */

import {
  chunkBytes,
  codeBytes,
  encodeFrames,
  fields,
  joinBytes,
  type FixtureChannel,
  type FixtureChunk,
  type FixtureEncoding,
} from './sample-writing.js';

/** An AIFF or AIFF-C fixture. */
export interface AiffOptions {
  readonly form?: 'aiff' | 'aifc';

  /** The AIFF-C compression type; plain AIFF is `NONE`. */
  readonly compressionType?: string;

  /** The `COMM` chunk's sample size in bits. */
  readonly sampleSize: number;

  readonly sampleRate: number;
  readonly channels: readonly FixtureChannel[];

  /** Replaces the frames and channels `COMM` states, to state what the samples are not. */
  readonly commonOverrides?: { readonly declaredFrames?: number; readonly channelCount?: number };

  /** A `CHAN` chunk's body, from `channelLayoutBody`. */
  readonly channelLayout?: Uint8Array;

  /** Bytes between `SSND`'s header and its samples, stated as its offset. */
  readonly soundOffset?: number;

  /** Writes `COMM` after `SSND`, which the form allows. */
  readonly commonAfterSound?: boolean;

  readonly beforeSound?: readonly FixtureChunk[];
  readonly afterSound?: readonly FixtureChunk[];

  /** Bytes cut from the end of the finished file. */
  readonly truncate?: number;
}

/** What each uncompressed type stores, by the AIFF-C specification and Apple's extensions. */
function typeEncoding(type: string, sampleSize: number): FixtureEncoding | undefined {
  const integer = (bits: number, littleEndian: boolean, signed = true): FixtureEncoding => ({
    kind: 'integer',
    bits,
    bytes: Math.ceil(bits / 8),
    littleEndian,
    signed,
  });
  const types: Readonly<Record<string, FixtureEncoding>> = {
    NONE: integer(sampleSize, false),
    twos: integer(sampleSize, false),
    sowt: integer(sampleSize, true),
    in24: integer(24, false),
    in32: integer(32, false),
    '23ni': integer(24, true),
    '42ni': integer(32, true),
    'raw ': integer(8, false, false),
    fl32: { kind: 'float', bits: 32, littleEndian: false },
    FL32: { kind: 'float', bits: 32, littleEndian: false },
    fl64: { kind: 'float', bits: 64, littleEndian: false },
    FL64: { kind: 'float', bits: 64, littleEndian: false },
  };
  return types[type];
}

/** A positive rate as an 80-bit extended float, exactly: any double is one. */
function extendedFloat(rate: number): Uint8Array {
  if (rate === 0) return new Uint8Array(10);
  let exponent = 0;
  while (2 ** (exponent + 1) <= rate) exponent += 1;
  while (2 ** exponent > rate) exponent -= 1;
  const mantissa = BigInt(rate * 2 ** (63 - exponent));
  return fields(
    false,
    [exponent + 16_383, 2],
    [Number(mantissa >> 32n), 4],
    [Number(mantissa & 0xffff_ffffn), 4],
  );
}

/** The body of the `COMM` chunk. */
function commonBody(options: AiffOptions): Uint8Array {
  const frames = options.channels[0]?.length ?? 0;
  const body = joinBytes([
    fields(
      false,
      [options.commonOverrides?.channelCount ?? options.channels.length, 2],
      [options.commonOverrides?.declaredFrames ?? frames, 4],
      [options.sampleSize, 2],
    ),
    extendedFloat(options.sampleRate),
  ]);
  if (options.form !== 'aifc') return body;
  // A Pascal string, padded so its count byte and characters fill whole words.
  const name = codeBytes('not compressed');
  const pad = new Uint8Array((name.length + 1) % 2);
  return joinBytes([
    body,
    codeBytes(options.compressionType ?? 'NONE'),
    Uint8Array.of(name.length),
    name,
    pad,
  ]);
}

/** A `CHAN` body: CoreAudio's layout tag, channel bitmap and a description for each label. */
export function channelLayoutBody(layout: {
  readonly tag: number;
  readonly bitmap?: number;
  readonly labels?: readonly number[];
}): Uint8Array {
  const labels = layout.labels ?? [];
  return joinBytes([
    fields(false, [layout.tag, 4], [layout.bitmap ?? 0, 4], [labels.length, 4]),
    ...labels.map((label) => joinBytes([fields(false, [label, 4]), new Uint8Array(16)])),
  ]);
}

/** Writes an AIFF or AIFF-C file of the given samples. */
export function writeAiff(options: AiffOptions): Uint8Array {
  const encoding = typeEncoding(options.compressionType ?? 'NONE', options.sampleSize);
  const samples =
    encoding === undefined ? new Uint8Array(0) : encodeFrames(options.channels, encoding);
  const offset = options.soundOffset ?? 0;
  const sound: FixtureChunk = {
    id: 'SSND',
    body: joinBytes([fields(false, [offset, 4], [0, 4]), new Uint8Array(offset), samples]),
  };
  const common: FixtureChunk = { id: 'COMM', body: commonBody(options) };
  const chunks: FixtureChunk[] = [
    ...(options.form === 'aifc' ? [{ id: 'FVER', body: fields(false, [0xa2805140, 4]) }] : []),
    ...(options.commonAfterSound === true ? [] : [common]),
    ...(options.channelLayout === undefined ? [] : [{ id: 'CHAN', body: options.channelLayout }]),
    ...(options.beforeSound ?? []),
    sound,
    ...(options.commonAfterSound === true ? [common] : []),
    ...(options.afterSound ?? []),
  ];
  const body = joinBytes(chunks.map((chunk) => chunkBytes(chunk, false)));
  const type = options.form === 'aifc' ? 'AIFC' : 'AIFF';
  const file = joinBytes([
    codeBytes('FORM'),
    fields(false, [body.length + 4, 4]),
    codeBytes(type),
    body,
  ]);
  return file.slice(0, file.length - (options.truncate ?? 0));
}
