/**
 * A game preview's simulation as a plan the engine plays (ADR-0104, ADR-0051),
 * and the same plan continued from a frame without changing anything heard
 * before it.
 *
 * The fixed streams (`plan-layout.ts`) come first; then, in the order of the
 * events that made them, each voice's own streams (`voice-streams.ts`) and the
 * lanes an emitter takes beyond its first, so a continuation from a frame
 * drops every stream made for an event from it on and keeps the rest at their
 * places (`plan-build.ts`). Each voice is laid in its lane at its frame
 * (`plan-voices.ts`), and the fixed streams are written for the horizon and
 * the end (`plan-fixed-streams.ts`).
 *
 * Nothing of the project is changed: the members' plans are read and copied.
 * Identifiers come from `ids`, so a plan is reproducible from the same
 * generator's seed; a continuation mints none.
 */

import {
  conversionMatrix,
  streamLength,
  type AssetId,
  type ChannelLayout,
  type DomainResult,
  type EditPlan,
  type IdGenerator,
  type PlanStage,
  type PlanStream,
  type ProcessorCatalogue,
  succeed,
} from '@audiogubbins/domain';

import { memberKey } from '../groups/membership.js';
import { emptyLane, type Lane } from './lane-segments.js';
import { MASTER_BUS, STEREO, controlsOf, planLayout, type PreviewControls } from './plan-layout.js';
import {
  PlanBuild,
  endFor,
  firstFrom,
  laneStream,
  refused,
  truncated,
  type Fixed,
  type PreviewPlanBuild,
} from './plan-build.js';
import { writeBuses, writeEmitters, writeOutput } from './plan-fixed-streams.js';
import { applyEvents, lengthenLoops, relayLanes, stereoStages, uncutFrom } from './plan-voices.js';
import { pannerDescriptor } from './preview-chains.js';
import type { GamePreviewScenario } from './preview-scenario.js';
import { simulatedPlays, type PreviewSimulation } from './preview-simulation.js';
import type { PoolMember } from './preview-subjects.js';
import { fadeFrames } from './simulation-steps.js';
import type { EmitterPlay } from './trigger-schedule.js';

export interface PreviewPlan {
  readonly plan: EditPlan;
  /** Every asset the plan reads. */
  readonly media: readonly AssetId[];
  /** Where each live parameter is, for running changes. */
  readonly controls: PreviewControls;
  /** Each lane's stream, by `<emitter>:<lane>:<bus>`, kept at its place by every continuation. */
  readonly lanes: ReadonlyMap<string, number>;
  readonly build: PreviewPlanBuild;
}

/** Each lane's stream by `<emitter>:<lane>:<bus>`. */
function laneKeys(
  fixed: Fixed,
  lanes: readonly (readonly (readonly number[])[])[],
): ReadonlyMap<string, number> {
  const keys = new Map<string, number>();
  for (const [emitter, own] of lanes.entries()) {
    const play = fixed.plays[emitter];
    const buses = fixed.layout.emitters[emitter]?.buses ?? [];
    if (play === undefined) continue;
    for (const [lane, streams] of own.entries()) {
      for (const [place, stream] of streams.entries()) {
        keys.set(`${play.emitter.id}:${String(lane)}:${buses[place] ?? MASTER_BUS}`, stream);
      }
    }
  }
  return keys;
}

/** `build` continued by `simulation`'s events from `frame`. */
function continued(
  build: PlanBuild,
  simulation: PreviewSimulation,
  frame: number,
): DomainResult<PreviewPlan> {
  const { fixed } = build;
  const horizon = simulation.log.horizonFrame;
  const end = endFor(horizon, fixed.rate, build.end);
  const moved = end > build.end;
  const working = truncated(build, frame, end);
  uncutFrom(working, frame);
  const applied = applyEvents(
    working,
    simulation.log.events,
    firstFrom(simulation.log.events, (event) => event.frame, frame),
  );
  if (!applied.ok) return applied;
  relayLanes(working, frame, moved);
  if (moved) lengthenLoops(working);
  writeOutput(working, horizon);
  writeBuses(working);
  writeEmitters(working, end > build.through);
  const [first, ...rest] = working.streams;
  if (first === undefined) return refused('preview.plan-empty', 'A preview plan has its sound.');
  const next = new PlanBuild({
    fixed,
    streams: working.streams,
    horizonFrame: horizon,
    end,
    through: Math.max(build.through, end),
    lanes: working.lanes,
    epochs: working.epochs,
    laneStates: working.laneStates,
    voices: working.voices,
    marks: working.marks,
  });
  let keys: ReadonlyMap<string, number> | undefined;
  return succeed({
    plan: { streams: [first, ...rest] },
    media: fixed.media,
    controls: fixed.controls,
    get lanes() {
      keys ??= laneKeys(fixed, next.lanes);
      return keys;
    },
    build: next,
  });
}

/** Why `member`'s `plan` cannot be played by the preview, or `undefined` where it can. */
function memberProblem(member: PoolMember, plan: EditPlan | undefined): string | undefined {
  if (plan === undefined) return 'has no plan';
  const [sound] = plan.streams;
  if (sound.sampleRate !== member.sampleRate || streamLength(sound) !== member.length) {
    return 'has a plan of another rate or length than its sound';
  }
  if (!conversionMatrix(sound.layout, STEREO).ok)
    return 'is in a layout with no stated stereo fold';
  return undefined;
}

function assetsOf(plans: Iterable<EditPlan>): readonly AssetId[] {
  const assets = new Set<AssetId>();
  for (const plan of plans) {
    for (const stream of plan.streams) {
      for (const segment of stream.segments) {
        if (segment.source.kind === 'media') assets.add(segment.source.asset);
      }
    }
  }
  return [...assets];
}

/** The fixed streams of the first plan, every lane empty to `end`. */
function emptyBuild(fixed: Fixed, end: number): PlanBuild {
  const laneStates = new Map<number, Lane>();
  const streams: PlanStream[] = Array.from({ length: fixed.layout.streams }, () => ({
    sampleRate: fixed.rate,
    layout: STEREO,
    segments: [],
  }));
  for (const own of fixed.layout.emitters) {
    for (const stream of own.lanes.flat()) {
      const state = emptyLane(end);
      laneStates.set(stream, state);
      streams[stream] = laneStream(fixed, state);
    }
  }
  return new PlanBuild({
    fixed,
    streams,
    horizonFrame: 0,
    end,
    through: 0,
    lanes: fixed.layout.emitters.map((own) => own.lanes),
    epochs: fixed.layout.emitters.map((own) => [{ from: 0, lanes: own.lanes.length }]),
    laneStates,
    voices: [],
    marks: [],
  });
}

/** Each emitter's pool members by key, with the stages that make each stereo. */
function poolsOf(
  plays: readonly EmitterPlay[],
  members: ReadonlyMap<string, EditPlan>,
): Fixed['pools'] {
  const pools: Map<string, { member: PoolMember; toStereo: readonly PlanStage[] }>[] = [];
  for (const play of plays) {
    const pool = new Map<string, { member: PoolMember; toStereo: readonly PlanStage[] }>();
    for (const member of play.pool) {
      const key = memberKey(member.member);
      const plan = members.get(key);
      const toStereo = plan === undefined ? undefined : stereoStages(plan);
      if (toStereo?.ok === true) pool.set(key, { member, toStereo: toStereo.value });
    }
    pools.push(pool);
  }
  return pools;
}

/**
 * `simulation` as a plan in `output`, the project's layout: each member's
 * sound from `members`, by its `memberKey`, each processor from `catalogue`,
 * each chain's identifiers from `ids`; refused where a member has no plan, or
 * one of another rate or length than its pool says, or of a layout with no
 * stated fold to stereo, or where the catalogue lacks a processor or refuses
 * a rule's value.
 */
export function previewPlan(
  simulation: PreviewSimulation,
  scenario: GamePreviewScenario,
  members: ReadonlyMap<string, EditPlan>,
  catalogue: ProcessorCatalogue,
  ids: IdGenerator,
  output: ChannelLayout,
): DomainResult<PreviewPlan> {
  const simulated = simulatedPlays(simulation.state);
  if (
    simulated?.plays.length !== scenario.emitters.length ||
    simulated.plays.some((play, index) => play.emitter !== scenario.emitters[index])
  ) {
    return refused(
      'preview.simulation-mismatch',
      'A preview plan is made of a simulation of its scenario.',
    );
  }
  const { plays, rate } = simulated;
  for (const play of plays) {
    for (const member of play.pool) {
      const problem = memberProblem(member, members.get(memberKey(member.member)));
      if (problem !== undefined) {
        return refused(
          'preview.member-unplayable',
          `A member of "${play.emitter.name}" ${problem}.`,
        );
      }
    }
  }
  const panner = pannerDescriptor(catalogue);
  if (!panner.ok) return panner;
  const layout = planLayout(scenario, plays, catalogue, ids);
  if (!layout.ok) return layout;
  const pools = poolsOf(plays, members);
  const fixed: Fixed = {
    controls: controlsOf(layout.value, plays),
    places: new Map(plays.map((play, index) => [play.emitter.id, index])),
    pools,
    scenario,
    plays,
    rate,
    fade: fadeFrames(rate),
    members,
    panner: panner.value,
    output,
    layout: layout.value,
    media: assetsOf(
      plays.flatMap((play) => play.pool.flatMap((one) => members.get(memberKey(one.member)) ?? [])),
    ),
  };
  return continued(emptyBuild(fixed, endFor(simulation.log.horizonFrame, rate)), simulation, 0);
}

/**
 * `previous` with `simulation`'s events from `from` on: every stream, and
 * every segment, that ends by `from` (or by `previous`'s horizon, where that
 * is earlier) unchanged at its place, so an engine continuing into it keeps
 * every reader of what is sounding. `simulation` is the simulation `previous`
 * was made of, continued; one of another scenario or rate is refused.
 */
export function extendPreviewPlan(
  previous: PreviewPlan,
  simulation: PreviewSimulation,
  from: number,
): DomainResult<PreviewPlan> {
  const { build } = previous;
  const simulated = simulatedPlays(simulation.state);
  if (
    !(build instanceof PlanBuild) ||
    simulated?.rate !== build.fixed.rate ||
    simulated.plays.length !== build.fixed.plays.length ||
    simulated.plays.some((play, index) => play.emitter !== build.fixed.plays[index]?.emitter)
  ) {
    return refused(
      'preview.simulation-mismatch',
      'A preview plan goes on only with its own simulation, continued.',
    );
  }
  return continued(build, simulation, Math.min(from, build.horizonFrame));
}
