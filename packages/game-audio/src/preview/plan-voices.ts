/**
 * A game preview's voices in its plan (ADR-0104): each voice started by the
 * log given its own streams and laid in its lane at its frame, with its
 * layout made stereo, its gain and, where it is cut, its fade; and, as a plan
 * continues, the lanes whose voices it changes laid again from the frame it
 * continues from, and loops lengthened to a later end.
 */

import {
  conversionMatrix,
  succeed,
  type DomainResult,
  type EditPlan,
  type PlanStage,
} from '@audiogubbins/domain';
import { decibelsToGain } from '@audiogubbins/audio-engine';

import { memberKey } from '../groups/membership.js';
import { relaidLane, type Lane, type Placement } from './lane-segments.js';
import { MASTER_BUS, STEREO, isStereo } from './plan-layout.js';
import {
  addLane,
  firstFrom,
  laneStream,
  refused,
  type VoiceRecord,
  type Working,
} from './plan-build.js';
import { pitchNumerator } from './preview-draws.js';
import type { PreviewEvent, StartedEvent } from './preview-event-log.js';
import { voiceFrames } from './simulation-steps.js';
import { takePlaces } from './stream-places.js';
import {
  NOTHING_FORGOTTEN,
  lengthenLoop,
  placeVoiceStreams,
  voicePlaces,
} from './voice-streams.js';

/** Where `record` sits in its lane, against the plan's `end`. */
function placementOf(record: VoiceRecord, fade: number, end: number): Placement {
  const natural = record.start + record.natural;
  const bodyEnd = Math.min(record.cut ?? Number.POSITIVE_INFINITY, natural, end);
  const soundEnd = record.cut === undefined ? bodyEnd : Math.min(record.cut + fade, natural, end);
  return {
    voice: record.voice,
    start: record.start,
    bodyEnd,
    soundEnd,
    heard: record.streams.heard,
    stages: record.stages,
    fade,
  };
}

/** The stage that makes `plan`'s sound stereo, none where it is, or why it cannot be made so. */
export function stereoStages(plan: EditPlan): DomainResult<readonly PlanStage[]> {
  const layout = plan.streams[0].layout;
  if (isStereo(layout)) return succeed([]);
  const matrix = conversionMatrix(layout, STEREO);
  return matrix.ok ? succeed([{ kind: 'matrix', matrix: matrix.value }]) : matrix;
}

/** The stages a voice's lane reads it through: its layout made stereo, then its gain. */
function voiceStages(toStereo: readonly PlanStage[], gainDecibels: number): readonly PlanStage[] {
  if (gainDecibels === 0) return toStereo;
  return [
    ...toStereo,
    {
      kind: 'gain',
      from: 0,
      to: Number.MAX_SAFE_INTEGER,
      gain: { kind: 'constant', gain: decibelsToGain(gainDecibels) },
    },
  ];
}

/** That `voice` was laid in the lane of stream `lane`. */
function noteAdded(working: Working, lane: number | undefined, voice: number): void {
  if (lane === undefined) return;
  const added = working.added.get(lane);
  if (added === undefined) working.added.set(lane, [voice]);
  else added.push(voice);
}

/** The record and streams of the voice `event` started, appended. */
function startVoice(working: Working, event: StartedEvent): DomainResult<void> {
  const { fixed } = working;
  const emitter = fixed.places.get(event.emitter) ?? -1;
  const key = memberKey(event.member);
  const found = fixed.pools[emitter]?.get(key);
  const plan = fixed.members.get(key);
  const bus = fixed.layout.emitters[emitter]?.buses.indexOf(event.bus ?? MASTER_BUS) ?? -1;
  if (found === undefined || plan === undefined || bus < 0) {
    return refused('preview.event-unknown', 'The log names a member the preview does not play.');
  }
  const { member } = found;
  while ((working.lanes[emitter]?.length ?? 0) <= event.lane)
    addLane(working, emitter, event.frame);
  const stages = voiceStages(found.toStereo, event.gainDecibels);
  const numerator = pitchNumerator(event.pitchCents);
  const natural = voiceFrames(member, event.offsetFrames, event.pitchCents, fixed.rate);
  const heard = Math.min(natural, working.end - event.frame);
  const voice = { offset: event.offsetFrames, numerator, heard };
  const lane = working.lanes[emitter]?.[event.lane]?.[bus] ?? 0;
  const at = takePlaces(working.streams, working.free, voicePlaces(plan, numerator), lane);
  const streams = placeVoiceStreams(working.streams, at, plan, member, voice, fixed.rate);
  working.voices.set({
    voice: event.voice,
    emitter,
    lane: event.lane,
    bus,
    start: event.frame,
    member,
    offset: event.offsetFrames,
    numerator,
    natural,
    stages,
    streams,
    cut: undefined,
    runForgotten: NOTHING_FORGOTTEN,
  });
  noteAdded(working, working.lanes[emitter]?.[event.lane]?.[bus], event.voice);
  return succeed(undefined);
}

/** Records what each event from `first` on did to the plan's voices. */
export function applyEvents(
  working: Working,
  events: readonly PreviewEvent[],
  first: number,
): DomainResult<void> {
  for (let index = first; index < events.length; index += 1) {
    const event = events[index];
    if (event === undefined) break;
    if (event.kind === 'started') {
      const started = startVoice(working, event);
      if (!started.ok) return started;
    } else if (
      event.kind === 'stolen' ||
      event.kind === 'budget-stolen' ||
      event.kind === 'stopped'
    ) {
      const record = working.voices.get(event.voice);
      if (record !== undefined) working.voices.set({ ...record, cut: event.frame });
    }
  }
  return succeed(undefined);
}

/** The last placement of `lane` that starts before `frame`, if any. */
function lastBefore(lane: Lane, frame: number): Placement | undefined {
  const at = firstFrom(lane.placements, (placement) => placement.start, frame);
  return lane.placements[at - 1];
}

/** Every voice sounding across `frame` freed of a cut from it on, which the new events decide again. */
export function uncutFrom(working: Working, frame: number): void {
  for (const lane of working.laneStates.values()) {
    const last = lastBefore(lane, frame);
    if (last === undefined) continue;
    const record = working.voices.get(last.voice);
    if (record?.cut !== undefined && record.cut >= frame) {
      working.voices.set({ ...record, cut: undefined });
    }
  }
}

/** Lays again every lane a continuation from `frame` changes, or every lane where the end moved. */
export function relayLanes(working: Working, frame: number, moved: boolean): void {
  const { end } = working;
  const { fade } = working.fixed;
  for (const [stream, lane] of working.laneStates) {
    const before = lastBefore(lane, frame);
    const record = before === undefined ? undefined : working.voices.get(before.voice);
    const across =
      before !== undefined &&
      record !== undefined &&
      (before.soundEnd > frame || placementOf(record, fade, end).soundEnd > frame)
        ? record
        : undefined;
    const removed = (lane.placements.at(-1)?.start ?? -1) >= frame;
    const added = working.added.get(stream) ?? [];
    if (!moved && across === undefined && !removed && added.length === 0) continue;
    const placements: Placement[] = [];
    if (across !== undefined) placements.push(placementOf(across, fade, end));
    for (const voice of added) {
      const one = working.voices.get(voice);
      if (one !== undefined) placements.push(placementOf(one, fade, end));
    }
    const relaid = relaidLane(lane, frame, placements, end);
    working.laneStates.set(stream, relaid);
    working.streams[stream] = laneStream(working.fixed, relaid);
  }
}

/**
 * Every looping voice's run lengthened as far as it sounds within the plan's
 * end: to the end where it is not cut, and to its fade's end where it is, which
 * may lie past the end it was laid to when it started.
 */
export function lengthenLoops(working: Working): void {
  const { fade, rate } = working.fixed;
  for (const record of working.voices.values()) {
    if (record.member.loop === undefined) continue;
    const sounds =
      record.cut === undefined ? working.end : Math.min(working.end, record.cut + fade);
    lengthenLoop(
      working.streams,
      record.streams,
      record.member,
      record,
      rate,
      sounds - record.start,
    );
  }
}
