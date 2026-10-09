/**
 * One pass of a canonical detector over audio: the input read through
 * `finiteSample` and handed to the detector's feature extractor a chunk at a
 * time, and the extractor's records pulled into one preallocated array as
 * they come and read by the detector's judge, so nothing a pass holds grows
 * with the stream but the judge's findings.
 *
 * An extractor reads whole frames, so the last samples of a stream are heard
 * only once more follow them. What follows them is the detector's to choose
 * (`Tail`): silence, which adds no run at a block's largest magnitude; the
 * audio mirrored about its last sample, which goes on as the audio went, for
 * a block's median absolute deviation that silence would shrink; or nothing,
 * for a detector whose frames a step to silence would mislead, or whose
 * statistic over whole frames does not need the last part of one. A judge
 * ignores what it finds past the frames heard.
 */

import {
  derivedSampleCount,
  mapResult,
  succeed,
  throwIfCancelled,
  type CancellationSignal,
  type DetectorFinding,
  type DomainResult,
  type EditRange,
} from '@audiogubbins/domain';
import type {
  CanonicalDetectorFeatures,
  CanonicalDsp,
  DetectorSettings,
} from '@audiogubbins/audio-engine';

import { finiteSample } from '../framework/sample-safety.js';
import type { Detection } from './audio-detector.js';

/** The frames of input handed to an extractor at a time. */
const FEED_FRAMES = 4_096;

/** The records pulled from an extractor at a time. */
const RECORDS_AT_ONCE = 64;

/** What a detector makes of its extractor's records. */
export interface RecordJudge {
  /** Reads the first `count` records of `records`, each the extractor's record width. */
  read(records: Float64Array, count: number): void;
  /** The findings over `frames` frames heard, every record read. */
  findings(frames: number): readonly DetectorFinding[];
}

/**
 * What a pass pushes after the audio, so the extractor reads its last block:
 * nothing, or as many frames of silence or of the audio mirrored as complete
 * the last of the extractor's blocks of `block` frames.
 */
export type Tail =
  { readonly kind: 'none' } | { readonly kind: 'silence' | 'mirror'; readonly block: number };

/**
 * The frame of a stream of `heard` frames that frame `index` past its end
 * mirrors: the stream reflected about its last sample, and about its first
 * where it is shorter than the reflection.
 */
function mirrored(index: number, heard: number): number {
  if (heard === 1) return 0;
  const period = 2 * (heard - 1);
  const folded = index % period;
  return folded < heard ? folded : period - folded;
}

/** A detection on a canonical feature extractor, its findings its judge's. */
class FeaturePass implements Detection {
  readonly #features: CanonicalDetectorFeatures;
  readonly #judge: RecordJudge;
  readonly #tail: Tail;
  readonly #chunk: readonly Float32Array[];
  readonly #records: Float64Array;
  /** Per channel, the last `block` frames heard, a ring, for a mirrored tail. */
  readonly #recent: readonly Float32Array[];
  #heard = 0;
  #findings: readonly DetectorFinding[] | undefined;
  #released = false;

  constructor(features: CanonicalDetectorFeatures, judge: RecordJudge, tail: Tail) {
    this.#features = features;
    this.#judge = judge;
    this.#tail = tail;
    const channels = features.channels;
    this.#chunk = Array.from({ length: channels }, () => new Float32Array(FEED_FRAMES));
    this.#records = new Float64Array(RECORDS_AT_ONCE * features.recordWidth);
    const ring = tail.kind === 'mirror' ? tail.block : 0;
    this.#recent = Array.from({ length: channels }, () => new Float32Array(ring));
  }

  // An extractor works synchronously, so a chunk is heard as it is given and
  // the pass is never held back; the promise's executor turns a misuse or a
  // cancellation into its rejection.
  add(input: readonly Float32Array[], frames: number, signal?: CancellationSignal): Promise<void> {
    return new Promise((resolve) => {
      if (this.#findings !== undefined) {
        throw new Error('A finished detection was given more audio.');
      }
      if (this.#released) throw new Error('A released detection was given more audio.');
      throwIfCancelled(signal);
      this.#hear(input, frames);
      resolve();
    });
  }

  result(signal?: CancellationSignal): Promise<DomainResult<readonly DetectorFinding[]>> {
    return new Promise((resolve) => {
      if (this.#findings === undefined && this.#released) {
        throw new Error('A released detection was asked for its findings.');
      }
      throwIfCancelled(signal);
      if (this.#findings === undefined) {
        this.#pushTail();
        this.#findings = this.#judge.findings(this.#heard);
      }
      resolve(succeed(this.#findings));
    });
  }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    this.#features.release();
  }

  /** Hands the first `frames` frames of `input` to the extractor, made finite. */
  #hear(input: readonly Float32Array[], frames: number): void {
    for (let start = 0; start < frames; start += FEED_FRAMES) {
      const length = Math.min(FEED_FRAMES, frames - start);
      for (let channel = 0; channel < this.#chunk.length; channel += 1) {
        const from = input[channel];
        const into = this.#chunk[channel];
        const ring = this.#recent[channel];
        if (into === undefined || ring === undefined) continue;
        for (let frame = 0; frame < length; frame += 1) {
          const sample = finiteSample(from?.[start + frame] ?? 0);
          into[frame] = sample;
          if (ring.length > 0) ring[(this.#heard + frame) % ring.length] = sample;
        }
      }
      this.#push(length);
      this.#heard += length;
    }
  }

  /** Hands the first `length` frames of the chunk to the extractor, and reads what it made. */
  #push(length: number): void {
    // An extractor takes whole arrays, so a short chunk is a view of the
    // start of each; a detection is not on the audio thread.
    this.#features.push(
      length === FEED_FRAMES
        ? this.#chunk
        : this.#chunk.map((channel) => channel.subarray(0, length)),
    );
    for (
      let count = this.#features.pull(this.#records);
      count > 0;
      count = this.#features.pull(this.#records)
    ) {
      this.#judge.read(this.#records, count);
    }
  }

  /** Pushes the frames the tail asks for after the audio. */
  #pushTail(): void {
    const tail = this.#tail;
    if (tail.kind === 'none' || this.#heard === 0) return;
    const frames = (tail.block - (this.#heard % tail.block)) % tail.block;
    for (let start = 0; start < frames; start += FEED_FRAMES) {
      const length = Math.min(FEED_FRAMES, frames - start);
      for (let channel = 0; channel < this.#chunk.length; channel += 1) {
        const into = this.#chunk[channel];
        const ring = this.#recent[channel];
        if (into === undefined || ring === undefined) continue;
        for (let frame = 0; frame < length; frame += 1) {
          into[frame] =
            tail.kind === 'silence' ? 0 : this.#mirroredSample(ring, this.#heard + start + frame);
        }
      }
      this.#push(length);
    }
  }

  /** The sample of `ring` that frame `index`, past the end of the audio, mirrors. */
  #mirroredSample(ring: Float32Array, index: number): number {
    const heard = this.#heard;
    // Reflected about the last sample, frame `heard + k` is frame
    // `heard − 2 − k`, within one block of the end, so the ring holds it.
    const back = index - (heard - 1);
    const frame = heard - 1 - mirrored(back, heard);
    return ring[frame % ring.length] ?? 0;
  }
}

/** The frames from `start` to `end`, of audio of `frames` frames, as a finding's range. */
export function findingRange(start: number, end: number, frames: number): EditRange {
  return {
    start: derivedSampleCount(Math.min(start, frames)),
    end: derivedSampleCount(Math.min(end, frames)),
  };
}

/**
 * A pass of the extractor `settings` describe, its records read by the judge
 * `judgeOf` makes for it and the audio followed by `tail`, or why the
 * extractor cannot hear audio of that shape and rate.
 */
export function openPass(
  dsp: CanonicalDsp,
  settings: DetectorSettings,
  judgeOf: (features: CanonicalDetectorFeatures) => RecordJudge,
  tail: Tail,
): DomainResult<Detection> {
  return mapResult(
    dsp.createDetectorFeatures(settings),
    (features): Detection => new FeaturePass(features, judgeOf(features), tail),
  );
}
