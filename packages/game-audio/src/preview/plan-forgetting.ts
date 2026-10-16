/**
 * A game preview's plan forgetting what has been heard (ADR-0104), so a run
 * that plays for many minutes, a loop never stopped and triggers overlapping
 * without a break, holds a plan as large as what is still to be heard.
 *
 * Forgetting before a frame the engine has read past drops every voice whose
 * sound ended by then, its places let go (`stream-places.ts`); makes each
 * lane's segments before the voice or silence across the frame one of silence
 * (`lane-segments.ts`); makes the cycles a looping voice's readers have read
 * past one of silence (`voice-streams.ts`); and lays each emitter's motion from
 * the last waypoint at or before the frame. Every stream so changed states the
 * frame it describes from (`forgottenBefore`), so the engine's continuation
 * compares it only from there and keeps every reader of what still sounds
 * (`plan-divergence.ts` of `@audiogubbins/audio-engine`). Nothing is changed at
 * or after the frame, and no stream moves from its place.
 */

import { VARISPEED_DENOMINATOR, convertedFrameCount } from '@audiogubbins/domain';

import { forgottenLane } from './lane-segments.js';
import {
  PlanBuild,
  VoiceList,
  freeVoice,
  laneStream,
  workingCopy,
  type VoiceRecord,
} from './plan-build.js';
import { writeEmitters } from './plan-fixed-streams.js';
import { forgetRun } from './voice-streams.js';

/**
 * How far behind what its lane has read a looping voice's run is remembered,
 * in its own frames: more than any resampler that converts or varies it reads
 * around the frame it makes.
 */
const RUN_REMEMBERED = 8_192;

/** Where `record`'s sound ends, its fade included; infinite for a loop sounding. */
function soundEnd(record: VoiceRecord, fade: number): number {
  const natural = record.start + record.natural;
  return record.cut === undefined ? natural : Math.min(record.cut + fade, natural);
}

/**
 * The frame of `record`'s run its lane has read by the plan's frame `frame`,
 * at the latest, less what a resampler reads behind it: what it plays at the
 * preview's `rate` taken back through its rate and its pitch's ratio.
 */
function runRead(record: VoiceRecord, frame: number, rate: number): number {
  const played = frame - record.start;
  const { sampleRate } = record.member;
  const heard = sampleRate === rate ? played : convertedFrameCount(played, rate, sampleRate);
  const run =
    record.numerator === VARISPEED_DENOMINATOR
      ? heard
      : convertedFrameCount(heard, VARISPEED_DENOMINATOR, record.numerator);
  return run - RUN_REMEMBERED;
}

/**
 * `build` with everything before `frame` forgotten, as the module says; `build`
 * itself where it has forgotten as far already.
 */
export function forgottenBuild(build: PlanBuild, frame: number): PlanBuild {
  if (frame <= build.forgotten) return build;
  const kept: VoiceRecord[] = [];
  const working = {
    ...workingCopy(build, build.end),
    voices: new VoiceList(),
    forgotten: frame,
  };
  const { fade, rate } = working.fixed;
  for (const record of build.voices.values()) {
    if (soundEnd(record, fade) <= frame) {
      freeVoice(working, record);
    } else if (record.member.loop !== undefined && record.start < frame) {
      const runForgotten = forgetRun(
        working.streams,
        record.streams,
        record.runForgotten,
        runRead(record, frame, rate),
      );
      kept.push({ ...record, runForgotten });
    } else {
      kept.push(record);
    }
  }
  for (const [stream, lane] of build.laneStates) {
    const forgotten = forgottenLane(lane, frame);
    if (forgotten === lane) continue;
    working.laneStates.set(stream, forgotten);
    working.streams[stream] = laneStream(working.fixed, forgotten);
  }
  writeEmitters(working, true);
  return new PlanBuild({
    fixed: build.fixed,
    streams: working.streams,
    horizonFrame: build.horizonFrame,
    end: build.end,
    through: build.through,
    lanes: working.lanes,
    epochs: working.epochs,
    laneStates: working.laneStates,
    voices: new VoiceList(kept),
    free: working.free,
    forgotten: frame,
  });
}
