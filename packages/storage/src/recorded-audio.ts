/**
 * Reading back what a recording session committed (ADR-0071, REQ-AUDIO-220):
 * its chunks in order as one stream of 32-bit float frames, as long as they
 * reach, and the frames lost on the way.
 *
 * Each chunk counts to its last whole frame, so a chunk a crash tore, which
 * can only be the last since each is closed before the next is made, gives
 * every frame it holds whole and nothing of a frame cut short. The chunks are
 * written in order, so a missing frame between two chunks is not something a
 * crash leaves: it is storage that lost a file. Rather than stop there and
 * give up every chunk after it, which are whole and sit at the frames their
 * names say, the frames missing are read as silence and counted as lost, as a
 * gap the capture reported is, so the recording keeps its timing and the
 * person is told it is not whole. A marker of frames lost names silence the
 * chunks hold, and counts only as far as the chunks reach: one past them was
 * written by a session cut short before its silence was.
 *
 * The frames are read through the chunk files as the reader asks for them, so
 * the recording is never held whole in memory (REQ-PROD-009).
 */

import { derivedSampleCount, type SampleCount } from '@audiogubbins/domain';
import type { ByteSource, RecordedGaps, StorageTree } from '@audiogubbins/project-format';

import { CHUNK_SAMPLE_BYTES } from './recording-chunks.js';
import { frameOfChunk, gapOfName, type RecordingPaths } from './storage-layout.js';

/**
 * A run of a recording's bytes a chunk holds: its file from an offset in it.
 * Bytes no piece holds are silence.
 */
interface Piece {
  /** Where the piece starts in the recording's bytes. */
  readonly offset: number;
  readonly length: number;

  /** The chunk read, and where in it the piece starts. */
  readonly chunk: { readonly source: ByteSource; readonly from: number };
}

/** What a session committed, read back. */
export interface RecordedAudio {
  /** The whole frames the chunks reach. */
  readonly frames: SampleCount;

  /** The frames as 32-bit floats, little-endian and interleaved, read as they are asked for. */
  readonly data: ByteSource;

  /** The frames lost, as the capture reported them and as missing chunks left them. */
  readonly gaps: RecordedGaps | undefined;

  /** Of those, the frames that missing chunks left: none unless storage lost a file. */
  readonly missing: number;
}

/** The recording of `channels` channels the session at `paths` committed (see the module comment). */
export async function readRecordedAudio(
  tree: StorageTree,
  paths: RecordingPaths,
  channels: number,
  signal?: AbortSignal,
): Promise<RecordedAudio> {
  const frameBytes = channels * CHUNK_SAMPLE_BYTES;
  const pieces: Piece[] = [];
  let reached = 0;
  let missing = 0;
  let runs = 0;
  for (const entry of await tree.list(paths.chunks)) {
    signal?.throwIfAborted();
    const frame = entry.kind === 'file' ? frameOfChunk(entry.name) : undefined;
    const source = frame === undefined ? undefined : await tree.openFile(paths.chunk(frame));
    if (frame === undefined || source === undefined) continue;
    const end = frame + Math.floor(source.size / frameBytes);
    if (end <= reached) continue;
    if (frame > reached) {
      missing += frame - reached;
      runs += 1;
    }
    const start = Math.max(frame, reached);
    pieces.push({
      offset: start * frameBytes,
      length: (end - start) * frameBytes,
      chunk: { source, from: (start - frame) * frameBytes },
    });
    reached = end;
  }
  const reported = await reportedGaps(tree, paths, reached);
  const count = runs + reported.count;
  const lost = missing + reported.frames;
  return {
    frames: derivedSampleCount(reached),
    data: piecesSource(pieces, reached * frameBytes),
    gaps: count === 0 ? undefined : { count, frames: derivedSampleCount(lost) },
    missing,
  };
}

/** The gaps the markers report, as far as `reached`: how many, and their frames. */
async function reportedGaps(
  tree: StorageTree,
  paths: RecordingPaths,
  reached: number,
): Promise<{ readonly count: number; readonly frames: number }> {
  let count = 0;
  let frames = 0;
  for (const entry of await tree.list(paths.gaps)) {
    const gap = entry.kind === 'file' ? gapOfName(entry.name) : undefined;
    const within = gap === undefined ? 0 : Math.min(gap.frames, reached - gap.frame);
    if (within <= 0) continue;
    count += 1;
    frames += within;
  }
  return { count, frames };
}

/** The index of the piece holding byte `offset` of the recording. */
function pieceAt(pieces: readonly Piece[], offset: number): number {
  let low = 0;
  let high = pieces.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((pieces[middle]?.offset ?? 0) <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** The pieces read in order as one source of `size` bytes, silent where none is. */
function piecesSource(pieces: readonly Piece[], size: number): ByteSource {
  return {
    size,
    read: async (offset, wanted, signal) => {
      const end = Math.min(offset + wanted, size);
      const bytes = new Uint8Array(Math.max(0, end - offset));
      for (let index = pieceAt(pieces, offset); index < pieces.length; index += 1) {
        const piece = pieces[index];
        if (piece === undefined || piece.offset >= end) break;
        const from = Math.max(offset, piece.offset);
        const to = Math.min(end, piece.offset + piece.length);
        if (to <= from) continue;
        const part = await piece.chunk.source.read(
          piece.chunk.from + from - piece.offset,
          to - from,
          signal,
        );
        bytes.set(part, from - offset);
        // A chunk that came back short changed under the reader, which reads
        // on no further, so the caller sees a short read.
        if (part.length !== to - from) return bytes.slice(0, from - offset + part.length);
      }
      return bytes;
    },
  };
}
