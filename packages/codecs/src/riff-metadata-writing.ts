/**
 * A metadata map as the chunks of a WAV, RF64 or BW64 file (ADR-0093), and the
 * parts of it the form cannot hold.
 *
 * Each part is written whole or reported dropped whole, never truncated into
 * something the person did not say, and only as the reader in this package
 * reads it back: a value its text rules would change, a count past its bound or
 * a position past 32 bits is dropped and reported. Chunks come in one order,
 * `bext`, `LIST`/`INFO`, `cue `, `LIST`/`adtl`, `smpl`, so the same map gives
 * the same bytes. Text is written as UTF-8: `INFO` and `labl` values as ZSTR,
 * ended by a NUL; `bext` holds ASCII alone, as EBU Tech 3285 requires.
 *
 * The `iXML` a map carries is dropped, not written: it describes the recording
 * it was read from, and an export's iXML is written by the WAV writer from the
 * export's own channel layout, which a carried one could contradict.
 */

import type {
  BroadcastDescription,
  CuePoint,
  MetadataLoop,
  MetadataMap,
  MetadataPart,
  SamplerTuning,
} from './metadata-map.js';
import { METADATA_CHUNK_BYTES } from './metadata-reading.js';
import {
  LINE_TEXT,
  LONG_TEXT,
  TEXT_KEYS,
  encodeText,
  readsBackUnchanged,
  textRulesOf,
} from './metadata-text.js';
import {
  BEXT_FIXED_BYTES,
  BEXT_TEXT_FIELDS,
  BEXT_TIME_REFERENCE,
  BEXT_VERSION_OFFSET,
} from './riff-broadcast.js';
import { CUE_COUNT_BYTES, CUE_FIELDS, CUE_POINT_BYTES, MAXIMUM_CUE_POINTS } from './riff-cues.js';
import { INFO_FIELDS, INFO_SCHEME, MAXIMUM_INFO_FIELDS, PRINTABLE_ID } from './riff-info.js';
import { LABEL_CUE_ID_BYTES } from './riff-labels.js';
import { ENTRY_HEADER_BYTES, LIST_TYPE_BYTES } from './riff-list-entries.js';
import {
  CENTS_PER_SEMITONE,
  HIGHEST_NOTE,
  LOOP_FIELDS,
  MAXIMUM_LOOPS,
  PITCH_FRACTION_WHOLE,
  SAMPLER_FIELDS,
  SAMPLER_HEADER_BYTES,
  SAMPLER_LOOP_BYTES,
  SAMPLER_LOOP_TYPES,
} from './riff-sampler.js';
import type { WrittenChunk } from './written-chunk.js';

/** The `INFO` id of each typed key the form has one for, in the order they are written. */
const INFO_IDS: ReadonlyMap<string, string> = new Map(
  [...INFO_FIELDS].map(([id, key]) => [key, id]),
);

/** The `smpl` loop type of each direction. */
const LOOP_TYPES: ReadonlyMap<string, number> = new Map(
  [...SAMPLER_LOOP_TYPES].map(([type, direction]) => [direction, type]),
);

/** The largest value a 32-bit field holds. */
const LARGEST_32 = 0xffff_ffff;

/**
 * The `bext` version written. Version 1 adds the UMID, written as zeros, which
 * the specification allows; version 2's loudness fields would state measured
 * values the map does not hold, and zeros there would claim a loudness.
 */
const WRITTEN_BEXT_VERSION = 1;

/** The `bext` text fields, in the order the chunk holds them. */
const BEXT_TEXT_ORDER = [
  'description',
  'originator',
  'originatorReference',
  'originationDate',
  'originationTime',
] as const satisfies readonly (keyof typeof BEXT_TEXT_FIELDS)[];

/** What EBU Tech 3285 lets a `bext` field hold: printable ASCII, and line breaks in the history. */
const BEXT_FIELD_TEXT = /^[\x20-\x7e]*$/;
const BEXT_HISTORY_TEXT = /^[\x20-\x7e\t\r\n]*$/;

/** The MIDI note a `smpl` chunk states where the map has loops and no tuning: middle C. */
const DEFAULT_UNITY_NOTE = 60;

const NANOSECONDS_PER_SECOND = 1e9;

/** A cue point's chunk id, `data`, for the one data chunk a file here holds. */
const DATA_CHUNK_ID = 'data';

/** The bytes of an ASCII code. */
function codeBytes(code: string): Uint8Array {
  return Uint8Array.from(code, (character) => character.charCodeAt(0));
}

/** Joins byte arrays in order. */
function joined(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** A list entry: its id, its size, a ZSTR after `prefix`, and the pad byte an odd size needs. */
function zstrEntry(id: string, prefix: Uint8Array, text: string): Uint8Array {
  const value = encodeText(text);
  const size = prefix.length + value.length + 1;
  const entry = new Uint8Array(ENTRY_HEADER_BYTES + size + (size % 2));
  entry.set(codeBytes(id), 0);
  new DataView(entry.buffer).setUint32(4, size, true);
  entry.set(prefix, ENTRY_HEADER_BYTES);
  entry.set(value, ENTRY_HEADER_BYTES + prefix.length);
  return entry;
}

/** A `LIST` chunk of a type and its entries. */
function listChunk(type: string, entries: readonly Uint8Array[]): WrittenChunk {
  return { id: 'LIST', body: joined([codeBytes(type), ...entries]) };
}

/** Collects a list's entries up to the bytes the reader reads of one chunk. */
class ListBuilder {
  readonly entries: Uint8Array[] = [];
  private bytes = LIST_TYPE_BYTES;

  /** Adds the entry where the list has room for it, answering whether it did. */
  add(entry: Uint8Array): boolean {
    if (this.bytes + entry.length > METADATA_CHUNK_BYTES) return false;
    this.entries.push(entry);
    this.bytes += entry.length;
    return true;
  }

  /** Whether entries of these sizes all fit beside those already added. */
  fits(entries: readonly Uint8Array[]): boolean {
    return (
      this.bytes + entries.reduce((total, entry) => total + entry.length, 0) <= METADATA_CHUNK_BYTES
    );
  }
}

/** The `LIST`/`INFO` chunk of the map's text and `riff-info` fields, reporting what it cannot hold. */
function infoChunk(metadata: MetadataMap, dropped: MetadataPart[]): WrittenChunk | undefined {
  const list = new ListBuilder();
  const room = () => list.entries.length < MAXIMUM_INFO_FIELDS;
  for (const key of TEXT_KEYS) {
    const value = metadata.text?.[key];
    if (value === undefined) continue;
    const id = INFO_IDS.get(key);
    const written =
      id !== undefined &&
      readsBackUnchanged(value, textRulesOf(key)) &&
      room() &&
      list.add(zstrEntry(id, new Uint8Array(0), value));
    if (!written) dropped.push({ kind: 'text', key });
  }
  for (const field of metadata.foreign ?? []) {
    const written =
      field.scheme === INFO_SCHEME &&
      PRINTABLE_ID.test(field.key) &&
      field.key !== 'LIST' &&
      readsBackUnchanged(field.value, LONG_TEXT) &&
      room() &&
      list.add(zstrEntry(field.key, new Uint8Array(0), field.value));
    if (!written) dropped.push({ kind: 'foreign', scheme: field.scheme, key: field.key });
  }
  return list.entries.length === 0 ? undefined : listChunk('INFO', list.entries);
}

/** The `bext` chunk of a description, or `undefined` where a field is not ASCII or does not fit. */
function broadcastChunk(broadcast: BroadcastDescription): WrittenChunk | undefined {
  const fits = BEXT_TEXT_ORDER.every(
    (field) =>
      broadcast[field].length <= BEXT_TEXT_FIELDS[field][1] &&
      BEXT_FIELD_TEXT.test(broadcast[field]),
  );
  const history = broadcast.codingHistory;
  if (!fits || !BEXT_HISTORY_TEXT.test(history) || !readsBackUnchanged(history, LONG_TEXT)) {
    return undefined;
  }
  const body = new Uint8Array(BEXT_FIXED_BYTES + history.length);
  for (const field of BEXT_TEXT_ORDER) {
    body.set(codeBytes(broadcast[field]), BEXT_TEXT_FIELDS[field][0]);
  }
  const view = new DataView(body.buffer);
  view.setUint32(BEXT_TIME_REFERENCE, broadcast.timeReference % 2 ** 32, true);
  view.setUint32(BEXT_TIME_REFERENCE + 4, Math.floor(broadcast.timeReference / 2 ** 32), true);
  view.setUint16(BEXT_VERSION_OFFSET, WRITTEN_BEXT_VERSION, true);
  body.set(codeBytes(history), BEXT_FIXED_BYTES);
  return { id: 'bext', body };
}

/** Whether a name is one a `labl` entry reads back unchanged; an empty name is none. */
function writableName(name: string | undefined): boolean {
  return name === undefined || readsBackUnchanged(name, LINE_TEXT);
}

/** Whether the cue points fit the `cue ` chunk's bound and 32-bit offsets. */
function writableCues(cues: readonly CuePoint[]): boolean {
  return (
    cues.length <= MAXIMUM_CUE_POINTS &&
    cues.every((cue) => cue.position <= LARGEST_32 && writableName(cue.name))
  );
}

/** Whether a loop's frames, play count and name fit a `smpl` loop. */
function writableLoop(loop: MetadataLoop): boolean {
  const count = loop.playCount;
  return (
    loop.length >= 1 &&
    loop.start + loop.length - 1 <= LARGEST_32 &&
    (count === 'endless' || (Number.isInteger(count) && count >= 1 && count <= LARGEST_32)) &&
    writableName(loop.name)
  );
}

/** The unity note and pitch fraction `smpl` states for a tuning, or `undefined` where it has none. */
function pitchFields(
  tuning: SamplerTuning,
): { readonly note: number; readonly fraction: number } | undefined {
  const { unityNote, fineTuneCents } = tuning;
  if (!Number.isInteger(unityNote) || unityNote < 0 || unityNote > HIGHEST_NOTE) return undefined;
  if (!Number.isInteger(fineTuneCents) || Math.abs(fineTuneCents) > CENTS_PER_SEMITONE / 2)
    return undefined;
  // The fraction is only ever above the note, so a flat tuning is the note below raised.
  const cents = unityNote * CENTS_PER_SEMITONE + fineTuneCents;
  const note = Math.floor(cents / CENTS_PER_SEMITONE);
  if (note < 0) return undefined;
  return {
    note,
    fraction: Math.round(
      ((cents - note * CENTS_PER_SEMITONE) * PITCH_FRACTION_WHOLE) / CENTS_PER_SEMITONE,
    ),
  };
}

/** The `cue ` chunk: each point's frame as both its position and its offset into the data. */
function cueChunk(cues: readonly CuePoint[]): WrittenChunk {
  const body = new Uint8Array(CUE_COUNT_BYTES + cues.length * CUE_POINT_BYTES);
  const view = new DataView(body.buffer);
  view.setUint32(0, cues.length, true);
  for (const [index, cue] of cues.entries()) {
    const at = CUE_COUNT_BYTES + index * CUE_POINT_BYTES;
    view.setUint32(at + CUE_FIELDS.id, index + 1, true);
    view.setUint32(at + CUE_FIELDS.position, cue.position, true);
    body.set(codeBytes(DATA_CHUNK_ID), at + CUE_FIELDS.chunk);
    view.setUint32(at + CUE_FIELDS.sampleOffset, cue.position, true);
  }
  return { id: 'cue ', body };
}

/** The `smpl` chunk of loops whose ids start at `firstId`, and a tuning. */
function samplerChunk(
  loops: readonly MetadataLoop[],
  firstId: number,
  pitch: { readonly note: number; readonly fraction: number },
  sampleRate: number,
): WrittenChunk {
  const body = new Uint8Array(SAMPLER_HEADER_BYTES + loops.length * SAMPLER_LOOP_BYTES);
  const view = new DataView(body.buffer);
  view.setUint32(SAMPLER_FIELDS.period, Math.round(NANOSECONDS_PER_SECOND / sampleRate), true);
  view.setUint32(SAMPLER_FIELDS.unityNote, pitch.note, true);
  view.setUint32(SAMPLER_FIELDS.pitchFraction, pitch.fraction, true);
  view.setUint32(SAMPLER_FIELDS.loopCount, loops.length, true);
  for (const [index, loop] of loops.entries()) {
    const at = SAMPLER_HEADER_BYTES + index * SAMPLER_LOOP_BYTES;
    view.setUint32(at + LOOP_FIELDS.id, firstId + index, true);
    view.setUint32(at + LOOP_FIELDS.type, LOOP_TYPES.get(loop.direction) ?? 0, true);
    view.setUint32(at + LOOP_FIELDS.start, loop.start, true);
    // The end is the last frame played.
    view.setUint32(at + LOOP_FIELDS.end, loop.start + loop.length - 1, true);
    view.setUint32(
      at + LOOP_FIELDS.playCount,
      loop.playCount === 'endless' ? 0 : loop.playCount,
      true,
    );
  }
  return { id: 'smpl', body };
}

/** The `labl` entries of named cue points and loops, by their ids. */
function labelEntries(
  named: readonly { readonly id: number; readonly name: string | undefined }[],
): Uint8Array[] {
  return named
    .filter((item) => item.name !== undefined && item.name !== '')
    .map((item) => {
      const prefix = new Uint8Array(LABEL_CUE_ID_BYTES);
      new DataView(prefix.buffer).setUint32(0, item.id, true);
      return zstrEntry('labl', prefix, item.name ?? '');
    });
}

/**
 * The chunks of a WAV, RF64 or BW64 file holding the map's metadata, and the
 * parts of the map they do not hold. `sampleRate` is the file's, for the sample
 * period `smpl` states, rounded to whole nanoseconds.
 */
export function riffMetadataChunks(
  metadata: MetadataMap,
  sampleRate: number,
): { readonly chunks: readonly WrittenChunk[]; readonly dropped: readonly MetadataPart[] } {
  const dropped: MetadataPart[] = [];
  const info = infoChunk(metadata, dropped);
  const broadcast =
    metadata.broadcast === undefined ? undefined : broadcastChunk(metadata.broadcast);
  if (metadata.broadcast !== undefined && broadcast === undefined)
    dropped.push({ kind: 'broadcast' });

  const labels = new ListBuilder();
  const givenCues = metadata.cues ?? [];
  const cueLabels = labelEntries(
    givenCues.map((cue, index) => ({ id: index + 1, name: cue.name })),
  );
  const cues = writableCues(givenCues) && labels.fits(cueLabels) ? givenCues : [];
  if (cues.length !== givenCues.length) dropped.push({ kind: 'cues' });
  else cueLabels.forEach((entry) => labels.add(entry));

  // Loops take the ids after the cue points', so a label names one or the other.
  const givenLoops = metadata.loops ?? [];
  const loopLabels = labelEntries(
    givenLoops.map((loop, index) => ({ id: cues.length + 1 + index, name: loop.name })),
  );
  const loopsFit =
    givenLoops.length <= MAXIMUM_LOOPS && givenLoops.every(writableLoop) && labels.fits(loopLabels);
  const loops = loopsFit ? givenLoops : [];
  if (loops.length !== givenLoops.length) dropped.push({ kind: 'loops' });
  else loopLabels.forEach((entry) => labels.add(entry));

  const pitch = metadata.tuning === undefined ? undefined : pitchFields(metadata.tuning);
  if (metadata.tuning !== undefined && pitch === undefined) dropped.push({ kind: 'tuning' });
  if (metadata.coverArt !== undefined) dropped.push({ kind: 'coverArt' });

  const sampler =
    loops.length === 0 && pitch === undefined
      ? undefined
      : samplerChunk(
          loops,
          cues.length + 1,
          pitch ?? { note: DEFAULT_UNITY_NOTE, fraction: 0 },
          sampleRate,
        );
  const chunks = [
    broadcast,
    info,
    cues.length === 0 ? undefined : cueChunk(cues),
    labels.entries.length === 0 ? undefined : listChunk('adtl', labels.entries),
    sampler,
  ].filter((chunk) => chunk !== undefined);
  return { chunks, dropped };
}
