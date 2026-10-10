/**
 * A metadata map as the chunks of an AIFF or AIFF-C file (ADR-0093), and the
 * parts of it the form cannot hold.
 *
 * AIFF holds a title, an artist, a copyright and comments, markers, and an
 * instrument with a tuning and two loops that play forward or back and forth
 * for as long as a note is held. Every other part is reported dropped, as is a
 * part this package's reader would not read back unchanged: more than two
 * loops, a backward loop, a loop that plays a counted number of times, a
 * position past 32 bits, a name longer than a marker's 255 bytes, or a tuning
 * that is not whole cents within the ranges `INST` holds. Each part is written
 * whole or dropped whole. Text is written as UTF-8, with no terminator, since
 * the chunk's size is its length; the whole comment is one `ANNO` chunk. The
 * chunks come in one order, `NAME`, `AUTH`, `(c) `, `ANNO`, `MARK`, `INST`, so
 * the same map gives the same bytes.
 */

import {
  AIFF_TEXT_CHUNKS,
  ANNOTATION_CHUNK,
  HIGHEST_NOTE,
  INSTRUMENT_BYTES,
  INSTRUMENT_FIELDS,
  LARGEST_DETUNE,
  LOOP_FIELDS,
  MARKER_COUNT_BYTES,
  MARKER_FIXED_BYTES,
  MAXIMUM_MARKERS,
  PLAY_MODES,
} from './aiff-metadata.js';
import type {
  CuePoint,
  MetadataLoop,
  MetadataMap,
  MetadataPart,
  MetadataTextKey,
  SamplerTuning,
} from './metadata-map.js';
import {
  LINE_TEXT,
  TEXT_KEYS,
  encodeText,
  readsBackUnchanged,
  textRulesOf,
} from './metadata-text.js';
import type { WrittenChunk } from './written-chunk.js';

/** The chunk each typed key AIFF holds is written to. */
const TEXT_CHUNK_IDS: ReadonlyMap<MetadataTextKey, string> = new Map([
  ...[...AIFF_TEXT_CHUNKS].map(([id, key]): [MetadataTextKey, string] => [key, id]),
  ['comment', ANNOTATION_CHUNK],
]);

/** The play mode of each direction `INST` holds. */
const PLAY_MODE_OF: ReadonlyMap<string, number> = new Map(
  [...PLAY_MODES].map(([mode, direction]) => [direction, mode]),
);

/** The loops `INST` holds: the sustain loop and the release loop. */
const INSTRUMENT_LOOPS = [INSTRUMENT_FIELDS.sustainLoop, INSTRUMENT_FIELDS.releaseLoop] as const;

/** The largest value a marker's 32-bit position holds, and its name's bytes. */
const LARGEST_POSITION = 0xffff_ffff;
const LARGEST_MARKER_NAME = 255;

/**
 * The note range and velocities an instrument written here plays over: every
 * note and every velocity, since the map states no range, at unity gain.
 */
const LOWEST_NOTE = 0;
const LOWEST_VELOCITY = 1;
const HIGHEST_VELOCITY = 127;

/** The note `INST` states where the map has loops and no tuning: middle C. */
const DEFAULT_BASE_NOTE = 60;

/** A marker to write: its position and its name. */
interface MarkerEntry {
  readonly position: number;
  readonly name: string;
}

/** Whether a name fits a marker's Pascal string and reads back unchanged. */
function writableMarkerName(name: string): boolean {
  return readsBackUnchanged(name, LINE_TEXT) && encodeText(name).length <= LARGEST_MARKER_NAME;
}

/** Whether every cue point fits a marker. */
function writableCues(cues: readonly CuePoint[], room: number): boolean {
  return (
    cues.length <= room &&
    cues.every((cue) => cue.position <= LARGEST_POSITION && writableMarkerName(cue.name))
  );
}

/** Whether the loops fit `INST`'s two endless loops between markers. */
function writableLoops(loops: readonly MetadataLoop[]): boolean {
  return (
    loops.length <= INSTRUMENT_LOOPS.length &&
    loops.every(
      (loop) =>
        PLAY_MODE_OF.has(loop.direction) &&
        loop.playCount === 'endless' &&
        loop.length >= 1 &&
        loop.start + loop.length <= LARGEST_POSITION &&
        writableMarkerName(loop.name ?? ''),
    )
  );
}

/** Whether a tuning is a MIDI note and whole cents `INST` can state. */
function writableTuning(tuning: SamplerTuning): boolean {
  const { unityNote, fineTuneCents } = tuning;
  return (
    Number.isInteger(unityNote) &&
    unityNote >= 0 &&
    unityNote <= HIGHEST_NOTE &&
    Number.isInteger(fineTuneCents) &&
    Math.abs(fineTuneCents) <= LARGEST_DETUNE
  );
}

/** The text chunks, reporting the keys AIFF has no chunk for. */
function textChunks(metadata: MetadataMap, dropped: MetadataPart[]): WrittenChunk[] {
  const chunks: WrittenChunk[] = [];
  for (const key of TEXT_KEYS) {
    const value = metadata.text?.[key];
    if (value === undefined) continue;
    const id = TEXT_CHUNK_IDS.get(key);
    if (id === undefined || !readsBackUnchanged(value, textRulesOf(key))) {
      dropped.push({ kind: 'text', key });
    } else {
      chunks.push({ id, body: encodeText(value) });
    }
  }
  // Written in the reader's chunk order, not the keys' order.
  const order = [...TEXT_CHUNK_IDS.values()];
  return chunks.sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id));
}

/** The `MARK` chunk: each marker's id, from 1, its position and its padded Pascal-string name. */
function markerChunk(markers: readonly MarkerEntry[]): WrittenChunk {
  const names = markers.map((marker) => encodeText(marker.name));
  const size = names.reduce(
    (total, name) => total + MARKER_FIXED_BYTES + 1 + name.length + ((name.length + 1) % 2),
    MARKER_COUNT_BYTES,
  );
  const body = new Uint8Array(size);
  const view = new DataView(body.buffer);
  view.setUint16(0, markers.length, false);
  let at = MARKER_COUNT_BYTES;
  for (const [index, marker] of markers.entries()) {
    const name = names[index] ?? new Uint8Array(0);
    view.setInt16(at, index + 1, false);
    view.setUint32(at + 2, marker.position, false);
    view.setUint8(at + MARKER_FIXED_BYTES, name.length);
    body.set(name, at + MARKER_FIXED_BYTES + 1);
    at += MARKER_FIXED_BYTES + 1 + name.length + ((name.length + 1) % 2);
  }
  return { id: 'MARK', body };
}

/** The `INST` chunk of a tuning and loops whose markers' ids start at `firstMarker`. */
function instrumentChunk(
  tuning: SamplerTuning,
  loops: readonly MetadataLoop[],
  firstMarker: number,
): WrittenChunk {
  const body = new Uint8Array(INSTRUMENT_BYTES);
  const view = new DataView(body.buffer);
  view.setInt8(INSTRUMENT_FIELDS.baseNote, tuning.unityNote);
  view.setInt8(INSTRUMENT_FIELDS.detune, tuning.fineTuneCents);
  view.setInt8(INSTRUMENT_FIELDS.lowNote, LOWEST_NOTE);
  view.setInt8(INSTRUMENT_FIELDS.highNote, HIGHEST_NOTE);
  view.setInt8(INSTRUMENT_FIELDS.lowVelocity, LOWEST_VELOCITY);
  view.setInt8(INSTRUMENT_FIELDS.highVelocity, HIGHEST_VELOCITY);
  for (const [index, loop] of loops.entries()) {
    const at = INSTRUMENT_LOOPS[index] ?? INSTRUMENT_FIELDS.sustainLoop;
    view.setInt16(at + LOOP_FIELDS.playMode, PLAY_MODE_OF.get(loop.direction) ?? 0, false);
    view.setInt16(at + LOOP_FIELDS.begin, firstMarker + index * 2, false);
    view.setInt16(at + LOOP_FIELDS.end, firstMarker + index * 2 + 1, false);
  }
  return { id: 'INST', body };
}

/**
 * The chunks of an AIFF or AIFF-C file holding the map's metadata, and the
 * parts of the map they do not hold. A loop is bounded by two markers after the
 * cue points', the first named with the loop's name.
 */
export function aiffMetadataChunks(metadata: MetadataMap): {
  readonly chunks: readonly WrittenChunk[];
  readonly dropped: readonly MetadataPart[];
} {
  const dropped: MetadataPart[] = [];
  const chunks = textChunks(metadata, dropped);
  for (const field of metadata.foreign ?? []) {
    dropped.push({ kind: 'foreign', scheme: field.scheme, key: field.key });
  }
  if (metadata.broadcast !== undefined) dropped.push({ kind: 'broadcast' });

  const givenLoops = metadata.loops ?? [];
  const loops = writableLoops(givenLoops) ? givenLoops : [];
  const givenCues = metadata.cues ?? [];
  const cues = writableCues(givenCues, MAXIMUM_MARKERS - loops.length * 2) ? givenCues : [];
  if (cues.length !== givenCues.length) dropped.push({ kind: 'cues' });
  if (loops.length !== givenLoops.length) dropped.push({ kind: 'loops' });
  const tuning =
    metadata.tuning !== undefined && writableTuning(metadata.tuning) ? metadata.tuning : undefined;
  if (metadata.tuning !== undefined && tuning === undefined) dropped.push({ kind: 'tuning' });
  if (metadata.coverArt !== undefined) dropped.push({ kind: 'coverArt' });

  const markers: MarkerEntry[] = [
    ...cues,
    ...loops.flatMap((loop) => [
      { position: loop.start, name: loop.name ?? '' },
      { position: loop.start + loop.length, name: '' },
    ]),
  ];
  if (markers.length > 0) chunks.push(markerChunk(markers));
  if (loops.length > 0 || tuning !== undefined) {
    chunks.push(
      instrumentChunk(
        tuning ?? { unityNote: DEFAULT_BASE_NOTE, fineTuneCents: 0 },
        loops,
        cues.length + 1,
      ),
    );
  }
  return { chunks, dropped };
}
