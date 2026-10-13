/**
 * The metadata of an AIFF or AIFF-C file, read into the one map (ADR-0093).
 *
 * The chunks mapped are `NAME`, `AUTH`, `(c) ` and `ANNO` for text, `MARK` for
 * named points and `INST` for the sampler's tuning and its two loops, the
 * sustain loop and the release loop, each bounded by two markers. Of every
 * chunk but `ANNO` the first is read; every `ANNO` is a comment, and they are
 * joined by line feeds in file order. AIFF's text is classically Mac OS Roman;
 * it is read by the package's one rule for untrusted text, so a Mac Roman
 * character past ASCII reads as its Latin-1 namesake.
 *
 * A marker a playing loop names is the loop's bound, not a cue point, and the
 * loop takes its begin marker's name. A loop whose end is not after its start
 * plays no loop, as the AIFF specification says, so it is left out; a loop
 * naming a marker the file does not hold, or a play mode AIFF does not define,
 * breaks the form and is refused with `codecs.malformed`, as is a marker table
 * past its chunk or bound, a marker id that is not positive or is repeated, and
 * a note or detune outside the ranges the specification gives.
 */

import {
  fail,
  succeed,
  type CancellationSignal,
  type DomainResult,
  type SampleCount,
} from '@audiogubbins/domain';

import type { AudioBytes } from './audio-bytes.js';
import { fourCharacterCode, viewOf } from './byte-reading.js';
import { ChunkWalk, type ChunkSpan } from './chunk-walk.js';
import { malformed } from './codec-failures.js';
import type {
  CuePoint,
  LoopDirection,
  MetadataLoop,
  MetadataMap,
  MetadataTextKey,
  SamplerTuning,
} from './metadata-map.js';
import {
  MetadataChunkReader,
  openForm,
  statedFrames,
  type MetadataReader,
} from './metadata-reading.js';
import { LINE_TEXT, LONG_TEXT, cutText, readText, textRulesOf } from './metadata-text.js';
import { quotedCode } from './recognised-format.js';
import { MAXIMUM_ANNOTATIONS, MAXIMUM_MARKERS } from './metadata-limits.js';

/** Where the chunks begin, after `FORM`, its size and the form type. */
const FIRST_CHUNK = 12;

/** The text chunks with a typed key, besides `ANNO`, which may repeat. */
export const AIFF_TEXT_CHUNKS: ReadonlyMap<string, MetadataTextKey> = new Map([
  ['NAME', 'title'],
  ['AUTH', 'artist'],
  ['(c) ', 'copyright'],
]);
export const ANNOTATION_CHUNK = 'ANNO';

/** A `MARK` chunk's count, and each marker's id and position before its name. */
export const MARKER_COUNT_BYTES = 2;
export const MARKER_FIXED_BYTES = 6;

/** The `INST` chunk's bytes, and where its fields and loops lie. */
export const INSTRUMENT_BYTES = 20;
export const INSTRUMENT_FIELDS = {
  baseNote: 0,
  detune: 1,
  lowNote: 2,
  highNote: 3,
  lowVelocity: 4,
  highVelocity: 5,
  gain: 6,
  sustainLoop: 8,
  releaseLoop: 14,
} as const;

/** A loop's play mode, begin marker and end marker, after the loop's offset. */
export const LOOP_FIELDS = { playMode: 0, begin: 2, end: 4 } as const;

/** The play modes AIFF defines that play a loop; 0 plays none. */
export const PLAY_MODES: ReadonlyMap<number, LoopDirection> = new Map([
  [1, 'forward'],
  [2, 'alternating'],
]);
const NO_LOOP = 0;

/** The highest MIDI note, and the detune's range in cents. */
export const HIGHEST_NOTE = 127;
export const LARGEST_DETUNE = 50;

/** A marker as `MARK` lists it. */
interface Marker {
  readonly id: number;
  readonly position: SampleCount;
  readonly name: string;
}

/** A loop as `INST` states it, before its markers are found. */
interface StatedLoop {
  readonly which: 'sustain' | 'release';
  readonly playMode: number;
  readonly begin: number;
  readonly end: number;
}

/** What `INST` states. */
interface Instrument {
  readonly tuning: SamplerTuning;
  readonly loops: readonly StatedLoop[];
}

/** What the walk has found so far. */
interface AiffFindings {
  readonly text: Partial<Record<MetadataTextKey, string>>;
  readonly annotations: string[];
  readonly seen: Set<string>;
  markers?: readonly Marker[];
  instrument?: Instrument;
}

const DONE = succeed(undefined);

/** The refusal of a `MARK` chunk that lists more markers than it holds. */
const MARKERS_PAST_CHUNK = 'The MARK chunk lists more markers than it holds.';

/** Reads one marker at `at`, answering it and where the next begins. */
function readMarker(
  body: Uint8Array,
  view: DataView,
  at: number,
): DomainResult<{ readonly marker: Marker; readonly next: number }> {
  const nameAt = at + MARKER_FIXED_BYTES + 1;
  if (nameAt > body.length) return fail(malformed(MARKERS_PAST_CHUNK));
  const nameLength = body[nameAt - 1] ?? 0;
  if (nameAt + nameLength > body.length) return fail(malformed(MARKERS_PAST_CHUNK));
  const id = view.getInt16(at, false);
  if (id <= 0) {
    return fail(
      malformed(`The MARK chunk lists a marker of id ${String(id)}, which is not positive.`),
    );
  }
  const position = statedFrames(view.getUint32(at + 2, false), 'marker');
  if (!position.ok) return position;
  const name = readText(body.subarray(nameAt, nameAt + nameLength), 'unstated', LINE_TEXT);
  // The count byte and the name are padded together to an even length.
  return succeed({
    marker: { id, position: position.value, name },
    next: nameAt + nameLength + ((nameLength + 1) % 2),
  });
}

/** Reads a `MARK` chunk's markers. */
function readMarkers(body: Uint8Array, findings: AiffFindings): DomainResult<undefined> {
  if (body.length < MARKER_COUNT_BYTES) {
    return fail(malformed('The MARK chunk is too short to hold its count of markers.'));
  }
  const view = viewOf(body);
  const count = view.getUint16(0, false);
  if (count > MAXIMUM_MARKERS) {
    return fail(
      malformed(
        `The MARK chunk lists ${String(count)} markers, more than the ${String(MAXIMUM_MARKERS)} any file needs.`,
      ),
    );
  }
  const markers: Marker[] = [];
  const ids = new Set<number>();
  let at = MARKER_COUNT_BYTES;
  for (let index = 0; index < count; index += 1) {
    const read = readMarker(body, view, at);
    if (!read.ok) return read;
    const { marker, next } = read.value;
    if (ids.has(marker.id)) {
      return fail(malformed(`The MARK chunk lists marker ${String(marker.id)} more than once.`));
    }
    ids.add(marker.id);
    markers.push(marker);
    at = next;
  }
  findings.markers = markers;
  return DONE;
}

/** Reads an `INST` chunk's tuning and the loops it states. */
function readInstrument(body: Uint8Array, findings: AiffFindings): DomainResult<undefined> {
  if (body.length < INSTRUMENT_BYTES) {
    return fail(
      malformed(
        `The INST chunk is shorter than the ${String(INSTRUMENT_BYTES)} bytes of its fields.`,
      ),
    );
  }
  const view = viewOf(body);
  const baseNote = view.getInt8(INSTRUMENT_FIELDS.baseNote);
  const detune = view.getInt8(INSTRUMENT_FIELDS.detune);
  if (baseNote < 0 || baseNote > HIGHEST_NOTE) {
    return fail(malformed(`The INST chunk's base note ${String(baseNote)} is not a MIDI note.`));
  }
  if (Math.abs(detune) > LARGEST_DETUNE) {
    return fail(
      malformed(
        `The INST chunk detunes by ${String(detune)} cents, past the ${String(LARGEST_DETUNE)} either way AIFF allows.`,
      ),
    );
  }
  const loop = (which: StatedLoop['which'], at: number): StatedLoop => ({
    which,
    playMode: view.getInt16(at + LOOP_FIELDS.playMode, false),
    begin: view.getInt16(at + LOOP_FIELDS.begin, false),
    end: view.getInt16(at + LOOP_FIELDS.end, false),
  });
  findings.instrument = {
    tuning: { unityNote: baseNote, fineTuneCents: detune },
    loops: [
      loop('sustain', INSTRUMENT_FIELDS.sustainLoop),
      loop('release', INSTRUMENT_FIELDS.releaseLoop),
    ],
  };
  return DONE;
}

/** The loop `INST` states with its markers found, or `undefined` where it plays none. */
function resolvedLoop(
  stated: StatedLoop,
  markers: ReadonlyMap<number, Marker>,
): DomainResult<MetadataLoop | undefined> {
  if (stated.playMode === NO_LOOP) return succeed(undefined);
  const direction = PLAY_MODES.get(stated.playMode);
  if (direction === undefined) {
    return fail(
      malformed(
        `The INST chunk's ${stated.which} loop has play mode ${String(stated.playMode)}, which AIFF does not define.`,
      ),
    );
  }
  const begin = markers.get(stated.begin);
  const end = markers.get(stated.end);
  if (begin === undefined || end === undefined) {
    const missing = begin === undefined ? stated.begin : stated.end;
    return fail(
      malformed(
        `The INST chunk's ${stated.which} loop names marker ${String(missing)}, which the file does not hold.`,
      ),
    );
  }
  if (end.position <= begin.position) return succeed(undefined);
  const length = statedFrames(end.position - begin.position, `${stated.which} loop`);
  if (!length.ok) return length;
  return succeed({
    start: begin.position,
    length: length.value,
    playCount: 'endless',
    direction,
    ...(begin.name === '' ? {} : { name: begin.name }),
  });
}

/** The loops, and the cue points of the markers no playing loop names. */
function markedParts(
  findings: AiffFindings,
): DomainResult<{ readonly cues: readonly CuePoint[]; readonly loops: readonly MetadataLoop[] }> {
  const markers = findings.markers ?? [];
  const byId = new Map(markers.map((marker) => [marker.id, marker]));
  const bounds = new Set<number>();
  const loops: MetadataLoop[] = [];
  for (const stated of findings.instrument?.loops ?? []) {
    const loop = resolvedLoop(stated, byId);
    if (!loop.ok) return loop;
    if (stated.playMode !== NO_LOOP) bounds.add(stated.begin).add(stated.end);
    if (loop.value !== undefined) loops.push(loop.value);
  }
  const cues = markers
    .filter((marker) => !bounds.has(marker.id))
    .map((marker) => ({ position: marker.position, name: marker.name }));
  return succeed({ cues, loops });
}

/** Reads one chunk the walk met, if the map takes it. */
async function readChunk(
  chunks: MetadataChunkReader,
  span: ChunkSpan,
  findings: AiffFindings,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<undefined>> {
  const key = AIFF_TEXT_CHUNKS.get(span.id);
  const annotation = span.id === ANNOTATION_CHUNK;
  const structured = span.id === 'MARK' || span.id === 'INST';
  if (key === undefined && !annotation && !structured) return DONE;
  if (!annotation && findings.seen.has(span.id)) return DONE;
  if (annotation && findings.annotations.length === MAXIMUM_ANNOTATIONS) {
    return fail(
      malformed(
        `The file holds more than the ${String(MAXIMUM_ANNOTATIONS)} ${quotedCode(ANNOTATION_CHUNK)} chunks any file needs.`,
      ),
    );
  }
  findings.seen.add(span.id);
  const body = await chunks.body(span, signal);
  if (!body.ok) return body;
  if (key !== undefined) findings.text[key] = readText(body.value, 'unstated', textRulesOf(key));
  if (annotation) findings.annotations.push(readText(body.value, 'unstated', LONG_TEXT));
  if (span.id === 'MARK') return readMarkers(body.value, findings);
  if (span.id === 'INST') return readInstrument(body.value, findings);
  return DONE;
}

/** The map of what was found. */
function foundMap(findings: AiffFindings): DomainResult<MetadataMap> {
  const marked = markedParts(findings);
  if (!marked.ok) return marked;
  const { cues, loops } = marked.value;
  const text: Partial<Record<MetadataTextKey, string>> = { ...findings.text };
  if (findings.annotations.length > 0) {
    // Joined, the comment is bounded as one comment read from any format is.
    text.comment = cutText(findings.annotations.join('\n'), LONG_TEXT);
  }
  const tuning = findings.instrument?.tuning;
  return succeed({
    ...(Object.keys(text).length === 0 ? {} : { text }),
    ...(cues.length === 0 ? {} : { cues }),
    ...(loops.length === 0 ? {} : { loops }),
    ...(tuning === undefined ? {} : { tuning }),
  });
}

/** Reads an AIFF or AIFF-C file's metadata. */
export const readAiffMetadata: MetadataReader = async (
  bytes: AudioBytes,
  signal?: CancellationSignal,
): Promise<DomainResult<MetadataMap>> => {
  const opened = await openForm(bytes, signal);
  if (!opened.ok) return opened;
  const { head, source } = opened.value;
  const type = fourCharacterCode(head, 8);
  if (fourCharacterCode(head, 0) !== 'FORM' || (type !== 'AIFF' && type !== 'AIFC')) {
    return fail(malformed('The file is not an AIFF or AIFF-C file.'));
  }
  const walk = new ChunkWalk(source, FIRST_CHUNK, { littleEndian: false });
  const chunks = new MetadataChunkReader(source);
  const findings: AiffFindings = { text: {}, annotations: [], seen: new Set() };
  for (;;) {
    const next = await walk.next(signal);
    if (!next.ok) return next;
    if (next.value === undefined) return foundMap(findings);
    const read = await readChunk(chunks, next.value, findings, signal);
    if (!read.ok) return read;
  }
};
