/**
 * The bounded walk over a RIFF or IFF file's chunks.
 *
 * Both families lay a file out as chunks of a four-character id, a 32-bit size
 * and a body padded to an even length; RIFF writes the size little-endian and
 * IFF big-endian. The walk reads only each chunk's eight-byte header and seeks
 * past its body, so an unknown chunk costs one small read however large it
 * claims to be, and it stops after `MAXIMUM_CHUNKS`, so a hostile file cannot
 * make a reader read without end (ADR-0052). A chunk whose size runs past the
 * file ends the walk at the file's end, which is how a truncated data chunk is
 * found; whether that is a truncation or a malformed header is the caller's to
 * decide, by which chunk it is.
 */

import { fail, succeed, type CancellationSignal, type DomainResult } from '@audiogubbins/domain';

import { fourCharacterCode, viewOf, type HeaderSource } from './byte-reading.js';
import { malformed } from './codec-failures.js';
import { quotedCode } from './recognised-format.js';

/** Where a chunk lies: its id, the offset of its body and the body's size in bytes. */
export interface ChunkSpan {
  readonly id: string;
  readonly bodyOffset: number;
  readonly size: number;
}

/**
 * The most chunks a walk reads: far more than any audio file carries, and few
 * enough that their headers are 32 KiB.
 */
const MAXIMUM_CHUNKS = 4_096;

const CHUNK_HEADER_BYTES = 8;

/** How a chunk's size field is read. */
export interface ChunkSizeRules {
  readonly littleEndian: boolean;

  /**
   * The size of a chunk whose 32-bit field states `stated`, where the form
   * keeps some sizes elsewhere, as RF64 keeps them in its ds64 chunk.
   */
  readonly resolve?: (id: string, stated: number) => DomainResult<number>;
}

/** A walk over the chunks from one offset to the end of the file. */
export class ChunkWalk {
  private readonly source: HeaderSource;
  private readonly rules: ChunkSizeRules;
  private cursor: number;
  private walked = 0;

  constructor(source: HeaderSource, start: number, rules: ChunkSizeRules) {
    this.source = source;
    this.rules = rules;
    this.cursor = start;
  }

  /** The next chunk, or `undefined` once no whole chunk header remains in the file. */
  async next(signal: CancellationSignal | undefined): Promise<DomainResult<ChunkSpan | undefined>> {
    if (this.cursor + CHUNK_HEADER_BYTES > this.source.size) return succeed(undefined);
    if (this.walked === MAXIMUM_CHUNKS) {
      return fail(
        malformed(
          `The file holds more than ${String(MAXIMUM_CHUNKS)} chunks before its audio, more than any audio file needs.`,
        ),
      );
    }
    this.walked += 1;
    const header = await this.source.read(this.cursor, CHUNK_HEADER_BYTES, signal);
    if (!header.ok) return header;
    const id = fourCharacterCode(header.value, 0);
    const stated = viewOf(header.value).getUint32(4, this.rules.littleEndian);
    const size =
      this.rules.resolve === undefined ? succeed(stated) : this.rules.resolve(id, stated);
    if (!size.ok) return size;
    const bodyOffset = this.cursor + CHUNK_HEADER_BYTES;
    const following = bodyOffset + size.value + (size.value % 2);
    if (!Number.isSafeInteger(following)) {
      return fail(malformed(`The ${quotedCode(id)} chunk states a size too large for any file.`));
    }
    this.cursor = following;
    return succeed({ id, bodyOffset, size: size.value });
  }
}

/**
 * Reads the first `limit` bytes of a header chunk's body, refusing a chunk
 * whose stated size runs past the end of the file: unlike the sample data, a
 * header chunk cut short has lost what the file needs to be read at all.
 */
export async function readHeaderChunk(
  source: HeaderSource,
  span: ChunkSpan,
  limit: number,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<Uint8Array>> {
  if (span.bodyOffset + span.size > source.size) {
    return fail(malformed(`The ${quotedCode(span.id)} chunk runs past the end of the file.`));
  }
  return await source.read(span.bodyOffset, Math.min(span.size, limit), signal);
}
