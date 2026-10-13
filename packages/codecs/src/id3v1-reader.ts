/**
 * The ID3v1 tag at the end of an MP3 file: 128 bytes after `TAG` of fixed
 * Latin-1 fields, and in version 1.1 a track number in the comment's last byte
 * (ADR-0093). Read only, and only for what an ID3v2 tag does not say.
 */

import { id3Genre } from './id3-genres.js';
import type { MetadataGathering } from './metadata-gathering.js';
import { decodeText } from './metadata-text.js';

/** The tag's length. */
export const ID3V1_BYTES = 128;

/** A field's text: up to its first NUL, without trailing spaces. */
function field(tag: Uint8Array, offset: number, length: number): string {
  return decodeText(tag.subarray(offset, offset + length), 'latin-1').trimEnd();
}

/** Reads a tag, the file's last 128 bytes, into `gathering`, or nothing where they are not one. */
export function readId3v1(tag: Uint8Array, gathering: MetadataGathering): void {
  if (tag.length !== ID3V1_BYTES || tag[0] !== 0x54 || tag[1] !== 0x41 || tag[2] !== 0x47) return;
  const texts = [
    ['title', field(tag, 3, 30)],
    ['artist', field(tag, 33, 30)],
    ['album', field(tag, 63, 30)],
    ['date', field(tag, 93, 4)],
  ] as const;
  for (const [key, value] of texts) if (value !== '') gathering.addText(key, value);
  // Version 1.1: a zero byte before the comment's last, which is then the track.
  const track = tag[125] === 0 ? (tag[126] ?? 0) : 0;
  const comment = field(tag, 97, track > 0 ? 28 : 30);
  if (comment !== '') gathering.addText('comment', comment);
  if (track > 0) gathering.addText('trackNumber', String(track));
  const genre = id3Genre(tag[127] ?? 255);
  if (genre !== undefined) gathering.addText('genre', genre);
}
