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
import type { AssetId } from '../identity/branded-id.js';
import type { Asset } from '../project/asset.js';
import { FailureKind, fail, failure, succeed, type DomainResult } from '../result.js';
import { sampleCount } from '../time/sample-time.js';
import { shapeAfter, sourceShape, type EditShape } from './edit-shape.js';
import { isLevelEdit, type EditOperation, type EditRange, type RangeEdit } from './operations.js';
import { isChannelMatrix, isChannelScope, isEditGain, validatePlan } from './plan-validation.js';

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

/** Why a range edit does not fit `count` channels with `channels` scope, or `undefined`. */
export function rangeEditProblem(
  edit: RangeEdit,
  channels: readonly number[] | undefined,
  count: number,
): string | undefined {
  if (channels !== undefined && !isChannelScope(channels, count)) {
    return 'The channels named are not channels of this audio.';
  }
  if (isLevelEdit(edit)) {
    return edit.kind === 'gain' && (!isEditGain(edit.gain) || edit.gain < 0)
      ? 'A gain must be a factor from zero to sixty decibels.'
      : undefined;
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
    return refused('position-outside', 'The paste position lies outside the audio.');
  }
  const plan = validatePlan(operation.payload, assets);
  if (!plan.ok) return plan;
  const [stream] = operation.payload.streams;
  if (!layoutsMatch(stream.layout, shape.layout)) {
    return refused('payload-layout', 'The pasted audio does not have this audio’s channels.');
  }
  if ((stream.sampleRate !== shape.sampleRate) !== operation.convertRate) {
    return refused(
      'payload-rate',
      operation.convertRate
        ? 'The pasted audio is already at this audio’s rate, so there is nothing to convert.'
        : 'The pasted audio is at another sample rate, and is converted only when that is asked for.',
    );
  }
  return succeed(undefined);
}

/** `operation`, where it may act on a timeline of `shape`. */
export function validateOperation(
  operation: EditOperation,
  shape: EditShape,
  assets: ReadonlyMap<AssetId, Asset>,
): DomainResult<EditOperation> {
  let problem: string | undefined;
  switch (operation.kind) {
    case 'delete':
    case 'trim':
    case 'reverse':
      problem = rangeProblem(operation.range, shape.length);
      break;
    case 'process':
      problem =
        rangeProblem(operation.range, shape.length) ??
        rangeEditProblem(operation.edit, operation.channels, channelCount(shape.layout));
      break;
    case 'convert-layout':
      problem = conversionProblem(shape.layout, operation.layout, operation.matrix);
      break;
    case 'insert': {
      const inserted = insertionProblem(operation, shape, assets);
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
 * The asset, where every operation of its chain is valid where it stands and
 * no two share an identifier.
 */
export function validateChain(
  asset: Asset,
  assets: ReadonlyMap<AssetId, Asset>,
): DomainResult<Asset> {
  const seen = new Set<string>();
  let shape = sourceShape(asset);
  for (const operation of asset.edits) {
    if (seen.has(operation.id)) {
      return refused('duplicate-operation', 'Two of the asset’s edits share an identifier.');
    }
    seen.add(operation.id);
    const valid = validateOperation(operation, shape, assets);
    if (!valid.ok) return valid;
    shape = shapeAfter(shape, operation);
  }
  return succeed(asset);
}
