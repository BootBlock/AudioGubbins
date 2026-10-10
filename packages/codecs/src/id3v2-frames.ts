/**
 * The ID3v2 frames the map's text keys are written in and read from, which the
 * ID3v2 writer and reader share (ADR-0093).
 *
 * The track and disc numbers share `TRCK` and `TPOS`, written `n/m`; the
 * comment is a `COMM` frame with no description; the date is `TDRC`, read from
 * version 2.3's `TYER` and `TDAT` as well; and ID3v2.2's three-character frames
 * are read as the frames they became.
 */

import type { MetadataTextKey } from './metadata-map.js';

/** The scheme a foreign frame is kept under. */
export const ID3V2_SCHEME = 'id3v2';

/** The text frame each key with a frame of its own is written in. */
export const TEXT_FRAMES: readonly (readonly [MetadataTextKey, string])[] = [
  ['title', 'TIT2'],
  ['artist', 'TPE1'],
  ['album', 'TALB'],
  ['albumArtist', 'TPE2'],
  ['date', 'TDRC'],
  ['genre', 'TCON'],
  ['copyright', 'TCOP'],
  ['encoder', 'TSSE'],
  ['isrc', 'TSRC'],
];

/** The key each text frame is read into. */
export const KEY_OF_FRAME: ReadonlyMap<string, MetadataTextKey> = new Map<string, MetadataTextKey>([
  ...TEXT_FRAMES.map(([key, frame]) => [frame, key] as const),
  // Version 2.3's year, which version 2.4's recording time replaced.
  ['TYER', 'date'],
]);

/** The frames written for a number and its total. */
export const NUMBER_FRAMES = {
  TRCK: ['trackNumber', 'trackTotal'],
  TPOS: ['discNumber', 'discTotal'],
} as const;

/** Every frame the writer writes itself, which a foreign field may not take. */
export const WRITTEN_FRAMES: ReadonlySet<string> = new Set([
  ...TEXT_FRAMES.map(([, frame]) => frame),
  'TRCK',
  'TPOS',
  'TYER',
  'TDAT',
  'TXXX',
]);

/** ID3v2.2's three-character frames, as the frames of version 2.3 they became. */
export const VERSION_2_FRAMES: ReadonlyMap<string, string> = new Map([
  ['TT2', 'TIT2'],
  ['TP1', 'TPE1'],
  ['TAL', 'TALB'],
  ['TP2', 'TPE2'],
  ['TRK', 'TRCK'],
  ['TPA', 'TPOS'],
  ['TYE', 'TYER'],
  ['TDA', 'TDAT'],
  ['TCO', 'TCON'],
  ['TCR', 'TCOP'],
  ['TSS', 'TSSE'],
  ['TRC', 'TSRC'],
  ['TXX', 'TXXX'],
  ['COM', 'COMM'],
  ['PIC', 'APIC'],
]);
