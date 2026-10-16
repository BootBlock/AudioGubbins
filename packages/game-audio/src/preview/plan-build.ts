/**
 * What a game preview's plan is built from and continued from (ADR-0104): the
 * parts of a plan that every continuation keeps, each voice as the plan holds
 * it, the marks of where the streams made for each event begin, and the
 * working copies one continuation changes, made by taking away everything a
 * plan made for events from the frame it continues from.
 *
 * Lanes, emitters and buses run to the plan's end, which runs ten seconds at
 * a time ahead of the horizon, so a continuation within it touches only the
 * lanes whose voices it changes.
 */

import {
  FailureKind,
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
import type { EmitterPlay } from './trigger-schedule.js';
import type { VoiceStreams } from './voice-streams.js';

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
}

/** Where streams made for an event at `frame` begin. */
interface Mark {
  readonly frame: number;
  readonly first: number;
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
  /** By number. */
  readonly voices: readonly VoiceRecord[];
  /** In order of frame. */
  readonly marks: readonly Mark[];
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
  readonly voices: readonly VoiceRecord[];
  readonly marks: readonly Mark[];

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
    this.marks = parts.marks;
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
  return { sampleRate: fixed.rate, layout: STEREO, segments: lane.segments };
}

/** Working copies of a build's parts, changed by one continuation and frozen into the next build. */
export interface Working {
  readonly fixed: Fixed;
  readonly streams: PlanStream[];
  readonly lanes: number[][][];
  readonly epochs: Epoch[][];
  readonly laneStates: Map<number, Lane>;
  readonly voices: VoiceRecord[];
  readonly marks: Mark[];
  readonly end: number;
  /** The voices each lane gained, by the lane's stream. */
  readonly added: Map<number, number[]>;
}

/** `build` with everything made for events from `frame` on taken away. */
export function truncated(build: PlanBuild, frame: number, end: number): Working {
  const markAt = firstFrom(build.marks, (mark) => mark.frame, frame);
  const kept = build.marks[markAt]?.first ?? build.streams.length;
  const epochs = build.epochs.map((own) =>
    own.filter((epoch) => epoch.from === 0 || epoch.from < frame),
  );
  const lanes = build.lanes.map((own, emitter) =>
    own.slice(0, epochs[emitter]?.at(-1)?.lanes ?? own.length).map((buses) => [...buses]),
  );
  const laneStates = new Map(build.laneStates);
  for (const stream of laneStates.keys()) if (stream >= kept) laneStates.delete(stream);
  return {
    fixed: build.fixed,
    streams: build.streams.slice(0, kept),
    lanes,
    epochs: epochs.map((own) => [...own]),
    laneStates,
    voices: build.voices.slice(
      0,
      firstFrom(build.voices, (voice) => voice.start, frame),
    ),
    marks: build.marks.slice(0, markAt),
    end,
    added: new Map(),
  };
}

/** The lane streams of a new lane of `emitter` from `frame`, appended. */
export function addLane(working: Working, emitter: number, frame: number): void {
  const buses = working.fixed.layout.emitters[emitter]?.buses ?? [];
  working.marks.push({ frame, first: working.streams.length });
  const streams = buses.map(() => {
    const stream = working.streams.length;
    const lane = emptyLane(working.end);
    working.laneStates.set(stream, lane);
    working.streams.push(laneStream(working.fixed, lane));
    return stream;
  });
  working.lanes[emitter]?.push(streams);
  const epochs = working.epochs[emitter];
  epochs?.push({ from: frame, lanes: working.lanes[emitter]?.length ?? 0 });
}
