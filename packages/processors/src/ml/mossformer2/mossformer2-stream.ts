/**
 * MossFormer2 SE 48K at work over one stream at 48 kHz: the stream gathered
 * into segments ({@link MOSSFORMER2_SCHEDULE}), each channel of a segment
 * given its features (`features.ts`), run through the graph (`graph.ts`),
 * masked and made again (`masked-stft.ts`), and the part of it the segment
 * keeps given back, every channel on its own and in step with the others.
 *
 * Each sample of a segment's output stands where its input did, so the
 * output lines up with the input sample for sample with no delay to undo,
 * and the last segment's output is cut where the stream ends, so it is
 * exactly as long.
 */

import { succeed, type CancellationSignal, type DomainResult } from '@audiogubbins/domain';
import type { CanonicalDsp } from '@audiogubbins/audio-engine';

import type { ChunkSchedule, ScheduledRun } from '../chunk-schedule.js';
import type { ModelOutput, ModelStream } from '../model-pass.js';
import type { ModelSessions } from '../model-sessions.js';
import { ScheduledInput } from '../scheduled-input.js';
import { FeatureMaker } from './features.js';
import { runGraph } from './graph.js';
import { MaskedStft } from './masked-stft.js';
import { framesOf } from './mossformer2-model.js';

/**
 * How MossFormer2 SE 48K hears a stream of any length, in samples: in
 * segments of four seconds, one every three, each of whose output only the
 * middle is kept, as ClearerVoice-Studio's decode runs a long input
 * (`decode_one_audio_mossformer2_se_48k` of `clearvoice/utils/decode.py` at
 * commit 6b3774dc, Apache License 2.0, by Shengkui Zhao, Zexu Pan and
 * ClearerVoice-Studio's contributors, with `decode_window` of 4 s).
 *
 * Segment `k` hears the stream's 192 000 samples from `144 000·k`, silence
 * past its end. The network attends over the whole segment, so a sample's
 * output depends on what lies on both sides of it, and the 24 000 samples,
 * half a second, at each edge of a segment are dropped: segment `k` keeps its
 * output from `144 000·k + 24 000` to `144 000·k + 168 000`, and the first,
 * which nothing precedes, keeps its output from the stream's start. The kept
 * outputs meet end to end, cut, with nothing blended.
 *
 * The decode runs an input of twenty seconds or less in one segment of its
 * own length, so a render there would depend on the stream's length; these
 * segments are the same for every stream, which is a constant of this
 * processor's implementation, so a render of a stream and of a longer one
 * agree over what they share.
 */
export const MOSSFORMER2_SCHEDULE: ChunkSchedule = {
  chunk: 144_000,
  before: 24_000,
  after: 24_000,
  firstChunk: 168_000,
};

/** The samples a segment hears: four seconds at 48 kHz. */
const SEGMENT_SAMPLES =
  MOSSFORMER2_SCHEDULE.before + MOSSFORMER2_SCHEDULE.chunk + MOSSFORMER2_SCHEDULE.after;

export class MossFormer2Stream implements ModelStream {
  readonly #sessions: ModelSessions;
  readonly #emit: ModelOutput;
  readonly #features: FeatureMaker;
  readonly #stft: MaskedStft;
  readonly #input: ScheduledInput;
  /** A channel's segment made again, before the part kept is taken. */
  readonly #made = new Float64Array(SEGMENT_SAMPLES);
  /** Each channel's output kept from one segment: at most the first segment's. */
  readonly #kept: readonly Float32Array[];

  constructor(sessions: ModelSessions, channels: number, dsp: CanonicalDsp, emit: ModelOutput) {
    this.#sessions = sessions;
    this.#emit = emit;
    this.#features = new FeatureMaker(dsp, SEGMENT_SAMPLES);
    this.#stft = new MaskedStft(dsp, SEGMENT_SAMPLES);
    this.#input = new ScheduledInput(MOSSFORMER2_SCHEDULE, channels);
    this.#kept = Array.from(
      { length: channels },
      () => new Float32Array(MOSSFORMER2_SCHEDULE.firstChunk),
    );
  }

  async hear(
    input: readonly Float32Array[],
    frames: number,
    signal: CancellationSignal | undefined,
  ): Promise<DomainResult<void>> {
    return await this.#input.hear(input, frames, (run, segments) =>
      this.#runSegment(run, segments, signal),
    );
  }

  async end(signal: CancellationSignal | undefined): Promise<DomainResult<void>> {
    return await this.#input.end((run, segments) => this.#runSegment(run, segments, signal));
  }

  release(): void {
    this.#features.release();
    this.#stft.release();
  }

  /** Runs segment `run` over each channel's samples, `segments`, giving back what it keeps. */
  async #runSegment(
    run: ScheduledRun,
    segments: readonly Float32Array[],
    signal: CancellationSignal | undefined,
  ): Promise<DomainResult<void>> {
    const frames = framesOf(SEGMENT_SAMPLES);
    const { from, count } = this.#input.part(run);
    for (const [index, samples] of segments.entries()) {
      const mask = await runGraph(this.#sessions, this.#features.features(samples), frames, signal);
      if (!mask.ok) return mask;
      this.#stft.masked(samples, mask.value, this.#made);
      const kept = this.#kept[index];
      if (kept === undefined) continue;
      for (let sample = 0; sample < count; sample += 1) {
        kept[sample] = this.#made[from + sample] ?? 0;
      }
    }
    await this.#emit(
      this.#kept.map((channel) => channel.subarray(0, count)),
      count,
    );
    return succeed(undefined);
  }
}
