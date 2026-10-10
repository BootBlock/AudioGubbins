/**
 * A chunk a writer puts into a RIFF or IFF file: its four-character id and its
 * body, before the size field and the pad byte the form adds.
 *
 * The metadata writers answer chunks and the file writers frame them, so the
 * byte order of the size, the pad after an odd body and RF64's 64-bit sizes are
 * decided in one place for every chunk a file holds.
 */
export interface WrittenChunk {
  readonly id: string;
  readonly body: Uint8Array;
}
