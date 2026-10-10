/**
 * A whole file from a writer of the streaming write contract: the blocks
 * written in pieces of a chosen size, then the head, the bodies in order and
 * the tail joined, as staging joins them.
 */

import type { AudioFileWriter, FinishedAudioFile } from '../audio-file-writer.js';

/** What a writer wrote: the whole file, and what its finish answered. */
export interface WrittenFile {
  readonly file: Uint8Array;
  readonly finished: FinishedAudioFile;
}

/**
 * Writes `channels` through `writer` in blocks of `block` frames and joins the
 * file, or throws the first failure: a test that needs a failure calls the
 * writer itself.
 */
export async function writeWhole(
  writer: AudioFileWriter,
  channels: readonly Float32Array[],
  block = 1_000,
): Promise<WrittenFile> {
  const frames = channels[0]?.length ?? 0;
  const bodies: Uint8Array[] = [];
  for (let at = 0; at < frames; at += block) {
    const count = Math.min(block, frames - at);
    const written = await writer.write(
      channels.map((channel) => channel.subarray(at, at + count)),
      count,
    );
    if (!written.ok) throw new Error(written.failures[0].summary);
    bodies.push(...written.value);
  }
  const finished = await writer.finish();
  if (!finished.ok) throw new Error(finished.failures[0].summary);
  const parts = [finished.value.head, ...bodies, finished.value.tail];
  const file = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    file.set(part, offset);
    offset += part.length;
  }
  return { file, finished: finished.value };
}
