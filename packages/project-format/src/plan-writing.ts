/**
 * Writing an edit plan as `plan-reading.ts` reads it (ADR-0051): every member
 * of every stream, segment and stage, an optional one left out where it is
 * absent, lists in the plan's own order, which is its meaning.
 */

import type {
  EditPlan,
  GainCurve,
  PlanSegment,
  PlanSource,
  PlanStage,
  PlanStream,
  StreamProcessing,
} from '@audiogubbins/domain';

import type { JsonObject } from './canonical-json.js';
import { writeEffectChain } from './chain-writing.js';
import { presentMembers } from './document-writing.js';
import { writeLayout } from './value-writing.js';

/** Writes an edit plan, or a clipboard payload, which is one. */
export function writeEditPlan(plan: EditPlan): JsonObject {
  return { streams: plan.streams.map(writeStream) };
}

function writeProcessing(processing: StreamProcessing): JsonObject {
  return processing.kind === 'stretch'
    ? { kind: 'stretch', length: processing.length }
    : {
        kind: 'chain',
        chain: writeEffectChain(processing.chain),
        input: writeLayout(processing.input),
      };
}

function writeStream(stream: PlanStream): JsonObject {
  return presentMembers({
    sampleRate: stream.sampleRate,
    layout: writeLayout(stream.layout),
    segments: stream.segments.map(writeSegment),
    processing: stream.processing === undefined ? undefined : writeProcessing(stream.processing),
  });
}

function writeSegment(segment: PlanSegment): JsonObject {
  return {
    source: writeSource(segment.source),
    start: segment.start,
    length: segment.length,
    reversed: segment.reversed,
    stages: segment.stages.map(writeStage),
  };
}

function writeSource(source: PlanSource): JsonObject {
  return source.kind === 'media'
    ? { kind: 'media', asset: source.asset }
    : { kind: 'stream', stream: source.stream };
}

function writeStage(stage: PlanStage): JsonObject {
  if (stage.kind === 'gain') {
    return presentMembers({
      kind: 'gain',
      from: stage.from,
      to: stage.to,
      channels: stage.channels === undefined ? undefined : [...stage.channels],
      gain: writeGainCurve(stage.gain),
    });
  }
  return presentMembers({
    kind: 'matrix',
    range: stage.range === undefined ? undefined : { from: stage.range.from, to: stage.range.to },
    matrix: stage.matrix.map((row) => [...row]),
  });
}

function writeGainCurve(curve: GainCurve): JsonObject {
  if (curve.kind === 'constant') return { kind: 'constant', gain: curve.gain };
  return {
    kind: 'fade',
    origin: curve.origin,
    step: curve.step,
    length: curve.length,
    shape: curve.shape,
    rising: curve.rising,
  };
}
