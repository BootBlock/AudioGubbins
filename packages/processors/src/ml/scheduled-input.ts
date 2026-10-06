/**
 * A stream's samples gathered into the runs of a chunk schedule
 * (`chunk-schedule.ts`), for a model that hears samples: each channel's
 * samples of the next run, from its first, held until the run is whole,
 * then handed to the stream to run, and what the run after shares with it
 * kept.
 *
 * The stream may be preceded by `lead` samples of silence, which the model
 * hears as the stream's start, as a pipeline that pads its input does; the
 * schedule counts from the first of them. A run is run as soon as the
 * stream reaches its end, or at the stream's end with silence after the
 * stream, and only while it keeps a sample of the stream: the runs a stream
 * is heard by are the same whatever chunks it is given in, and none more
 * than its length needs.
 */

import { succeed, type DomainResult } from '@audiogubbins/domain';

import { scheduledRun, type ChunkSchedule, type ScheduledRun } from './chunk-schedule.js';

/** Runs `run` over each channel's samples of it, from the run's first. */
export type RunOver = (
  run: ScheduledRun,
  channels: readonly Float32Array[],
) => Promise<DomainResult<void>>;

/** The part of a run's kept samples that lies in the stream. */
export interface StreamPart {
  /** Where the part starts, in samples from the run's first. */
  readonly from: number;
  /** The samples of the stream it keeps, which may be none. */
  readonly count: number;
}

export class ScheduledInput {
  readonly #schedule: ChunkSchedule;
  readonly #lead: number;
  /** The samples every run hears. */
  readonly #span: number;
  /** Each channel's samples of the next run, from its first. */
  readonly #channels: readonly Float32Array[];
  /** The samples of the next run gathered, the same in every channel. */
  #gathered: number;
  /** The samples of the stream heard. */
  #heard = 0;
  /** The next run's index. */
  #next = 0;

  /** Gathers `channels` channels for `schedule`'s runs, after `lead` samples of silence. */
  constructor(schedule: ChunkSchedule, channels: number, lead = 0) {
    this.#schedule = schedule;
    this.#lead = lead;
    this.#span = scheduledRun(schedule, 0).length;
    this.#channels = Array.from({ length: channels }, () => new Float32Array(this.#span));
    this.#gathered = lead;
  }

  /**
   * Gathers the `frames` samples of each channel of `input`, a channel it
   * lacks heard as silence, giving each run to `run` once it is whole.
   */
  async hear(
    input: readonly Float32Array[],
    frames: number,
    run: RunOver,
  ): Promise<DomainResult<void>> {
    this.#heard += frames;
    const span = this.#span;
    for (let start = 0; start < frames;) {
      const length = Math.min(span - this.#gathered, frames - start);
      for (const [index, into] of this.#channels.entries()) {
        const from = input[index];
        if (from !== undefined) into.set(from.subarray(start, start + length), this.#gathered);
      }
      start += length;
      this.#gathered += length;
      if (this.#gathered < span) continue;
      const ran = await this.#runNext(run);
      if (!ran.ok) return ran;
    }
    return succeed(undefined);
  }

  /** Gives `run` each run still owed a sample of the stream, silence past its end. */
  async end(run: RunOver): Promise<DomainResult<void>> {
    while (this.part(scheduledRun(this.#schedule, this.#next)).count > 0) {
      for (const channel of this.#channels) channel.fill(0, this.#gathered);
      const ran = await this.#runNext(run);
      if (!ran.ok) return ran;
    }
    return succeed(undefined);
  }

  /**
   * The part of `run`'s kept samples that lies in the stream heard so far:
   * none of the silence before it, and nothing past its last sample.
   */
  part(run: ScheduledRun): StreamPart {
    const start = Math.max(run.kept, this.#lead);
    const end = Math.min(run.kept + run.keeps, this.#lead + this.#heard);
    return { from: start - run.first, count: Math.max(0, end - start) };
  }

  /** Gives `run` the next run, whose samples are gathered, and keeps what the one after shares. */
  async #runNext(run: RunOver): Promise<DomainResult<void>> {
    const current = scheduledRun(this.#schedule, this.#next);
    const ran = await run(current, this.#channels);
    if (!ran.ok) return ran;
    this.#next += 1;
    const advance = scheduledRun(this.#schedule, this.#next).first - current.first;
    for (const channel of this.#channels) channel.copyWithin(0, advance);
    this.#gathered = this.#span - advance;
    return ran;
  }
}
