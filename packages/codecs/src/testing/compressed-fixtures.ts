/**
 * What the tests of the compressed containers share: a map with every part
 * filled, a deterministic generator, the pages of an Ogg file, and the damage
 * the malformed-media tests do to a generated header.
 */

import type { SampleCount } from '@audiogubbins/domain';

import type { MetadataMap } from '../metadata-map.js';
import { OGG_HEADER_BYTES, readOggPage, readOggPageHeader, type OggPage } from '../ogg-page.js';

/** A count of frames, for a map a test writes. */
export const frames = (count: number): SampleCount => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- a fixture's literal count
  return count as SampleCount;
};

/** A picture's bytes: a PNG signature and a body, as a cover's would begin. */
export const COVER_BYTES = Uint8Array.from({ length: 3_000 }, (_, index) =>
  index < 8 ? ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index] ?? 0) : (index * 31) & 0xff,
);

/** A map with every text field, a foreign field, one plain loop and a cover, in characters of every width. */
export function fullMetadata(): MetadataMap {
  return {
    text: {
      title: 'Ōcean Drïft — 海',
      artist: 'The Synthesists',
      album: 'Tidal 𝄞 Works',
      albumArtist: 'Various',
      trackNumber: '3',
      trackTotal: '12',
      discNumber: '1',
      discTotal: '2',
      date: '2026-10-10',
      genre: 'Ambient',
      comment: 'Recorded at dawn.\nSecond line.',
      copyright: '℗ 2026 Example Records',
      encoder: 'AudioGubbins',
      isrc: 'GBXXX2600001',
    },
    foreign: [{ scheme: 'vorbis-comment', key: 'MOOD', value: 'Calm' }],
    loops: [
      { start: frames(4_410), length: frames(88_200), playCount: 'endless', direction: 'forward' },
    ],
    coverArt: { mediaType: 'image/png', description: 'Front', bytes: COVER_BYTES },
  };
}

/** A deterministic generator of 32-bit fractions. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** Every page of an Ogg file, in order, throwing where one does not read. */
export function oggPages(file: Uint8Array): OggPage[] {
  const pages: OggPage[] = [];
  for (let offset = 0; offset < file.length;) {
    const header = readOggPageHeader(file.subarray(offset, offset + OGG_HEADER_BYTES));
    if (!header.ok) throw new Error(header.failures[0].summary);
    const lacing = file.subarray(
      offset + OGG_HEADER_BYTES,
      offset + OGG_HEADER_BYTES + header.value.segments,
    );
    const length = OGG_HEADER_BYTES + lacing.length + lacing.reduce((sum, value) => sum + value, 0);
    const page = readOggPage(file.subarray(offset, offset + length));
    if (!page.ok) throw new Error(page.failures[0].summary);
    pages.push(page.value);
    offset += length;
  }
  return pages;
}

/**
 * `count` damaged copies of a file, each with one deterministic mutation in its
 * first `span` bytes: a byte replaced, a byte's bit flipped, a 32-bit field set
 * to an extreme, or the file cut short.
 */
export function mutations(
  file: Uint8Array,
  span: number,
  count: number,
  seed: number,
): Uint8Array[] {
  const next = random(seed);
  const reach = Math.min(span, file.length);
  const damaged: Uint8Array[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = Math.floor(next() * reach);
    const kind = index % 4;
    if (kind === 3) {
      damaged.push(file.slice(0, at));
      continue;
    }
    const copy = file.slice();
    if (kind === 0) {
      copy[at] = Math.floor(next() * 256);
    } else if (kind === 1) {
      copy[at] = (copy[at] ?? 0) ^ (1 << Math.floor(next() * 8));
    } else {
      const extreme =
        [0xffffffff, 0x7fffffff, 0x80000000, 0, 0xfffffff0][Math.floor(next() * 5)] ?? 0;
      const field = Math.min(at, Math.max(0, copy.length - 4));
      new DataView(copy.buffer).setUint32(field, extreme, next() < 0.5);
    }
    damaged.push(copy);
  }
  return damaged;
}
