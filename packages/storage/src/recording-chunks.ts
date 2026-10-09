/**
 * Committing a recording as it is made (ADR-0071, REQ-REC-096): its frames in
 * chunks of a second at most, each a file of its own written whole and closed,
 * named by the frame of the recording it starts at, under the session's
 * `chunks/`.
 *
 * The storage tree has no append and a sink is durable only once it closes, so
 * a growing file would keep nothing a crash could find: a chunk per file keeps
 * every chunk closed before the crash. A chunk holds 32-bit floats,
 * little-endian, interleaved in the recording's channel order, which is the
 * data of the WAV file the recording becomes, so finishing copies the chunks
 * as they are. The frames of a chunk wait in one buffer, made once and reused
 * for every chunk, so an hour's recording is never held in memory
 * (REQ-PROD-009).
 *
 * Frames lost before they reached the storage are written as silence, so the
 * take's timing holds, after an empty marker under the session's `gaps/` names
 * them; a crash between the two leaves a marker past the last chunk, which
 * reading disregards (`recorded-audio.ts`).
 */

import { TreeFailure, type ByteSink, type StorageTree } from '@audiogubbins/project-format';

import type { RecordingPaths } from './storage-layout.js';

/** The bytes one sample of a chunk takes: a 32-bit float. */
export const CHUNK_SAMPLE_BYTES = 4;

const NOTHING = new Uint8Array(0);

/** Writes a recording's chunks (see the module comment). */
export class ChunkWriter {
  readonly #tree: StorageTree;
  readonly #paths: RecordingPaths;
  readonly #channels: number;
  readonly #chunkFrames: number;
  readonly #buffer: Uint8Array<ArrayBuffer>;
  readonly #view: DataView;

  /** The frames of the recording in chunks closed. */
  #committed = 0;

  /** The frames waiting in the buffer, after the committed ones. */
  #waiting = 0;

  /** Writes chunks of `chunkFrames` frames at most, of `channels` channels, at `paths`. */
  constructor(tree: StorageTree, paths: RecordingPaths, channels: number, chunkFrames: number) {
    this.#tree = tree;
    this.#paths = paths;
    this.#channels = channels;
    this.#chunkFrames = chunkFrames;
    this.#buffer = new Uint8Array(chunkFrames * channels * CHUNK_SAMPLE_BYTES);
    this.#view = new DataView(this.#buffer.buffer);
  }

  /** The frames of the recording in chunks closed, which a crash keeps. */
  get committed(): number {
    return this.#committed;
  }

  /** The frames the recording has reached, committed or waiting. */
  get reached(): number {
    return this.#committed + this.#waiting;
  }

  /**
   * Adds the frames of `channels`, one array per channel of one length,
   * committing each chunk that fills. Rejects with the tree's refusal of a
   * chunk, whose frames are not committed.
   */
  async append(channels: readonly Float32Array[]): Promise<void> {
    const frames = channels[0]?.length ?? 0;
    if (channels.length !== this.#channels || channels.some((one) => one.length !== frames)) {
      throw new Error('A recording’s frames come as one array of one length per channel.');
    }
    for (let from = 0; from < frames;) {
      const taken = Math.min(frames - from, this.#chunkFrames - this.#waiting);
      this.#interleave(channels, from, taken);
      from += taken;
      if (this.#waiting === this.#chunkFrames) await this.commit();
    }
  }

  /**
   * Adds `frames` frames of silence for frames lost, after a marker naming
   * them, committing each chunk that fills.
   */
  async silence(frames: number): Promise<void> {
    await this.#tree.writeFile(this.#paths.gap(this.reached, frames), NOTHING);
    for (let left = frames; left > 0;) {
      const taken = Math.min(left, this.#chunkFrames - this.#waiting);
      const at = this.#waiting * this.#channels * CHUNK_SAMPLE_BYTES;
      this.#buffer.fill(0, at, at + taken * this.#channels * CHUNK_SAMPLE_BYTES);
      this.#waiting += taken;
      left -= taken;
      if (this.#waiting === this.#chunkFrames) await this.commit();
    }
  }

  /**
   * Writes the frames waiting as a chunk, whole, and closes it. Rejects with
   * the tree's refusal, leaving those frames uncommitted and the chunk
   * abandoned.
   */
  async commit(): Promise<void> {
    if (this.#waiting === 0) return;
    const sink = await this.#tree.createFile(this.#paths.chunk(this.#committed));
    let closed = false;
    try {
      await sink.write(
        this.#buffer.subarray(0, this.#waiting * this.#channels * CHUNK_SAMPLE_BYTES),
      );
      await sink.close();
      closed = true;
    } finally {
      if (!closed) await abandon(sink);
    }
    this.#committed += this.#waiting;
    this.#waiting = 0;
  }

  /** Copies `frames` frames of `channels` from `from` into the buffer, interleaved. */
  #interleave(channels: readonly Float32Array[], from: number, frames: number): void {
    const count = this.#channels;
    let at = this.#waiting * count * CHUNK_SAMPLE_BYTES;
    for (let frame = from; frame < from + frames; frame += 1) {
      for (const channel of channels) {
        this.#view.setFloat32(at, channel[frame] ?? 0, true);
        at += CHUNK_SAMPLE_BYTES;
      }
    }
    this.#waiting += frames;
  }
}

/** Abandons a chunk whose write was refused. */
async function abandon(sink: ByteSink): Promise<void> {
  try {
    await sink.abort();
  } catch (error) {
    // A chunk that cannot be abandoned is left as far as it was written, which
    // reading takes to its last whole frame, so it harms nothing; the refusal
    // that stopped the write is the one its caller hears.
    if (!(error instanceof TreeFailure)) throw error;
  }
}
