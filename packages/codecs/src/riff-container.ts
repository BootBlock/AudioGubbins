/**
 * The RIFF forms: WAV, and RF64 and BW64 for files past 4 GiB.
 *
 * A WAV is `RIFF`, a size and `WAVE`, then chunks: the `fmt ` chunk must come
 * before the `data` chunk it describes. RF64 (EBU Tech 3306) and BW64 (ITU-R
 * BS.2088) put a `ds64` chunk first, holding the 64-bit sizes of the file, the
 * data and any other chunk too large for 32 bits; such a chunk writes
 * 0xFFFFFFFF as its 32-bit size. The RIFF size field is not consulted: the walk
 * is bounded by the file's true size, and a file cut short by a crash still
 * carries the size it was meant to have. Recognition ends at the format chunk,
 * and the rest of the parse continues the same walk to the data.
 */

import { fail, succeed, type CancellationSignal, type DomainResult } from '@audiogubbins/domain';

import { fourCharacterCode, viewOf, type HeaderSource } from './byte-reading.js';
import { speakerMaskLayout } from './channel-layouts.js';
import { ChunkWalk, readHeaderChunk, type ChunkSizeRules } from './chunk-walk.js';
import { malformed } from './codec-failures.js';
import {
  describeAudio,
  type AudioFormatDescriptor,
  type FormatStage,
} from './format-descriptor.js';
import { quotedCode, type RiffContainer } from './recognised-format.js';
import { EXTENSIBLE_FORMAT_BYTES, readWaveFormat, type WaveShape } from './wave-format.js';

/** Where the chunks begin, after the form's id, its size and `WAVE`. */
const FIRST_CHUNK = 12;

/** The 32-bit size that sends a reader to the ds64 chunk for the real one. */
export const SIZE_IN_DS64 = 0xffffffff;

/** The ds64 chunk's three 64-bit sizes and its table's length. */
export const DS64_FIXED_BYTES = 28;
const DS64_ENTRY_BYTES = 12;

/** The most ds64 table entries read: far more than the chunks any file needs sized so. */
const MAXIMUM_DS64_ENTRIES = 1_024;

/** The largest 64-bit high word whose value is still a safe integer. */
const SAFE_HIGH_WORD = 0x1fffff;

/** The 64-bit little-endian value at `offset`, or `undefined` where it is not a safe integer. */
function safeUint64(view: DataView, offset: number): number | undefined {
  const high = view.getUint32(offset + 4, true);
  return high > SAFE_HIGH_WORD ? undefined : high * 2 ** 32 + view.getUint32(offset, true);
}

/** Reads a ds64 chunk's body into the size rules the rest of the walk uses. */
function ds64Rules(body: Uint8Array, statedSize: number): DomainResult<ChunkSizeRules> {
  if (body.length < DS64_FIXED_BYTES) {
    return fail(malformed('The ds64 chunk is shorter than the 28 bytes its sizes need.'));
  }
  const view = viewOf(body);
  const dataSize = safeUint64(view, 8);
  const entries = view.getUint32(24, true);
  if (
    entries > MAXIMUM_DS64_ENTRIES ||
    DS64_FIXED_BYTES + entries * DS64_ENTRY_BYTES > statedSize
  ) {
    return fail(malformed('The ds64 chunk lists more chunk sizes than it holds.'));
  }
  const table = new Map<string, number>();
  for (let entry = 0; entry < entries; entry += 1) {
    const at = DS64_FIXED_BYTES + entry * DS64_ENTRY_BYTES;
    const size = safeUint64(view, at + 4);
    if (size === undefined) break;
    table.set(fourCharacterCode(body, at), size);
  }
  if (dataSize === undefined || table.size !== entries) {
    return fail(malformed('The ds64 chunk states a size larger than any file can be.'));
  }
  return succeed({
    littleEndian: true,
    resolve: (id, stated) => {
      if (stated !== SIZE_IN_DS64) return succeed(stated);
      const size = id === 'data' ? dataSize : table.get(id);
      return size === undefined
        ? fail(
            malformed(
              `The ${quotedCode(id)} chunk's size is kept in the ds64 chunk, which does not list it.`,
            ),
          )
        : succeed(size);
    },
  });
}

/** The walk over the form's chunks, which for RF64 and BW64 starts after the ds64 chunk and reads its sizes. */
async function firstWalk(
  source: HeaderSource,
  container: RiffContainer,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<ChunkWalk>> {
  if (container === 'wav')
    return succeed(new ChunkWalk(source, FIRST_CHUNK, { littleEndian: true }));
  const first = await new ChunkWalk(source, FIRST_CHUNK, { littleEndian: true }).next(signal);
  if (!first.ok) return first;
  if (first.value?.id !== 'ds64') {
    return fail(
      malformed(
        `The ${container.toUpperCase()} file does not begin with the ds64 chunk that holds its sizes.`,
      ),
    );
  }
  const span = first.value;
  const limit = DS64_FIXED_BYTES + MAXIMUM_DS64_ENTRIES * DS64_ENTRY_BYTES;
  const body = await readHeaderChunk(source, span, limit, signal);
  if (!body.ok) return body;
  const rules = ds64Rules(body.value, span.size);
  if (!rules.ok) return rules;
  return succeed(new ChunkWalk(source, span.bodyOffset + span.size + (span.size % 2), rules.value));
}

/** Continues a walk past the format chunk to the data, and describes the file. */
async function describeData(
  source: HeaderSource,
  walk: ChunkWalk,
  container: RiffContainer,
  shape: WaveShape,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<AudioFormatDescriptor>> {
  for (;;) {
    const next = await walk.next(signal);
    if (!next.ok) return next;
    const span = next.value;
    if (span === undefined)
      return fail(malformed('The file has no data chunk holding its samples.'));
    if (span.id !== 'data') continue;
    const blockAlign = shape.blockAlign;
    return describeAudio(
      {
        container,
        sampleRate: shape.sampleRate,
        encoding: shape.encoding,
        channelCount: shape.channelCount,
        blockAlign,
        dataOffset: span.bodyOffset,
        declaredFrames: blockAlign === 0 ? 0 : Math.floor(span.size / blockAlign),
        presentBytes: Math.min(span.size, source.size - span.bodyOffset),
      },
      (channelCount) =>
        shape.channelMask === undefined
          ? undefined
          : speakerMaskLayout(shape.channelMask, channelCount),
    );
  }
}

/**
 * Recognises a RIFF form's codec by walking to its format chunk, and, where the
 * samples are uncompressed PCM, offers the rest of the parse, which continues
 * the same walk and so is taken once.
 */
export async function recogniseRiff(
  source: HeaderSource,
  container: RiffContainer,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<FormatStage>> {
  const walked = await firstWalk(source, container, signal);
  if (!walked.ok) return walked;
  const walk = walked.value;
  for (;;) {
    const next = await walk.next(signal);
    if (!next.ok) return next;
    const span = next.value;
    if (span === undefined)
      return fail(malformed("The file has no 'fmt ' chunk describing its samples."));
    if (span.id === 'data') {
      return fail(malformed("The sample data comes before the 'fmt ' chunk that describes it."));
    }
    if (span.id !== 'fmt ') continue;
    const body = await readHeaderChunk(source, span, EXTENSIBLE_FORMAT_BYTES, signal);
    if (!body.ok) return body;
    const reading = readWaveFormat(body.value, container);
    if (!reading.ok) return reading;
    if (!reading.value.readable) return succeed({ readable: false, format: reading.value.format });
    const shape = reading.value.shape;
    return succeed({
      readable: true,
      format: { kind: container },
      describe: async (describeSignal) =>
        await describeData(source, walk, container, shape, describeSignal),
    });
  }
}
