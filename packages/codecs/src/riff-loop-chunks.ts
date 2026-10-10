/**
 * A WAV file's loops, tuning and cue points as its RIFF chunks state them:
 * `smpl`, `cue ` and the `labl` entries of a `LIST`/`adtl` chunk, for a
 * container that carries those chunks, as FLAC's `APPLICATION` `riff` blocks
 * do (ADR-0093).
 *
 * Positions are 32-bit frame counts, and a loop's end is its last frame. A
 * `smpl` chunk always states a tuning, so a map with loops and no tuning is
 * written with the sampler's default, MIDI note 60 played unchanged, and reads
 * back with it. A fine tuning below zero is written, as the chunk's unsigned
 * fraction requires, as the note below and the cents above it, and read back
 * in the range from -50 up to but not including 50 cents, so 50 cents above a
 * note reads as 50 below the next, the same pitch. Labels are UTF-8.
 */

import { sampleCount, type SampleCount } from '@audiogubbins/domain';

import { fourCharacterCode, viewOf } from './byte-reading.js';
import { ByteWriter } from './byte-writer.js';
import type { MetadataGathering } from './metadata-gathering.js';
import { MAXIMUM_METADATA_FIELDS } from './metadata-limits.js';
import type {
  CuePoint,
  LoopDirection,
  MetadataLoop,
  MetadataMap,
  SamplerTuning,
} from './metadata-map.js';
import { decodeUtf8, encodeUtf8 } from './metadata-text.js';

/** One RIFF chunk: its id and its body, unpadded. */
export interface RiffChunk {
  readonly id: string;
  readonly body: Uint8Array;
}

/** The chunks a map's loops, tuning and cues are written as, and what they could not hold. */
export interface WrittenRiffLoopChunks {
  readonly chunks: readonly RiffChunk[];
  readonly loopsPartial: boolean;
  readonly cuesDropped: boolean;
  readonly tuningDropped: boolean;
}

const LOOP_TYPES: readonly LoopDirection[] = ['forward', 'alternating', 'backward'];

/** The sampler's default tuning, where a map states none. */
const DEFAULT_TUNING: SamplerTuning = { unityNote: 60, fineTuneCents: 0 };

const SMPL_FIXED_BYTES = 36;
const SMPL_LOOP_BYTES = 24;
const CUE_POINT_BYTES = 24;
const LARGEST_POSITION = 0xffffffff;

/** The fraction of a semitone the chunk counts in: 2^32 parts. */
const FRACTION_UNITS = 2 ** 32;

/** The tuning as the chunk's note and unsigned fraction, or `undefined` where it has none. */
function chunkTuning(tuning: SamplerTuning): readonly [note: number, fraction: number] | undefined {
  const { unityNote, fineTuneCents } = tuning;
  if (!Number.isInteger(unityNote) || unityNote < 0 || unityNote > 127) return undefined;
  if (!(fineTuneCents >= -50 && fineTuneCents <= 50)) return undefined;
  const note = fineTuneCents < 0 ? unityNote - 1 : unityNote;
  const cents = fineTuneCents < 0 ? fineTuneCents + 100 : fineTuneCents;
  if (note < 0) return undefined;
  return [note, Math.min(FRACTION_UNITS - 1, Math.round((cents / 100) * FRACTION_UNITS))];
}

/** Whether the chunk can state a loop: its frames where 32-bit positions reach, and a count it can hold. */
const loopFits = (loop: MetadataLoop): boolean =>
  loop.length >= 1 &&
  loop.start + loop.length - 1 <= LARGEST_POSITION &&
  (loop.playCount === 'endless' ||
    (Number.isInteger(loop.playCount) &&
      loop.playCount >= 1 &&
      loop.playCount <= LARGEST_POSITION));

/** The `smpl`, `cue ` and `LIST`/`adtl` chunks of a map's loops, tuning and cues, at `sampleRate`. */
export function encodeRiffLoopChunks(map: MetadataMap, sampleRate: number): WrittenRiffLoopChunks {
  const chunks: RiffChunk[] = [];
  const loops = map.loops ?? [];
  const writable = loops.filter(loopFits);
  const tuning = map.tuning === undefined ? undefined : chunkTuning(map.tuning);
  const tuningDropped = map.tuning !== undefined && tuning === undefined;

  if (writable.length > 0 || tuning !== undefined) {
    const [note, fraction] = tuning ?? chunkTuning(DEFAULT_TUNING) ?? [60, 0];
    const smpl = new ByteWriter()
      .u32(0, true)
      .u32(0, true)
      .u32(Math.round(1e9 / sampleRate), true)
      .u32(note, true)
      .u32(fraction, true)
      .u32(0, true)
      .u32(0, true)
      .u32(writable.length, true)
      .u32(0, true);
    for (const loop of writable) {
      smpl
        .u32(0, true)
        .u32(LOOP_TYPES.indexOf(loop.direction), true)
        .u32(loop.start, true)
        .u32(loop.start + loop.length - 1, true)
        .u32(0, true)
        .u32(loop.playCount === 'endless' ? 0 : loop.playCount, true);
    }
    chunks.push({ id: 'smpl', body: smpl.toBytes().slice() });
  }

  const cues = map.cues ?? [];
  const placed = cues.filter((cue) => cue.position <= LARGEST_POSITION);
  if (placed.length > 0) {
    const cue = new ByteWriter().u32(placed.length, true);
    const labels = new ByteWriter().latin1('adtl');
    placed.forEach((point, index) => {
      const id = index + 1;
      cue
        .u32(id, true)
        .u32(index, true)
        .latin1('data')
        .u32(0, true)
        .u32(0, true)
        .u32(point.position, true);
      if (point.name !== '') {
        const text = encodeUtf8(point.name);
        const size = 4 + text.length + 1;
        labels.latin1('labl').u32(size, true).u32(id, true).bytes(text).u8(0);
        if (size % 2 === 1) labels.u8(0);
      }
    });
    chunks.push({ id: 'cue ', body: cue.toBytes().slice() });
    if (labels.length > 4) chunks.push({ id: 'LIST', body: labels.toBytes().slice() });
  }

  // A loop's name has no place in the chunk.
  const loopsPartial =
    writable.length < loops.length || loops.some((loop) => loop.name !== undefined);
  return { chunks, loopsPartial, cuesDropped: placed.length < cues.length, tuningDropped };
}

/** The cue points and their labels a file's chunks state, gathered until every chunk is read. */
export class RiffLoopChunkReading {
  private readonly positions = new Map<number, SampleCount>();
  private readonly labels = new Map<number, string>();

  /** Reads one chunk into `gathering`, or keeps its cues and labels for {@link finish}; other chunks are passed over. */
  read(chunk: RiffChunk, gathering: MetadataGathering): void {
    switch (chunk.id) {
      case 'smpl':
        this.readSampler(chunk.body, gathering);
        return;
      case 'cue ':
        this.readCues(chunk.body);
        return;
      case 'LIST':
        this.readLabels(chunk.body);
        return;
      default:
        return;
    }
  }

  /** Gives the cue points read, each named by its label, to `gathering`. */
  finish(gathering: MetadataGathering): void {
    const cues: CuePoint[] = [...this.positions].map(([id, position]) => ({
      position,
      name: this.labels.get(id) ?? '',
    }));
    if (cues.length > 0) gathering.setCues(cues.toSorted((a, b) => a.position - b.position));
  }

  private readSampler(body: Uint8Array, gathering: MetadataGathering): void {
    if (body.length < SMPL_FIXED_BYTES) return;
    const view = viewOf(body);
    const note = view.getUint32(12, true);
    const fraction = view.getUint32(16, true);
    if (note <= 127) {
      let cents = Math.round((fraction / FRACTION_UNITS) * 100 * 1_000) / 1_000;
      let unityNote = note;
      if (cents >= 50 && note < 127) {
        cents -= 100;
        unityNote += 1;
      }
      gathering.setTuning({ unityNote, fineTuneCents: cents });
    }
    const count = Math.min(
      view.getUint32(28, true),
      Math.floor((body.length - SMPL_FIXED_BYTES) / SMPL_LOOP_BYTES),
      MAXIMUM_METADATA_FIELDS,
    );
    const loops: MetadataLoop[] = [];
    for (let index = 0; index < count; index += 1) {
      const at = SMPL_FIXED_BYTES + index * SMPL_LOOP_BYTES;
      const direction = LOOP_TYPES[view.getUint32(at + 4, true)];
      const start = view.getUint32(at + 8, true);
      const end = view.getUint32(at + 12, true);
      const plays = view.getUint32(at + 20, true);
      const first = sampleCount(start);
      const length = sampleCount(end - start + 1);
      if (direction === undefined || end < start || !first.ok || !length.ok) continue;
      loops.push({
        start: first.value,
        length: length.value,
        playCount: plays === 0 ? 'endless' : plays,
        direction,
      });
    }
    if (loops.length > 0) gathering.setLoops(loops);
  }

  private readCues(body: Uint8Array): void {
    if (body.length < 4) return;
    const view = viewOf(body);
    const count = Math.min(
      view.getUint32(0, true),
      Math.floor((body.length - 4) / CUE_POINT_BYTES),
      MAXIMUM_METADATA_FIELDS,
    );
    for (let index = 0; index < count; index += 1) {
      const at = 4 + index * CUE_POINT_BYTES;
      const position = sampleCount(view.getUint32(at + 20, true));
      if (position.ok) this.positions.set(view.getUint32(at, true), position.value);
    }
  }

  private readLabels(body: Uint8Array): void {
    if (body.length < 4 || fourCharacterCode(body, 0) !== 'adtl') return;
    const view = viewOf(body);
    let read = 0;
    for (let at = 4; at + 8 <= body.length && read < MAXIMUM_METADATA_FIELDS; read += 1) {
      const size = view.getUint32(at + 4, true);
      const end = at + 8 + size;
      if (end > body.length) return;
      if (fourCharacterCode(body, at) === 'labl' && size >= 4) {
        const text = body.subarray(at + 12, end);
        const terminator = text.indexOf(0);
        this.labels.set(
          view.getUint32(at + 8, true),
          decodeUtf8(terminator < 0 ? text : text.subarray(0, terminator)),
        );
      }
      at = end + (size % 2);
    }
  }
}
