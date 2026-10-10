/**
 * What every metadata reader is, and the bounds it reads a file's metadata
 * within (ADR-0093, REQ-EXEC-136).
 *
 * A reader takes the same byte port as the audio reader, so a file is read for
 * its metadata without being held whole, and it reads only the bodies of the
 * chunks it maps. Each body is bounded on its own and all of them together, so
 * a file of thousands of chunks each claiming a megabyte costs no more than the
 * total; a chunk past either bound is refused, never read in part, because a
 * part of a structured chunk would be read as something it does not say.
 */

import {
  fail,
  sampleCount,
  succeed,
  type CancellationSignal,
  type DomainResult,
  type SampleCount,
} from '@audiogubbins/domain';

import type { AudioBytes } from './audio-bytes.js';
import { HeaderSource, readExactly } from './byte-reading.js';
import { readHeaderChunk, type ChunkSpan } from './chunk-walk.js';
import { malformed } from './codec-failures.js';
import type { MetadataMap } from './metadata-map.js';
import { quotedCode } from './recognised-format.js';

/** Reads a file's metadata into the one map, refusing what breaks its format's rules. */
export type MetadataReader = (
  bytes: AudioBytes,
  signal?: CancellationSignal,
) => Promise<DomainResult<MetadataMap>>;

/** The form header both RIFF and IFF open with: its id, its size and its type. */
const FORM_HEADER_BYTES = 12;

/** The most bytes of one metadata chunk read: far more than any label, loop table or history needs. */
export const METADATA_CHUNK_BYTES = 1_048_576;

/** The most bytes of metadata chunks read from one file. */
const METADATA_FILE_BYTES = 8 * METADATA_CHUNK_BYTES;

/** A file opened for its metadata: its first bytes, and the source the walk reads through. */
export interface OpenedForm {
  readonly head: Uint8Array;
  readonly source: HeaderSource;
}

/** Reads the 12-byte form header, refusing a file too short to hold one. */
export async function openForm(
  bytes: AudioBytes,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<OpenedForm>> {
  if (bytes.size < FORM_HEADER_BYTES) {
    return fail(malformed('The file is too short to hold the header of its form.'));
  }
  const head = await readExactly(bytes, 0, FORM_HEADER_BYTES, signal);
  if (!head.ok) return head;
  return succeed({ head: head.value, source: new HeaderSource(bytes, head.value) });
}

/** Reads metadata chunk bodies whole, within the per-chunk and per-file bounds. */
export class MetadataChunkReader {
  private readonly source: HeaderSource;
  private spent = 0;

  constructor(source: HeaderSource) {
    this.source = source;
  }

  /** The chunk's whole body, or the refusal of a chunk past a bound or past the file's end. */
  async body(
    span: ChunkSpan,
    signal: CancellationSignal | undefined,
  ): Promise<DomainResult<Uint8Array>> {
    if (span.size > METADATA_CHUNK_BYTES) {
      return fail(
        malformed(
          `The ${quotedCode(span.id)} chunk holds ${String(span.size)} bytes, more than the ${String(METADATA_CHUNK_BYTES)} any metadata chunk needs.`,
        ),
      );
    }
    if (this.spent + span.size > METADATA_FILE_BYTES) {
      return fail(
        malformed(
          `The file's metadata chunks hold more than the ${String(METADATA_FILE_BYTES)} bytes any file's metadata needs.`,
        ),
      );
    }
    this.spent += span.size;
    return await readHeaderChunk(this.source, span, span.size, signal);
  }
}

/** A frame position or length a chunk states, refusing one past the frames the domain counts. */
export function statedFrames(value: number, what: string): DomainResult<SampleCount> {
  const frames = sampleCount(value);
  return frames.ok
    ? frames
    : fail(malformed(`The ${what} lies further into the file than any file can reach.`));
}

/**
 * The refusal of a table whose count is past its bound, or which needs more
 * bytes than the chunk holds; the bound is checked first, so a hostile count is
 * named as such whatever the chunk's size.
 */
export function countRefusal(
  id: string,
  count: number,
  bound: number,
  needed: number,
  held: number,
  what: string,
): DomainResult<undefined> {
  if (count > bound) {
    return fail(
      malformed(
        `The ${quotedCode(id)} chunk lists ${String(count)} ${what}, more than the ${String(bound)} any file needs.`,
      ),
    );
  }
  return needed > held
    ? fail(malformed(`The ${quotedCode(id)} chunk lists more ${what} than it holds.`))
    : succeed(undefined);
}
