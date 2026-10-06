/**
 * DeepFilterNet 3 at work over one stream at 48 kHz: each channel analysed,
 * its features made, the graphs run in fixed runs, its spectrum enhanced and
 * synthesised, every channel on its own and in step with the others.
 *
 * As DeepFilterNet's own offline pipeline does (`enhance` of
 * `df/enhance.py`), the stream is followed by one frame of silence, so its
 * last samples reach the synthesis, and the synthesis's delay of one hop is
 * taken off its start, so the output lines up with the input sample for
 * sample and is exactly as long.
 *
 * The runs (`chunk-schedule.ts`) are 1 000 frames, ten seconds, each heard
 * after a warm-up of 400 frames, four seconds. The model's convolutions see
 * six frames back, but its recurrent layers carry state for as long as a
 * stream runs, so no warm-up makes a run's output that of one run over the
 * whole stream; what a warm-up must do is let a run that starts afresh, as
 * the model was trained to start, settle. Measured over speech-like signals
 * in noise against a single run (the reference check of this processor's
 * first version), runs of 1 000 frames after 400 matched its quality against
 * the clean signal, about 31 dB from it, while a warm-up of 200 gave 29 dB
 * and 800 gave 35 dB at twice the cost; four seconds is also four of the
 * running normalisation's time constants, so a run's features have come
 * within 2 % of where a stream begun earlier would have them. The cut
 * between runs is smoothed by the synthesis's overlapping windows.
 *
 * Only the spectra a run and the deep filter still need are kept: from the
 * next run's first frame on.
 */

import { succeed, type CancellationSignal, type DomainResult } from '@audiogubbins/domain';

import { scheduledRun, type ChunkSchedule } from '../chunk-schedule.js';
import type { ModelSessions } from '../model-sessions.js';
import type { ModelOutput, ModelStream } from '../model-pass.js';
import {
  DEEP_FILTER_ORDER,
  DEEP_FILTER_BINS,
  ERB_BANDS,
  FEATURE_LOOKAHEAD,
  FRAME,
  HOP,
} from './deepfilternet-model.js';
import { enhanceFrame, type Finishing } from './enhancement.js';
import { FeatureRun } from './features.js';
import { runGraphs } from './graphs.js';
import { LibDfStft, StftTransform, emptySpectrum, type Spectrum } from './libdf-stft.js';
import type { CanonicalDsp } from '@audiogubbins/audio-engine';

/** The runs the graphs are run in, in frames. */
const DEEPFILTERNET_SCHEDULE: ChunkSchedule = { chunk: 1_000, warmUp: 400 };

/** The spectra of one channel from frame `base` on, their arrays reused as frames are let go. */
class SpectrumStore {
  #base = 0;
  readonly #held: Spectrum[] = [];
  readonly #spare: Spectrum[] = [];

  /** The spectrum of a new frame, after the last, to be written. */
  next(): Spectrum {
    const spectrum = this.#spare.pop() ?? emptySpectrum();
    this.#held.push(spectrum);
    return spectrum;
  }

  /** Frame `frame`'s spectrum, or nothing where it is not held. */
  at(frame: number): Spectrum | undefined {
    return frame < this.#base ? undefined : this.#held[frame - this.#base];
  }

  /** Lets go of every frame before `frame`. */
  forgetBefore(frame: number): void {
    const count = Math.max(0, Math.min(frame - this.#base, this.#held.length));
    this.#spare.push(...this.#held.splice(0, count));
    this.#base += count;
  }
}

/** One channel's analysis, its spectra and the hop it is filling. */
class ChannelState {
  readonly stft: LibDfStft;
  readonly spectra = new SpectrumStore();
  readonly hop = new Float64Array(HOP);

  constructor(transform: StftTransform) {
    this.stft = new LibDfStft(transform);
  }
}

export class DeepFilterNetStream implements ModelStream {
  readonly #sessions: ModelSessions;
  readonly #emit: ModelOutput;
  readonly #finishing: Finishing;
  readonly #transform: StftTransform;
  readonly #channels: readonly ChannelState[];
  readonly #features = new FeatureRun();
  readonly #enhanced = emptySpectrum();
  readonly #hopOut = new Float64Array(HOP);
  /** Each channel's output of one run, at most a chunk of hops. */
  readonly #output: readonly Float32Array[];
  /** The samples filled of the hop being filled, the same in every channel. */
  #filled = 0;
  /** The frames analysed, the same in every channel. */
  #frames = 0;
  /** The samples heard. */
  #heard = 0;
  /** The samples synthesised, the hop of delay at the start among them. */
  #synthesised = 0;
  /** The output samples given back. */
  #given = 0;
  #run = 0;

  constructor(
    sessions: ModelSessions,
    channels: number,
    dsp: CanonicalDsp,
    finishing: Finishing,
    emit: ModelOutput,
  ) {
    this.#sessions = sessions;
    this.#emit = emit;
    this.#finishing = finishing;
    this.#transform = new StftTransform(dsp);
    this.#channels = Array.from({ length: channels }, () => new ChannelState(this.#transform));
    this.#output = Array.from(
      { length: channels },
      () => new Float32Array(DEEPFILTERNET_SCHEDULE.chunk * HOP),
    );
  }

  async hear(
    input: readonly Float32Array[],
    frames: number,
    signal: CancellationSignal | undefined,
  ): Promise<DomainResult<void>> {
    this.#heard += frames;
    return await this.#analyse(input, frames, signal);
  }

  async end(signal: CancellationSignal | undefined): Promise<DomainResult<void>> {
    // One frame of silence after the stream, as DeepFilterNet's pipeline
    // pads it; a hop it leaves part filled is never analysed.
    const silence = this.#channels.map(() => new Float32Array(FRAME));
    const padded = await this.#analyse(silence, FRAME, signal);
    if (!padded.ok) return padded;
    while (scheduledRun(DEEPFILTERNET_SCHEDULE, this.#run).kept < this.#frames) {
      const ran = await this.#runNext(signal);
      if (!ran.ok) return ran;
    }
    return succeed(undefined);
  }

  release(): void {
    this.#transform.release();
  }

  /** Analyses each completed hop of `input`, running the graphs whenever a run is ready. */
  async #analyse(
    input: readonly Float32Array[],
    frames: number,
    signal: CancellationSignal | undefined,
  ): Promise<DomainResult<void>> {
    for (let start = 0; start < frames;) {
      const length = Math.min(HOP - this.#filled, frames - start);
      for (const [index, channel] of this.#channels.entries()) {
        const from = input[index];
        for (let sample = 0; sample < length; sample += 1) {
          channel.hop[this.#filled + sample] = from?.[start + sample] ?? 0;
        }
      }
      start += length;
      this.#filled += length;
      if (this.#filled < HOP) continue;
      this.#filled = 0;
      for (const channel of this.#channels)
        channel.stft.analyse(channel.hop, channel.spectra.next());
      this.#frames += 1;
      const next = scheduledRun(DEEPFILTERNET_SCHEDULE, this.#run);
      if (this.#frames >= next.first + next.length + FEATURE_LOOKAHEAD) {
        const ran = await this.#runNext(signal);
        if (!ran.ok) return ran;
      }
    }
    return succeed(undefined);
  }

  /** Runs the graphs over the next run, enhancing and synthesising the frames it keeps. */
  async #runNext(signal: CancellationSignal | undefined): Promise<DomainResult<void>> {
    const run = scheduledRun(DEEPFILTERNET_SCHEDULE, this.#run);
    const end = Math.min(run.kept + DEEPFILTERNET_SCHEDULE.chunk, this.#frames);
    for (const [index, channel] of this.#channels.entries()) {
      const spectrumAt = (frame: number): Spectrum | undefined =>
        frame < this.#frames ? channel.spectra.at(frame) : undefined;
      const inputs = this.#features.inputs(spectrumAt, run.first, run.length);
      const outputs = await runGraphs(this.#sessions, inputs, run.length, signal);
      if (!outputs.ok) return outputs;
      const into = this.#output[index];
      if (into === undefined) continue;
      for (let frame = run.kept; frame < end; frame += 1) {
        const at = frame - run.first;
        enhanceFrame(
          (offset) => spectrumAt(frame + offset),
          outputs.value.gains,
          at * ERB_BANDS,
          outputs.value.taps,
          at * DEEP_FILTER_BINS * DEEP_FILTER_ORDER * 2,
          this.#finishing,
          this.#enhanced,
        );
        channel.stft.synthesise(this.#enhanced, this.#hopOut);
        const hop = (frame - run.kept) * HOP;
        for (let sample = 0; sample < HOP; sample += 1) {
          into[hop + sample] = this.#hopOut[sample] ?? 0;
        }
      }
    }
    this.#run += 1;
    const forget = scheduledRun(DEEPFILTERNET_SCHEDULE, this.#run).first;
    for (const channel of this.#channels) channel.spectra.forgetBefore(forget);
    await this.#give((end - run.kept) * HOP);
    return succeed(undefined);
  }

  /**
   * Gives back the `samples` samples of each channel's output just made,
   * less the hop of delay at the stream's start and no more than the stream
   * heard, so the output is as long as the input.
   */
  async #give(samples: number): Promise<void> {
    const skip = Math.min(samples, Math.max(0, HOP - this.#synthesised));
    this.#synthesised += samples;
    const count = Math.max(0, Math.min(samples - skip, this.#heard - this.#given));
    if (count === 0) return;
    await this.#emit(
      this.#output.map((channel) => channel.subarray(skip, skip + count)),
      count,
    );
    this.#given += count;
  }
}
