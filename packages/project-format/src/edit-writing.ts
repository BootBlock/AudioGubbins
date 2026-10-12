/**
 * Writing edit operations as `edit-reading.ts` reads them (ADR-0051): every
 * member of every kind, an optional one left out where it is absent, so a
 * value a command carries and a value a document holds are written alike.
 */

import type { EditOperation, EditRange, RangeEdit, RegionOperation } from '@audiogubbins/domain';

import type { JsonObject } from './canonical-json.js';
import { presentMembers } from './document-writing.js';
import { writeEditPlan } from './plan-writing.js';
import { writeSpectralMask, writeSpectralOperation } from './spectral-writing.js';
import { writeLayout } from './value-writing.js';

/** Writes a span between two sample boundaries. */
function writeEditRange(range: EditRange): JsonObject {
  return { start: range.start, end: range.end };
}

/** Writes a change over a range that moves nothing in time. */
function writeRangeEdit(edit: RangeEdit): JsonObject {
  switch (edit.kind) {
    case 'gain':
      return { kind: edit.kind, gain: edit.gain };
    case 'fade':
      return { kind: edit.kind, direction: edit.direction, shape: edit.shape };
    case 'silence':
    case 'invert':
      return { kind: edit.kind };
    case 'swap-channels':
      return { kind: edit.kind, first: edit.first, second: edit.second };
    case 'copy-channel':
      return { kind: edit.kind, from: edit.from, to: edit.to };
    case 'channel-gains':
      return { kind: edit.kind, gains: [...edit.gains] };
    case 'rack':
      return { kind: edit.kind, chain: edit.chain };
    case 'punch':
      return { kind: edit.kind, stack: edit.stack };
    case 'spectral':
      return {
        kind: edit.kind,
        mask: writeSpectralMask(edit.mask),
        resolution: edit.resolution,
        operation: writeSpectralOperation(edit.operation),
      };
  }
}

/** Writes one operation of an asset's chain. */
export function writeEditOperation(operation: EditOperation): JsonObject {
  switch (operation.kind) {
    case 'delete':
    case 'trim':
    case 'reverse':
      return { id: operation.id, kind: operation.kind, range: writeEditRange(operation.range) };
    case 'insert':
      return presentMembers({
        id: operation.id,
        kind: operation.kind,
        at: operation.at,
        payload: writeEditPlan(operation.payload),
        resampler: operation.resampler,
      });
    case 'process':
      return presentMembers({
        id: operation.id,
        kind: operation.kind,
        range: writeEditRange(operation.range),
        channels: operation.channels === undefined ? undefined : [...operation.channels],
        edit: writeRangeEdit(operation.edit),
      });
    case 'convert-layout':
      return {
        id: operation.id,
        kind: operation.kind,
        layout: writeLayout(operation.layout),
        matrix: operation.matrix.map((row) => [...row]),
      };
    case 'stretch':
      return {
        id: operation.id,
        kind: operation.kind,
        range: writeEditRange(operation.range),
        length: operation.length,
        version: operation.version,
      };
    case 'convert-rate':
      return {
        id: operation.id,
        kind: operation.kind,
        sampleRate: operation.sampleRate,
        version: operation.version,
      };
  }
}

/** Writes one operation of a region's own processing. */
export function writeRegionOperation(operation: RegionOperation): JsonObject {
  return presentMembers({
    id: operation.id,
    basis: operation.basis,
    range: writeEditRange(operation.range),
    channels: operation.channels === undefined ? undefined : [...operation.channels],
    edit: writeRangeEdit(operation.edit),
  });
}
