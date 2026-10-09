/**
 * Spleeter at work over one stream at 44.1 kHz: both channels analysed in
 * segments of 512 frames, each segment's magnitudes run through the graph,
 * the chosen stem's ratio mask laid on the mixed spectrum and synthesised.
 *
 * As Spleeter's own pipeline does from its version 1.5.4 on, the stream is
 * preceded by one frame of silence, so its first samples lie under as many
 * frames as every other sample and are not faded in by the window, and that
 * frame is taken off the output again; the frames run on, as TensorFlow's
 * `pad_end` runs them, until the last one that starts within the stream, so
 * its last samples are whole too. The output lines up with the input sample
 * for sample and is exactly as long.
 *
 * The segments are Spleeter's own: 512 frames, about 11.9 seconds, counted
 * from the first frame and butted end to end, each heard by the graph alone
 * with nothing of its neighbours, as the model was trained and is run. A
 * segment the stream ends inside hears silence after it, as Spleeter's
 * `pad_and_partition` gives it. So the segments are constants of this
 * implementation, never of the stream's length, and the overlapping windows
 * of the synthesis smooth the cut between two segments' masks.
 *
 * The model hears stereo. A mono stream is heard as both channels of a
 * stereo one, a source in the centre, and its output is the mean of the two
 * channels the model gives back: the model's stereo answer folded to mono as
 * a mono source would be, neither channel favoured, rather than one channel
 * of it.
 *
 * Only the segment being run is kept: its input, from the first sample of
 * its first frame to the last of its last, and its output, from the first
 * sample it is the first to reach to the last its frames reach.
 */

import { succeed, type CancellationSignal, type DomainResult } from '@audiogubbins/domain';
import type { CanonicalDsp } from '@audiogubbins/audio-engine';

import type { ModelOutput, ModelStream } from '../model-pass.js';
import type { ChunkSchedule, ScheduledRun } from '../chunk-schedule.js';
import type { ModelSessions } from '../model-sessions.js';
import { ScheduledInput } from '../scheduled-input.js';
import { emptySpectrum, type Spectrum } from '../spectrum.js';
import { SEGMENT_VALUES, estimateStems } from './graph.js';
import { applyRatioMask } from './ratio-mask.js';
import {
  BINS,
  FRAME,
  HOP,
  MODEL_BINS,
  MODEL_CHANNELS,
  SEGMENT_FRAMES,
  SYNTHESIS_SCALE,
  type SpleeterModel,
} from './spleeter-model.js';
import { SpleeterStft } from './spleeter-stft.js';

/** The samples a segment's frames start in, one hop each: the samples it finishes. */
const SEGMENT_HOPS = SEGMENT_FRAMES * HOP;

/** The samples a frame reaches past the next frame's start, which two segments share. */
const OVERLAP = FRAME - HOP;

/** The silence before the stream: one frame. */
const LEAD = FRAME;

/**
 * The segments in samples, from the first of the silence before the stream:
 * each finishes the samples its frames start in, and hears the overlap past
 * them its last frame reaches, with nothing before them.
 */
const SPLEETER_SCHEDULE: ChunkSchedule = {
  chunk: SEGMENT_HOPS,
  before: 0,
  after: OVERLAP,
  firstChunk: SEGMENT_HOPS,
};

/** The samples a segment's frames reach, from its first frame's first sample. */
const SEGMENT_SPAN = SEGMENT_HOPS + OVERLAP;

export class SpleeterStream implements ModelStream {
  readonly #sessions: ModelSessions;
  readonly #model: SpleeterModel;
  readonly #stem: number;
  readonly #emit: ModelOutput;
  readonly #stft: SpleeterStft;
  /** Each of the stream's channels, one for mono, two for stereo, gathered into segments. */
  readonly #input: ScheduledInput;
  /** The two channels' synthesis from the current segment's first sample, unscaled. */
  readonly #synthesis: readonly [Float64Array, Float64Array] = [
    new Float64Array(SEGMENT_SPAN),
    new Float64Array(SEGMENT_SPAN),
  ];
  /** Each of the stream's channels of one segment's finished output. */
  readonly #output: readonly [Float32Array, ...Float32Array[]];
  readonly #spectrum: Spectrum = emptySpectrum(BINS);

  constructor(
    sessions: ModelSessions,
    model: SpleeterModel,
    stem: number,
    channels: number,
    dsp: CanonicalDsp,
    emit: ModelOutput,
  ) {
    this.#sessions = sessions;
    this.#model = model;
    this.#stem = stem;
    this.#emit = emit;
    this.#stft = new SpleeterStft(dsp);
    this.#input = new ScheduledInput(SPLEETER_SCHEDULE, channels, LEAD);
    this.#output = [
      new Float32Array(SEGMENT_HOPS),
      ...Array.from({ length: channels - 1 }, () => new Float32Array(SEGMENT_HOPS)),
    ];
  }

  async hear(
    input: readonly Float32Array[],
    frames: number,
    signal: CancellationSignal | undefined,
  ): Promise<DomainResult<void>> {
    return await this.#input.hear(input, frames, (run, channels) =>
      this.#runSegment(run, channels, signal),
    );
  }

  async end(signal: CancellationSignal | undefined): Promise<DomainResult<void>> {
    // The segments still owed output hear silence past the stream's end; a
    // segment is owed while a sample of the stream lies in what it finishes.
    return await this.#input.end((run, channels) => this.#runSegment(run, channels, signal));
  }

  release(): void {
    this.#stft.release();
  }

  /**
   * Runs the segment `run` over the stream's channels of it, `channels`,
   * gives back what it finishes and keeps what the next shares with it.
   */
  async #runSegment(
    run: ScheduledRun,
    channels: readonly Float32Array[],
    signal: CancellationSignal | undefined,
  ): Promise<DomainResult<void>> {
    const magnitudes = new Float32Array(SEGMENT_VALUES);
    for (let channel = 0; channel < MODEL_CHANNELS; channel += 1) {
      const samples = heardAs(channels, channel);
      for (let frame = 0; frame < SEGMENT_FRAMES; frame += 1) {
        this.#stft.analyse(samples, frame * HOP, this.#spectrum);
        const at = (channel * SEGMENT_FRAMES + frame) * MODEL_BINS;
        const { real, imaginary } = this.#spectrum;
        for (let bin = 0; bin < MODEL_BINS; bin += 1) {
          const a = real[bin] ?? 0;
          const b = imaginary[bin] ?? 0;
          magnitudes[at + bin] = Math.sqrt(a * a + b * b);
        }
      }
    }
    const estimates = await estimateStems(this.#sessions, this.#model, magnitudes, signal);
    if (!estimates.ok) return estimates;
    for (const [channel, synthesis] of this.#synthesis.entries()) {
      const samples = heardAs(channels, channel);
      for (let frame = 0; frame < SEGMENT_FRAMES; frame += 1) {
        // The spectrum is made again rather than kept from the analysis: two
        // channels of 512 spectra would hold 34 MB through the graph's run.
        this.#stft.analyse(samples, frame * HOP, this.#spectrum);
        const at = (channel * SEGMENT_FRAMES + frame) * MODEL_BINS;
        applyRatioMask(estimates.value, at, this.#stem, this.#spectrum);
        this.#stft.synthesise(this.#spectrum, synthesis, frame * HOP);
      }
    }
    await this.#give(run);
    this.#advance();
    return succeed(undefined);
  }

  /**
   * Gives back the samples `run` finishes, which no later frame reaches,
   * scaled: less the silence before the stream, and no more than the stream
   * heard, so the output is as long as the input.
   */
  async #give(run: ScheduledRun): Promise<void> {
    const { from, count } = this.#input.part(run);
    if (count <= 0) return;
    const [left, right] = this.#synthesis;
    const [first, second] = this.#output;
    if (second === undefined) {
      for (let sample = 0; sample < count; sample += 1) {
        const at = from + sample;
        first[sample] =
          ((left[at] ?? 0) * SYNTHESIS_SCALE + (right[at] ?? 0) * SYNTHESIS_SCALE) / 2;
      }
    } else {
      for (let sample = 0; sample < count; sample += 1) {
        first[sample] = (left[from + sample] ?? 0) * SYNTHESIS_SCALE;
        second[sample] = (right[from + sample] ?? 0) * SYNTHESIS_SCALE;
      }
    }
    await this.#emit(this.#output, count);
  }

  /** Keeps the synthesis the next segment shares with this one and clears the rest. */
  #advance(): void {
    for (const synthesis of this.#synthesis) {
      synthesis.copyWithin(0, SEGMENT_HOPS, SEGMENT_SPAN);
      synthesis.fill(0, OVERLAP);
    }
  }
}

/** The stream's channel the model hears as its channel `channel`: mono's one for both. */
function heardAs(channels: readonly Float32Array[], channel: number): Float32Array {
  const samples = channels[Math.min(channel, channels.length - 1)];
  // Made one or two in the constructor, from a layout the descriptor took.
  if (samples === undefined) throw new Error('A Spleeter stream hears one channel or two.');
  return samples;
}
