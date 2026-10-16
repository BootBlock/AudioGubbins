/**
 * What a game preview's plan is built from and continued from (ADR-0104): the
 * parts of a plan that every continuation keeps, each voice as the plan holds
 * it and the places it holds (`stream-places.ts`), the frame before which the
 * plan has forgotten what was heard (`plan-forgetting.ts`), and the working
 * copies one continuation changes, made by taking away everything a plan made
 * for events from the frame it continues from.
 *
 * Lanes, emitters and buses run to the plan's end, which runs ten seconds at
 * a time ahead of the horizon, so a continuation within it touches only the
 * lanes whose voices it changes.
 */

import {
  FailureKind,
  derivedSampleCount,
  fail,
  failure,
  type AssetId,
  type ChannelLayout,
  type DomainResult,
  type EditPlan,
  type PlanStage,
  type PlanStream,
  type ProcessorDescriptor,
  type SampleRate,
} from '@audiogubbins/domain';

import { emptyLane, type Lane } from './lane-segments.js';
import type { GamePreviewScenario } from './preview-scenario.js';
import type { PoolMember } from './preview-subjects.js';
import { STEREO, type PlanLayout, type PreviewControls } from './plan-layout.js';
import { freePlaces, takePlaces } from './stream-places.js';
import type { EmitterPlay } from './trigger-schedule.js';
import type { RunForgotten, VoiceStreams } from './voice-streams.js';

/** How far, in seconds, the plan's end is laid ahead of the horizon at a time. */
const AHEAD_SECONDS = 10;

/** What a plan continues from: opaque, made only here. */
export interface PreviewPlanBuild {
  readonly horizonFrame: number;
}

/** A voice as the plan holds it. */
export interface VoiceRecord {
  readonly voice: number;
  readonly emitter: number;
  readonly lane: number;
  /** Its bus's place among its emitter's. */
  readonly bus: number;
  readonly start: number;
  readonly member: PoolMember;
  readonly offset: number;
  readonly numerator: number;
  /** Its frames played to its end; infinite for a loop. */
  readonly natural: number;
  readonly stages: readonly PlanStage[];
  readonly streams: VoiceStreams;
  /** Where it was cut, if it was. */
  readonly cut: number | undefined;
  /** What of a looping voice's run the plan has forgotten. */
  readonly runForgotten: RunForgotten;
}

/** The lanes an emitter has from a frame on. */
interface Epoch {
  readonly from: number;
  readonly lanes: number;
}

/** What stays the same from one plan of a simulation to the next. */
export interface Fixed {
  readonly scenario: GamePreviewScenario;
  readonly plays: readonly EmitterPlay[];
  readonly rate: SampleRate;
  readonly fade: number;
  readonly members: ReadonlyMap<string, EditPlan>;
  readonly panner: ProcessorDescriptor;
  readonly output: ChannelLayout;
  readonly layout: PlanLayout;
  readonly media: readonly AssetId[];
  readonly controls: PreviewControls;
  /** Each emitter's place, by identifier. */
  readonly places: ReadonlyMap<string, number>;
  /** Each emitter's pool members by key, and what makes each member's layout stereo. */
  readonly pools: readonly ReadonlyMap<
    string,
    { readonly member: PoolMember; readonly toStereo: readonly PlanStage[] }
  >[];
}

interface BuildParts {
  readonly fixed: Fixed;
  readonly streams: readonly PlanStream[];
  readonly horizonFrame: number;
  /** Where lanes, emitters and buses end. */
  readonly end: number;
  /** The frame the emitters' motion is laid through. */
  readonly through: number;
  /** Each emitter's lanes: for each, its stream of each bus. */
  readonly lanes: readonly (readonly (readonly number[])[])[];
  readonly epochs: readonly (readonly Epoch[])[];
  readonly laneStates: ReadonlyMap<number, Lane>;
  /** By number, in the order they started. */
  readonly voices: VoiceList;
  /** The places let go, in order, each holding a stream forgotten whole. */
  readonly free: readonly number[];
  /** The frame before which the plan has forgotten what was heard; 0 where it has forgotten nothing. */
  readonly forgotten: number;
}

/**
 * The voices a plan holds, in the order they started, which is the order of
 * their numbers: found by number by halving, so a plan of many voices copies
 * and searches them cheaply. One list belongs to one build or working copy.
 */
export class VoiceList {
  readonly #records: VoiceRecord[];

  constructor(records: readonly VoiceRecord[] = []) {
    this.#records = [...records];
  }

  /** The index of the first record numbered `voice` or later. */
  #at(voice: number): number {
    return firstFrom(this.#records, (record) => record.voice, voice);
  }

  get(voice: number): VoiceRecord | undefined {
    const record = this.#records[this.#at(voice)];
    return record?.voice === voice ? record : undefined;
  }

  /** Puts `record` in place of its number's, or after every other, a voice started later. */
  set(record: VoiceRecord): void {
    const at = this.#at(record.voice);
    if (this.#records[at]?.voice === record.voice) this.#records[at] = record;
    else this.#records.splice(at, 0, record);
  }

  delete(voice: number): void {
    const at = this.#at(voice);
    if (this.#records[at]?.voice === voice) this.#records.splice(at, 1);
  }

  /** Takes out, and answers, every voice that started at `frame` or later. */
  takeFrom(frame: number): readonly VoiceRecord[] {
    return this.#records.splice(firstFrom(this.#records, (record) => record.start, frame));
  }

  values(): readonly VoiceRecord[] {
    return this.#records;
  }

  copy(): VoiceList {
    return new VoiceList(this.#records);
  }
}

export class PlanBuild implements PreviewPlanBuild, BuildParts {
  readonly fixed: Fixed;
  readonly streams: readonly PlanStream[];
  readonly horizonFrame: number;
  readonly end: number;
  readonly through: number;
  readonly lanes: readonly (readonly (readonly number[])[])[];
  readonly epochs: readonly (readonly Epoch[])[];
  readonly laneStates: ReadonlyMap<number, Lane>;
  readonly voices: VoiceList;
  readonly free: readonly number[];
  readonly forgotten: number;

  constructor(parts: BuildParts) {
    this.fixed = parts.fixed;
    this.streams = parts.streams;
    this.horizonFrame = parts.horizonFrame;
    this.end = parts.end;
    this.through = parts.through;
    this.lanes = parts.lanes;
    this.epochs = parts.epochs;
    this.laneStates = parts.laneStates;
    this.voices = parts.voices;
    this.free = parts.free;
    this.forgotten = parts.forgotten;
  }
}

export function refused(code: string, summary: string): DomainResult<never> {
  return fail(failure(code, FailureKind.Rejected, summary));
}

/** The first index of `items` whose `frame` is at or after `frame`; `items` rise by it. */
export function firstFrom<T>(
  items: readonly T[],
  frameOf: (item: T) => number,
  frame: number,
): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const item = items[middle];
    if (item !== undefined && frameOf(item) < frame) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** The plan's end for a horizon: the next whole span ahead past it. */
export function endFor(horizon: number, rate: number, previous = 0): number {
  const span = AHEAD_SECONDS * rate;
  return Math.max(previous, (Math.floor(horizon / span) + 1) * span);
}

export function laneStream(fixed: Fixed, lane: Lane): PlanStream {
  return {
    sampleRate: fixed.rate,
    layout: STEREO,
    segments: lane.segments,
    ...(lane.forgotten === 0 ? {} : { forgottenBefore: derivedSampleCount(lane.forgotten) }),
  };
}

/** Working copies of a build's parts, changed by one continuation and frozen into the next build. */
export interface Working {
  readonly fixed: Fixed;
  readonly streams: PlanStream[];
  readonly lanes: number[][][];
  readonly epochs: Epoch[][];
  readonly laneStates: Map<number, Lane>;
  readonly voices: VoiceList;
  readonly free: number[];
  readonly forgotten: number;
  readonly end: number;
  /** The voices each lane gained, by the lane's stream. */
  readonly added: Map<number, number[]>;
}

/** `build`'s parts as working copies, to change into the next build. */
export function workingCopy(build: PlanBuild, end: number): Working {
  return {
    fixed: build.fixed,
    streams: [...build.streams],
    lanes: build.lanes.map((own) => own.map((buses) => [...buses])),
    epochs: build.epochs.map((own) => [...own]),
    laneStates: new Map(build.laneStates),
    voices: build.voices.copy(),
    free: [...build.free],
    forgotten: build.forgotten,
    end,
    added: new Map(),
  };
}

/** Lets go of the places `record`'s streams hold. */
export function freeVoice(working: Working, record: VoiceRecord): void {
  const { heard, count } = record.streams;
  freePlaces(working.streams, working.free, heard, count, working.fixed.rate);
}

/** `build` with everything made for events from `frame` on taken away. */
export function truncated(build: PlanBuild, frame: number, end: number): Working {
  const working = workingCopy(build, end);
  const blocks = working.voices
    .takeFrom(frame)
    .map(({ streams }) => ({ first: streams.heard, count: streams.count }));
  for (const [emitter, own] of build.epochs.entries()) {
    const kept = own.filter((epoch) => epoch.from === 0 || epoch.from < frame);
    working.epochs[emitter] = kept;
    const lanes = working.lanes[emitter] ?? [];
    for (const buses of lanes.splice(kept.at(-1)?.lanes ?? lanes.length)) {
      for (const stream of buses) {
        working.laneStates.delete(stream);
        blocks.push({ first: stream, count: 1 });
      }
    }
  }
  // From the last place back, so places at the end are let go by shortening.
  for (const { first, count } of blocks.toSorted((left, right) => right.first - left.first)) {
    freePlaces(working.streams, working.free, first, count, working.fixed.rate);
  }
  return working;
}

/** The lane streams of a new lane of `emitter` from `frame`, each at a place free after its emitter's. */
export function addLane(working: Working, emitter: number, frame: number): void {
  const own = working.fixed.layout.emitters[emitter];
  const buses = own?.buses ?? [];
  const after = Math.max(0, ...(own?.streams ?? []));
  const streams = buses.map(() => {
    const stream = takePlaces(working.streams, working.free, 1, after);
    const lane = emptyLane(working.end);
    working.laneStates.set(stream, lane);
    working.streams[stream] = laneStream(working.fixed, lane);
    return stream;
  });
  working.lanes[emitter]?.push(streams);
  const epochs = working.epochs[emitter];
  epochs?.push({ from: frame, lanes: working.lanes[emitter]?.length ?? 0 });
}
