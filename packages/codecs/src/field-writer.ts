/**
 * Writing a header's fields in order, and framing chunks as RIFF and IFF lay
 * them out, so every writer in this package writes a field and a chunk one way.
 *
 * A chunk is its four-character id, its 32-bit size in the form's byte order,
 * its body, and a pad byte after an odd body that the size does not count.
 */

import type { WrittenChunk } from './written-chunk.js';

/** The bytes of a chunk's id and size. */
export const CHUNK_HEADER_BYTES = 8;

/** Writes fields one after another into a buffer of a known length. */
export class FieldWriter {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  private readonly littleEndian: boolean;
  private at = 0;

  constructor(length: number, littleEndian: boolean) {
    this.bytes = new Uint8Array(length);
    this.view = new DataView(this.bytes.buffer);
    this.littleEndian = littleEndian;
  }

  code(id: string): void {
    for (let index = 0; index < 4; index += 1) this.bytes[this.at + index] = id.charCodeAt(index);
    this.at += 4;
  }

  uint8(value: number): void {
    this.view.setUint8(this.at, value);
    this.at += 1;
  }

  uint16(value: number): void {
    this.view.setUint16(this.at, value, this.littleEndian);
    this.at += 2;
  }

  int16(value: number): void {
    this.view.setInt16(this.at, value, this.littleEndian);
    this.at += 2;
  }

  uint32(value: number): void {
    this.view.setUint32(this.at, value, this.littleEndian);
    this.at += 4;
  }

  /** A 64-bit little-endian value, which its caller has kept a safe integer. */
  uint64(value: number): void {
    this.uint32(value % 2 ** 32);
    this.uint32(Math.floor(value / 2 ** 32));
  }

  raw(values: ArrayLike<number>): void {
    this.bytes.set(values, this.at);
    this.at += values.length;
  }

  /** A chunk whole: its id, its size, its body and the pad after an odd body. */
  chunk(chunk: WrittenChunk): void {
    this.code(chunk.id);
    this.uint32(chunk.body.length);
    this.raw(chunk.body);
    this.at += chunk.body.length % 2;
  }
}

/** The bytes a chunk takes in a file, its header and pad included. */
export function chunkLength(chunk: WrittenChunk): number {
  return CHUNK_HEADER_BYTES + chunk.body.length + (chunk.body.length % 2);
}

/** A chunk's body written by `write` into `length` bytes in the form's byte order. */
export function chunkOf(
  id: string,
  length: number,
  littleEndian: boolean,
  write: (out: FieldWriter) => void,
): WrittenChunk {
  const out = new FieldWriter(length, littleEndian);
  write(out);
  return { id, body: out.bytes };
}
