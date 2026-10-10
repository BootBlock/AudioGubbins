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
import { writePlannedSpectralOperation, writeSpectralMask } from './spectral-writing.js';
import { writeLayout } from './value-writing.js';

/** Writes an edit plan, or a clipboard payload, which is one. */
export function writeEditPlan(plan: EditPlan): JsonObject {
  return { streams: plan.streams.map(writeStream) };
}

function writeProcessing(processing: StreamProcessing): JsonObject {
  switch (processing.kind) {
    case 'stretch':
      return { kind: 'stretch', length: processing.length };
    case 'chain':
      return {
        kind: 'chain',
        chain: writeEffectChain(processing.chain),
        input: writeLayout(processing.input),
      };
    case 'spectral': {
      const { mask, resolution, operation, channels } = processing.edit;
      return {
        kind: 'spectral',
        edit: presentMembers({
          mask: writeSpectralMask(mask),
          resolution,
          operation: writePlannedSpectralOperation(operation),
          channels: channels === undefined ? undefined : [...channels],
        }),
      };
    }
  }
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
  switch (source.kind) {
    case 'media':
      return { kind: 'media', asset: source.asset };
    case 'stream':
      return { kind: 'stream', stream: source.stream };
    case 'silence':
      return { kind: 'silence', channels: source.channels };
    case 'mix':
      return { kind: 'mix', streams: [...source.streams] };
  }
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
