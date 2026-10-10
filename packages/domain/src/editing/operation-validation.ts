/**
 * Whether an edit operation may join a chain where it stands.
 *
 * One function decides it, for a command making an operation and for a
 * document or journal holding one (ADR-0051), so a chain that was valid when
 * each operation joined it is valid when it is read back, and nothing read
 * back can reach outside its asset. A refusal says what is wrong in a sentence
 * a person can act on.
 */

import { channelCount, layoutsMatch, type ChannelLayout } from '../audio/channel-layout.js';
import type { AssetId, EffectChainId } from '../identity/branded-id.js';
import type { EffectChain } from '../processing/effect-chain.js';
import type { Asset } from '../project/asset.js';
import type { Project } from '../project/project.js';
import { FailureKind, fail, failure, succeed, type DomainResult } from '../result.js';
import { sampleCount, sampleRate } from '../time/sample-time.js';
import { shapeAfter, sourceShape, type EditShape } from './edit-shape.js';
import { isLevelEdit, type EditOperation, type EditRange, type RangeEdit } from './operations.js';
import { spectralEditProblem } from '../spectral/spectral-edit.js';
import { punchProblem } from './punch-validation.js';
import {
  MAXIMUM_STRETCH_RATIO,
  isChannelMatrix,
  isChannelScope,
  isEditGain,
  validatePlan,
} from './plan-validation.js';

/** A refusal with a stable code and a sentence. */
function refused(code: string, summary: string): DomainResult<never> {
  return fail(failure(`editing.${code}`, FailureKind.Rejected, summary));
}

/** Why a range does not lie in a timeline of `length`, or `undefined` where it does. */
export function rangeProblem(range: EditRange, length: number): string | undefined {
  if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)) {
    return 'The range is not a whole number of frames.';
  }
  if (range.start < 0 || range.end > length) return 'The range reaches past the audio.';
  return range.start < range.end ? undefined : 'The range covers no audio.';
}

/** The chains a project holds, which an operation or a target may name. */
export type ProjectChains = ReadonlyMap<EffectChainId, EffectChain>;

/**
 * What an asset's operations may name besides the asset: the project's
 * assets, which a paste reads, its chains, which a rack edit names, and its
 * take stacks, which a punch names (ADR-0051, ADR-0060, ADR-0072).
 */
export type EditingEntities = Pick<Project, 'assets' | 'effectChains' | 'takeStacks'>;

/** Why a target's rack does not name one of the project's chains, or `undefined`. */
export function rackProblem(
  rack: EffectChainId | undefined,
  chains: ProjectChains,
): string | undefined {
  return rack === undefined || chains.has(rack)
    ? undefined
    : 'The rack names a chain the project does not have.';
}

/**
 * Why a range edit does not fit `range` of `count` channels with `channels`
 * scope, or `undefined`. A rack edit acts on every channel and names one of
 * `chains`; a spectral edit's mask lies within the range (ADR-0081). A punch
 * is checked by `punchProblem` where an asset's chain holds it, and refused
 * here, where a region's processing would.
 */
export function rangeEditProblem(
  edit: RangeEdit,
  range: EditRange,
  channels: readonly number[] | undefined,
  count: number,
  chains: ProjectChains,
): string | undefined {
  if (channels !== undefined && !isChannelScope(channels, count)) {
    return 'The channels named are not channels of this audio.';
  }
  if (edit.kind === 'spectral') return spectralEditProblem(edit, range.end - range.start, chains);
  if (isLevelEdit(edit)) {
    return edit.kind === 'gain' && (!isEditGain(edit.gain) || edit.gain < 0)
      ? 'A gain must be a factor from zero to sixty decibels.'
      : undefined;
  }
  if (edit.kind === 'rack') {
    if (channels !== undefined) return 'A chain of processors acts on every channel.';
    return chains.has(edit.chain) ? undefined : 'The edit names a chain the project does not have.';
  }
  if (edit.kind === 'punch') {
    return 'A punch replaces part of an asset, so it is made on the asset, never in a region’s processing.';
  }
  if (channels !== undefined) return 'A change between channels names its own channels.';
  const valid = (channel: number): boolean =>
    Number.isInteger(channel) && channel >= 0 && channel < count;
  switch (edit.kind) {
    case 'swap-channels':
      return valid(edit.first) && valid(edit.second) && edit.first !== edit.second
        ? undefined
        : 'A swap needs two different channels of this audio.';
    case 'copy-channel':
      return valid(edit.from) && valid(edit.to) && edit.from !== edit.to
        ? undefined
        : 'A copy needs two different channels of this audio.';
    case 'channel-gains':
      return edit.gains.length === count &&
        edit.gains.every((gain) => isEditGain(gain) && gain >= 0)
        ? undefined
        : 'Each channel needs one gain, from zero to sixty decibels.';
  }
}

/** Why a conversion matrix does not take `from` to `to`, or `undefined` where it does. */
function conversionProblem(
  from: ChannelLayout,
  to: ChannelLayout,
  matrix: readonly (readonly number[])[],
): string | undefined {
  return isChannelMatrix(matrix, channelCount(from)) && matrix.length === channelCount(to)
    ? undefined
    : 'The conversion does not take this audio’s channels to the new layout.';
}

/** Why an insertion does not fit a timeline of `shape`, or `undefined`. */
function insertionProblem(
  operation: Extract<EditOperation, { readonly kind: 'insert' }>,
  shape: EditShape,
  assets: ReadonlyMap<AssetId, Asset>,
): DomainResult<undefined> {
  if (!Number.isSafeInteger(operation.at) || operation.at < 0 || operation.at > shape.length) {
    return refused('position-outside', 'The insertion point lies outside the audio.');
  }
  const plan = validatePlan(operation.payload, assets);
  if (!plan.ok) return plan;
  const [stream] = operation.payload.streams;
  if (!layoutsMatch(stream.layout, shape.layout)) {
    return refused('payload-layout', 'The inserted audio does not have this audio’s channels.');
  }
  const converted = operation.resampler !== undefined;
  if ((stream.sampleRate !== shape.sampleRate) !== converted) {
    return refused(
      'payload-rate',
      converted
        ? 'The inserted audio is already at this audio’s rate, so there is nothing to convert.'
        : 'The inserted audio is at another sample rate, and is converted only when that is asked for.',
    );
  }
  if (operation.resampler !== undefined && !isVersion(operation.resampler)) {
    return refused(
      'conversion-version',
      'A conversion of the inserted audio names the version of the resampler it is made by.',
    );
  }
  return succeed(undefined);
}

/** Whether `version` is a version an algorithm may have: a whole number from 1. */
export function isVersion(version: number): boolean {
  return Number.isSafeInteger(version) && version >= 1;
}

/** Why a stretch does not fit a timeline of `length`, or `undefined`. */
function stretchProblem(
  operation: Extract<EditOperation, { readonly kind: 'stretch' }>,
  length: number,
): string | undefined {
  const problem = rangeProblem(operation.range, length);
  if (problem !== undefined) return problem;
  if (!Number.isSafeInteger(operation.length) || operation.length <= 0) {
    return 'A stretch makes a whole number of frames.';
  }
  if (!isVersion(operation.version))
    return 'A stretch names the version of the stretch it is made by.';
  const before = operation.range.end - operation.range.start;
  return operation.length * MAXIMUM_STRETCH_RATIO >= before &&
    operation.length <= before * MAXIMUM_STRETCH_RATIO
    ? undefined
    : `A stretch changes a length by at most ${String(MAXIMUM_STRETCH_RATIO)} times either way.`;
}

/** Why a conversion of rate does not apply to a timeline of `shape`, or `undefined`. */
function rateProblem(
  operation: Extract<EditOperation, { readonly kind: 'convert-rate' }>,
  shape: EditShape,
): string | undefined {
  if (!sampleRate(operation.sampleRate).ok) {
    return 'The new rate is not a sample rate audio can have.';
  }
  if (!isVersion(operation.version)) {
    return 'A conversion of rate names the version of the resampler it is made by.';
  }
  return operation.sampleRate === shape.sampleRate
    ? 'The audio is already at that rate, so there is nothing to convert.'
    : undefined;
}

/** `operation`, where it may act on a timeline of `shape` in a project of `entities`. */
export function validateOperation(
  operation: EditOperation,
  shape: EditShape,
  entities: EditingEntities,
): DomainResult<EditOperation> {
  let problem: string | undefined;
  switch (operation.kind) {
    case 'delete':
    case 'trim':
    case 'reverse':
      problem = rangeProblem(operation.range, shape.length);
      break;
    case 'process': {
      const { edit, range, channels } = operation;
      problem =
        rangeProblem(range, shape.length) ??
        (edit.kind === 'punch'
          ? punchProblem(edit, range, channels, shape, entities)
          : rangeEditProblem(
              edit,
              range,
              channels,
              channelCount(shape.layout),
              entities.effectChains,
            ));
      break;
    }
    case 'stretch':
      problem = stretchProblem(operation, shape.length);
      break;
    case 'convert-rate':
      problem = rateProblem(operation, shape);
      break;
    case 'convert-layout':
      problem = conversionProblem(shape.layout, operation.layout, operation.matrix);
      break;
    case 'insert': {
      const inserted = insertionProblem(operation, shape, entities.assets);
      if (!inserted.ok) return inserted;
      break;
    }
  }
  if (problem !== undefined) return refused('operation-invalid', problem);
  const after = sampleCount(shapeAfter(shape, operation).length);
  return after.ok
    ? succeed(operation)
    : refused('too-long', 'The result would be longer than any audio can be.');
}

/**
 * The asset, where every operation of its chain is valid where it stands in a
 * project of `entities`, no two share an identifier, and its rack names one of
 * the project's chains.
 */
export function validateChain(asset: Asset, entities: EditingEntities): DomainResult<Asset> {
  const rack = rackProblem(asset.rack, entities.effectChains);
  if (rack !== undefined) return refused('rack-unknown', rack);
  const seen = new Set<string>();
  let shape = sourceShape(asset);
  for (const operation of asset.edits) {
    if (seen.has(operation.id)) {
      return refused('duplicate-operation', 'Two of the asset’s edits share an identifier.');
    }
    seen.add(operation.id);
    const valid = validateOperation(operation, shape, entities);
    if (!valid.ok) return valid;
    shape = shapeAfter(shape, operation);
  }
  return succeed(asset);
}
