/**
 * A deterministic writer of WAV, RF64 and BW64 fixture files.
 *
 * It writes every form the reader must read, and the departures from them a
 * test needs: a format tag or sub-format that names a compressed codec, extra
 * chunks of odd sizes before the format chunk, before the data and after it,
 * a fact chunk, sizes RF64 keeps in its ds64 table, and a file cut short. An
 * RF64 or BW64 fixture is small: what is tested is the form, not the size.
 */

import {
  chunkBytes,
  codeBytes,
  encodeFrames,
  fields,
  joinBytes,
  type FixtureChannel,
  type FixtureChunk,
} from './sample-writing.js';

/** How a WAV fixture stores its samples: `bytes` defaults to the whole bytes `bits` needs. */
export type WavEncoding =
  | { readonly kind: 'integer'; readonly bits: number; readonly bytes?: number }
  | { readonly kind: 'float'; readonly bits: 32 | 64 };

/** A WAV fixture. */
export interface WavOptions {
  readonly form?: 'wav' | 'rf64' | 'bw64';
  readonly sampleRate: number;
  readonly encoding: WavEncoding;
  readonly channels: readonly FixtureChannel[];

  /** Writes the extensible form, with this speaker mask and, where given, this sub-format GUID. */
  readonly extensible?: { readonly channelMask: number; readonly subFormat?: Uint8Array };

  /** States this format tag in place of the encoding's own, as a compressed file does. */
  readonly formatTag?: number;

  /** Replaces fields of the format chunk, to state what the samples are not. */
  readonly formatOverrides?: { readonly channelCount?: number; readonly blockAlign?: number };

  readonly beforeFormat?: readonly FixtureChunk[];
  readonly beforeData?: readonly FixtureChunk[];
  readonly afterData?: readonly FixtureChunk[];

  /** Writes a fact chunk stating this many frames, which a reader of PCM ignores. */
  readonly factFrames?: number;

  /** The ids of chunks among the extra ones whose sizes RF64 and BW64 keep in the ds64 table. */
  readonly sizesInDs64?: readonly string[];

  /** Bytes cut from the end of the finished file. */
  readonly truncate?: number;
}

/** The sub-format GUID of the standard family for a format code. */
function standardSubFormat(code: number): Uint8Array {
  return joinBytes([
    fields(true, [code, 4]),
    Uint8Array.of(0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71),
  ]);
}

/** The container bytes of each sample. */
function containerBytes(encoding: WavEncoding): number {
  return encoding.kind === 'float'
    ? encoding.bits / 8
    : (encoding.bytes ?? Math.ceil(encoding.bits / 8));
}

/** The body of the format chunk. */
function formatBody(options: WavOptions): Uint8Array {
  const { encoding, channels, extensible } = options;
  const bytes = containerBytes(encoding);
  const channelCount = options.formatOverrides?.channelCount ?? channels.length;
  const blockAlign = options.formatOverrides?.blockAlign ?? channels.length * bytes;
  const code = encoding.kind === 'float' ? 3 : 1;
  if (
    extensible === undefined &&
    encoding.kind === 'integer' &&
    bytes !== Math.ceil(encoding.bits / 8)
  ) {
    throw new RangeError(
      'Only the extensible form states valid bits narrower than their container.',
    );
  }
  const tag = options.formatTag ?? (extensible === undefined ? code : 0xfffe);
  const plain = fields(
    true,
    [tag, 2],
    [channelCount, 2],
    [options.sampleRate, 4],
    [options.sampleRate * blockAlign, 4],
    [blockAlign, 2],
    [extensible === undefined ? encoding.bits : bytes * 8, 2],
  );
  if (extensible === undefined) return plain;
  return joinBytes([
    plain,
    fields(true, [22, 2], [encoding.bits, 2], [extensible.channelMask, 4]),
    extensible.subFormat ?? standardSubFormat(code),
  ]);
}

/** The ds64 chunk: the file's, the data's and the sample count's 64-bit sizes, and the table. */
function ds64Chunk(
  riffSize: number,
  dataSize: number,
  frames: number,
  table: readonly FixtureChunk[],
): FixtureChunk {
  const sixtyFour = (value: number): [number, number][] => [
    [value % 2 ** 32, 4],
    [Math.floor(value / 2 ** 32), 4],
  ];
  return {
    id: 'ds64',
    body: joinBytes([
      fields(true, ...sixtyFour(riffSize), ...sixtyFour(dataSize), ...sixtyFour(frames), [
        table.length,
        4,
      ]),
      ...table.map((chunk) =>
        joinBytes([codeBytes(chunk.id), fields(true, ...sixtyFour(chunk.body.length))]),
      ),
    ]),
  };
}

/** Writes a WAV, RF64 or BW64 file of the given samples. */
export function writeWav(options: WavOptions): Uint8Array {
  const form = options.form ?? 'wav';
  const bytes = containerBytes(options.encoding);
  const data = encodeFrames(
    options.channels,
    options.encoding.kind === 'float'
      ? { kind: 'float', bits: options.encoding.bits, littleEndian: true }
      : {
          kind: 'integer',
          bits: options.encoding.bits,
          bytes,
          littleEndian: true,
          signed: bytes !== 1,
        },
  );
  const large = new Set(form === 'wav' ? [] : (options.sizesInDs64 ?? []));
  const extra = (chunks: readonly FixtureChunk[] | undefined) =>
    (chunks ?? []).map((chunk) =>
      large.has(chunk.id) ? { ...chunk, statedSize: 0xffffffff } : chunk,
    );
  const chunks: FixtureChunk[] = [
    ...extra(options.beforeFormat),
    { id: 'fmt ', body: formatBody(options) },
    ...(options.factFrames === undefined
      ? []
      : [{ id: 'fact', body: fields(true, [options.factFrames, 4]) }]),
    ...extra(options.beforeData),
    { id: 'data', body: data, ...(form === 'wav' ? {} : { statedSize: 0xffffffff }) },
    ...extra(options.afterData),
  ];
  if (form !== 'wav') {
    const listed = [
      ...(options.beforeFormat ?? []),
      ...(options.beforeData ?? []),
      ...(options.afterData ?? []),
    ].filter((chunk) => large.has(chunk.id));
    // The form's size counts `WAVE`, every chunk and the ds64 chunk's own header and fields.
    const chunkTotal = chunks.reduce(
      (total, chunk) => total + 8 + chunk.body.length + (chunk.body.length % 2),
      0,
    );
    const riffSize = 4 + chunkTotal + 8 + 28 + 12 * listed.length;
    chunks.unshift(ds64Chunk(riffSize, data.length, options.channels[0]?.length ?? 0, listed));
  }
  const body = joinBytes(chunks.map((chunk) => chunkBytes(chunk, true)));
  const id = form === 'wav' ? 'RIFF' : form.toUpperCase();
  const riffSize = form === 'wav' ? body.length + 4 : 0xffffffff;
  const file = joinBytes([codeBytes(id), fields(true, [riffSize, 4]), codeBytes('WAVE'), body]);
  return file.slice(0, file.length - (options.truncate ?? 0));
}
