/**
 * The de-click's kernel: the analysis contract's click detector run over the
 * stream, the flagged samples gathered into spans, and each span short
 * enough to be a click repaired by `autoregressive.ts`, a fixed latency
 * after the input.
 *
 * Each frame is worked out in turn. Its finite sample is kept in the channel's
 * ring and in the chunk the detector is fed, and every `CHUNK_FRAMES` frames,
 * counted from the kernel's first, the chunk is pushed to the detector and
 * every event it has found is pulled. A detector block ends on a chunk's last
 * frame, so the frame its events arrive at, and the sensitivity they are judged
 * by there, are the same however the stream is cut. At the end of each block
 * every channel's flags, now known to that frame, are read in order: flags with
 * no more than `MERGE_GAP` unflagged frames between them are one click
 * (`joinsClick`), repaired with `SPAN_GUARD` frames either side, and a click is
 * decided once more unflagged frames follow it and the context after it has
 * arrived. A click no longer than the longest, its guards counted
 * (`repairsClick`), is replaced by its interpolation, its removed part kept for
 * the auditioning output; a longer one is a sound, and left. The click detector
 * reports by the same rules. Every frame is written to the output `latency`
 * frames after it arrived, by when any repair of it is made
 * (`click-geometry.ts` states why).
 */

import type { DomainResult } from '@audiogubbins/domain';
import {
  channelAt,
  portAt,
  unknownParameter,
  type AudioFrameBlock,
  type CanonicalDetectorFeatures,
  type NodeKernel,
} from '@audiogubbins/audio-engine';

import { finiteSample } from '../framework/sample-safety.js';
import type { RampedParameter } from '../filters/ramped-parameter.js';
import { GapInterpolator } from './autoregressive.js';
import {
  CHUNK_FRAMES,
  MODEL_ORDER,
  SPAN_GUARD,
  joinsClick,
  repairsClick,
  type ClickGeometry,
} from './click-geometry.js';

/** Records pulled from the detector at once; a block with more is pulled in turns. */
const RECORDS = 256;

/** The fields of a click record: `[channel, sample, e − m, MAD]`. */
const RECORD_WIDTH = 4;

/** One channel's ring, flags and the span being gathered. */
class ClickChannel {
  /** The finite input, repaired where a click was, by absolute frame modulo its length. */
  readonly ring: Float64Array;
  /** What a repair took from each frame: the auditioning output. */
  readonly removed: Float64Array;
  /** Whether the detector flagged each frame at the sensitivity it was judged by. */
  readonly flags: Uint8Array;
  /** The frames of the chunk the detector is fed next. */
  readonly chunk = new Float32Array(CHUNK_FRAMES);
  /** The next frame whose flag is read. */
  scanned = 0;
  /** The first and the last flagged frame of the span being gathered, −1 when none is. */
  first = -1;
  last = -1;

  constructor(ringFrames: number) {
    this.ring = new Float64Array(ringFrames);
    this.removed = new Float64Array(ringFrames);
    this.flags = new Uint8Array(ringFrames);
  }
}

/** What a de-click kernel is made of. */
export interface ClickParts {
  readonly type: string;
  readonly geometry: ClickGeometry;
  readonly detector: CanonicalDetectorFeatures;
  readonly sensitivity: RampedParameter;
  /** Whether it gives the removed clicks alone rather than the repaired audio. */
  readonly auditioning: boolean;
  readonly channels: number;
}

export class ClickKernel implements NodeKernel {
  readonly #parts: ClickParts;
  readonly #channels: readonly ClickChannel[];
  readonly #chunks: readonly Float32Array[];
  readonly #records = new Float64Array(RECORDS * RECORD_WIDTH);
  readonly #interpolator: GapInterpolator;
  readonly #ringFrames: number;
  /** The absolute frame worked out next, counted from the kernel's first. */
  #position = 0;

  constructor(parts: ClickParts) {
    this.#parts = parts;
    const { geometry } = parts;
    this.#ringFrames = geometry.ringFrames;
    this.#channels = Array.from(
      { length: parts.channels },
      () => new ClickChannel(geometry.ringFrames),
    );
    this.#chunks = this.#channels.map((channel) => channel.chunk);
    this.#interpolator = new GapInterpolator(MODEL_ORDER, geometry.context, geometry.longest);
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    const input = portAt(inputs, 0);
    const output = portAt(outputs, 0);
    this.#parts.sensitivity.fill(frames);
    for (let frame = 0; frame < frames; frame += 1) this.#frame(input, output, frame);
  }

  setParameter(name: string, value: number): DomainResult<void> {
    const { type, sensitivity } = this.#parts;
    return name === sensitivity.descriptor.key
      ? sensitivity.set(type, value)
      : unknownParameter(type, name);
  }

  release(): void {
    this.#parts.detector.release();
  }

  /** The ring index of absolute frame `frame`, which may be before the first. */
  #index(frame: number): number {
    const index = frame % this.#ringFrames;
    return index < 0 ? index + this.#ringFrames : index;
  }

  #frame(input: AudioFrameBlock, output: AudioFrameBlock, frame: number): void {
    const position = this.#position;
    const at = this.#index(position);
    const chunkAt = position % CHUNK_FRAMES;
    const channels = this.#channels;
    for (let channel = 0; channel < channels.length; channel += 1) {
      const state = channels[channel];
      if (state === undefined) continue;
      const sample = finiteSample(channelAt(input, channel)[frame] ?? 0);
      state.ring[at] = sample;
      state.removed[at] = 0;
      state.flags[at] = 0;
      state.chunk[chunkAt] = sample;
    }
    if (chunkAt === CHUNK_FRAMES - 1) {
      this.#detect(frame);
      if ((position + 1) % this.#parts.geometry.block === 0) {
        for (const state of channels) this.#scan(state, position);
      }
    }
    const out = this.#index(position - this.#parts.geometry.latency);
    const auditioning = this.#parts.auditioning;
    for (let channel = 0; channel < channels.length; channel += 1) {
      const state = channels[channel];
      if (state === undefined) continue;
      channelAt(output, channel)[frame] = auditioning
        ? (state.removed[out] ?? 0)
        : (state.ring[out] ?? 0);
    }
    this.#position = position + 1;
  }

  /** Feeds the chunk to the detector and flags each event at the sensitivity at `frame`. */
  #detect(frame: number): void {
    const { detector, sensitivity } = this.#parts;
    detector.push(this.#chunks);
    const multiple = sensitivity.values[frame] ?? 0;
    const records = this.#records;
    for (;;) {
      const count = detector.pull(records);
      for (let record = 0; record < count; record += 1) {
        const base = record * RECORD_WIDTH;
        const state = this.#channels[records[base] ?? 0];
        const deviation = records[base + 2] ?? 0;
        if (state !== undefined && Math.abs(deviation) > multiple * (records[base + 3] ?? 0)) {
          state.flags[this.#index(records[base + 1] ?? 0)] = 1;
        }
      }
      if (count < RECORDS) return;
    }
  }

  /** Reads `state`'s flags to `known`, deciding each span whose end and context have come. */
  #scan(state: ClickChannel, known: number): void {
    const context = this.#parts.geometry.context;
    while (state.scanned <= known) {
      const frame = state.scanned;
      if (state.first >= 0 && !joinsClick(state.last, frame)) {
        if (state.last + SPAN_GUARD + context > known) return;
        this.#repair(state, state.first, state.last);
        state.first = -1;
      }
      if (state.flags[this.#index(frame)] === 1) {
        if (state.first < 0) state.first = frame;
        state.last = frame;
      }
      state.scanned = frame + 1;
    }
  }

  /**
   * Replaces the click flagged from `flaggedFirst` to `flaggedLast`, its
   * guards with it, by its interpolation, where it is one it repairs.
   */
  #repair(state: ClickChannel, flaggedFirst: number, flaggedLast: number): void {
    if (!repairsClick(this.#parts.geometry, flaggedFirst, flaggedLast)) return;
    const first = flaggedFirst - SPAN_GUARD;
    const last = flaggedLast + SPAN_GUARD;
    const gap = last - first + 1;
    const interpolator = this.#interpolator;
    const { context, surround, solution, order, contextLength } = interpolator;
    const ring = state.ring;
    for (let offset = 0; offset < contextLength; offset += 1) {
      context[offset] = ring[this.#index(first - contextLength + offset)] ?? 0;
      context[contextLength + offset] = ring[this.#index(last + 1 + offset)] ?? 0;
    }
    interpolator.fit();
    for (let offset = 0; offset < gap + 2 * order; offset += 1) {
      surround[offset] = ring[this.#index(first - order + offset)] ?? 0;
    }
    if (!interpolator.interpolate(gap)) return;
    for (let offset = 0; offset < gap; offset += 1) {
      const index = this.#index(first + offset);
      const repaired = solution[offset] ?? 0;
      state.removed[index] = (ring[index] ?? 0) - repaired;
      ring[index] = repaired;
    }
  }
}
