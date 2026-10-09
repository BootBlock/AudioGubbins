/**
 * What a paste does to an asset (ADR-0053): the edits that insert what was
 * copied at a position, or in place of a range, and the records of the media it
 * reads that the destination project does not hold yet.
 *
 * A payload whose channels differ is fitted by the matrix the domain states for
 * the two layouts, and refused with the reason where it states none. One at
 * another rate is pasted only when the person asks for it to be converted
 * (REQ-ARCH-085). A payload whose insertion would be longer than an invocation
 * argument may be is inserted as consecutive insertions, split between its
 * segments, which the caller runs as one change; one being converted is refused
 * instead, since the resampler converts a payload as a whole and converting its
 * pieces apart would put a seam at every split. Every edit is checked by the
 * domain's own rule against the timeline it acts on, the media to be added
 * counted among the project's, so what is planned is exactly what the commands
 * will accept.
 */

import {
  FailureKind,
  conversionMatrix,
  derivedSampleCount,
  fail,
  failure,
  layoutsMatch,
  shapeAfter,
  shapesOf,
  slicePlan,
  streamLength,
  succeed,
  unsafeBrandId,
  validateOperation,
  type Asset,
  type AssetId,
  type DomainResult,
  type EditingEntities,
  type EditOperation,
  type EditPlan,
  type EditRange,
  type EditShape,
  type IdGenerator,
  type SampleCount,
} from '@audiogubbins/domain';
import {
  NESTED_ARGUMENT_LIMITS,
  canonicalJson,
  writeEditOperation,
  writeMediaSource,
  type AssetRecord,
  type ProjectState,
} from '@audiogubbins/project-format';

import type { AudioPayload } from './clipboard-payload.js';
import { quoted } from '@audiogubbins/text';

/** Where a paste goes, and how. */
export interface PasteRequest {
  readonly payload: AudioPayload;

  /** The asset pasted into. */
  readonly asset: AssetId;

  /** Where on the asset's timeline as it stands: a position, or a range replaced. */
  readonly place:
    | { readonly kind: 'at'; readonly at: SampleCount }
    | { readonly kind: 'replace'; readonly range: EditRange };

  /**
   * The version of the canonical resampler, the engine's, that converts audio
   * at another rate where the person asked for that, or `undefined` where they
   * did not. Audio at the asset's own rate is pasted as it is either way.
   */
  readonly convertWith: number | undefined;
}

/** What a paste does, to be run as one change. */
export interface PlannedPaste {
  /** The records to add first, of media the destination project does not hold. */
  readonly records: readonly AssetRecord[];

  /** The edits to apply to the asset, in order. */
  readonly operations: readonly [EditOperation, ...EditOperation[]];
}

function refused(code: string, summary: string): DomainResult<never> {
  return fail(failure(`clipboard.${code}`, FailureKind.Rejected, summary));
}

/**
 * The paste `request` asks of `state`, with identities from `ids`, or why it
 * cannot be made. Each insertion is at most `longestArgument` characters as an
 * invocation argument, the length the commands read one with.
 */
export function planPaste(
  state: ProjectState,
  request: PasteRequest,
  ids: IdGenerator,
  longestArgument: number = NESTED_ARGUMENT_LIMITS.maximumLength,
): DomainResult<PlannedPaste> {
  const asset = state.project.assets.get(request.asset);
  if (asset === undefined) return refused('asset-unknown', 'The project has no such asset.');
  const records = recordsToAdd(state, request.payload.records);
  if (!records.ok) return records;
  const shape = currentShape(asset);
  const plan = fitted(request.payload.plan, shape);
  if (!plan.ok) return plan;
  const operations = pasteEdits(request, plan.value, shape, {
    entities: entitiesWith(state, records.value),
    ids,
    longestArgument,
  });
  if (!operations.ok) return operations;
  return succeed({ records: records.value, operations: operations.value });
}

/**
 * The entities a paste's edits are validated against: the project as it will
 * be, with the copied recordings added beside its own.
 */
function entitiesWith(state: ProjectState, records: readonly AssetRecord[]): EditingEntities {
  const assets = new Map(state.project.assets);
  for (const record of records) assets.set(record.asset.id, record.asset);
  return {
    assets,
    effectChains: state.project.effectChains,
    takeStacks: state.project.takeStacks,
  };
}

/** What a paste's edits are made with and checked against, beside the timeline. */
interface EditContext {
  readonly entities: EditingEntities;
  readonly ids: IdGenerator;
  readonly longestArgument: number;
}

/**
 * The edits that put `plan` where `request` says on the timeline `start`: the
 * replaced range deleted, where one is, then the plan inserted in as many
 * pieces as the argument length needs. Each is checked against the timeline
 * the edits before it leave, as the commands will check it.
 */
function pasteEdits(
  request: PasteRequest,
  plan: EditPlan,
  start: EditShape,
  context: EditContext,
): DomainResult<readonly [EditOperation, ...EditOperation[]]> {
  const operations: EditOperation[] = [];
  let shape = start;
  let at: number = request.place.kind === 'at' ? request.place.at : request.place.range.start;
  if (request.place.kind === 'replace') {
    const deletion: EditOperation = {
      id: context.ids.next<'EditOperationId'>(),
      kind: 'delete',
      range: request.place.range,
    };
    const after = appended(operations, deletion, shape, context.entities);
    if (!after.ok) return after;
    shape = after.value;
  }

  const resampler =
    plan.streams[0].sampleRate === shape.sampleRate ? undefined : request.convertWith;
  const pieces = argumentSized(plan, resampler, context.longestArgument);
  if (!pieces.ok) return pieces;
  for (const piece of pieces.value) {
    const insertion: EditOperation = {
      id: context.ids.next<'EditOperationId'>(),
      kind: 'insert',
      at: derivedSampleCount(at),
      payload: piece,
      ...(resampler === undefined ? {} : { resampler }),
    };
    const after = appended(operations, insertion, shape, context.entities);
    if (!after.ok) return after;
    at += after.value.length - shape.length;
    shape = after.value;
  }
  const [first, ...rest] = operations;
  if (first === undefined) throw new Error('A paste inserts at least one piece.');
  return succeed([first, ...rest]);
}

/**
 * `operation` checked by the domain's rule against `shape` and appended to
 * `operations`, with the timeline it leaves; or why the rule refuses it.
 */
function appended(
  operations: EditOperation[],
  operation: EditOperation,
  shape: EditShape,
  entities: EditingEntities,
): DomainResult<EditShape> {
  const valid = validateOperation(operation, shape, entities);
  if (!valid.ok) return valid;
  operations.push(operation);
  return succeed(shapeAfter(shape, operation));
}

/** The timeline an asset's next edit acts on. */
function currentShape(asset: Asset): EditShape {
  const shape = shapesOf(asset).at(-1);
  if (shape === undefined) throw new Error('A chain always has a shape.');
  return shape;
}

/**
 * The records the destination lacks. One it holds under the same identity must
 * be the same media, read the same way, or the paste would read something else.
 */
function recordsToAdd(
  state: ProjectState,
  records: readonly AssetRecord[],
): DomainResult<readonly AssetRecord[]> {
  const missing: AssetRecord[] = [];
  for (const record of records) {
    const held = state.project.assets.get(record.asset.id);
    const source = state.sources.get(record.asset.id);
    if (held === undefined || source === undefined) {
      missing.push(record);
      continue;
    }
    const same =
      held.sampleRate === record.asset.sampleRate &&
      layoutsMatch(held.channelLayout, record.asset.channelLayout) &&
      held.length === record.asset.length &&
      canonicalJson(writeMediaSource(source.media)) ===
        canonicalJson(writeMediaSource(record.source.media));
    if (!same) {
      return refused(
        'source-differs',
        `The copied audio reads ${quoted(record.asset.displayName)}, which this project holds with other media.`,
      );
    }
  }
  return succeed(missing);
}

/** The copied plan with the destination's channels. */
function fitted(plan: EditPlan, shape: EditShape): DomainResult<EditPlan> {
  const [stream, ...others] = plan.streams;
  if (layoutsMatch(stream.layout, shape.layout)) return succeed(plan);
  const matrix = conversionMatrix(stream.layout, shape.layout);
  if (!matrix.ok) {
    return refused(
      'layout-differs',
      `The copied audio’s channels cannot be fitted to this audio’s: ${matrix.failures[0].summary}`,
    );
  }
  return succeed({
    streams: [
      {
        ...stream,
        layout: shape.layout,
        segments: stream.segments.map((segment) => ({
          ...segment,
          stages: [...segment.stages, { kind: 'matrix', matrix: matrix.value }],
        })),
      },
      ...others,
    ],
  });
}

/**
 * Whether an insertion of `plan`, converted by version `resampler` of the
 * resampler where one is given, fits in one invocation argument.
 */
function fitsOneArgument(
  plan: EditPlan,
  resampler: number | undefined,
  longestArgument: number,
): boolean {
  const probe: EditOperation = {
    // The longest identity is the one the probe is measured with.
    id: unsafeBrandId<'EditOperationId'>('ffffffff-ffff-4fff-bfff-ffffffffffff'),
    kind: 'insert',
    at: derivedSampleCount(Number.MAX_SAFE_INTEGER),
    payload: plan,
    ...(resampler === undefined ? {} : { resampler }),
  };
  return canonicalJson(writeEditOperation(probe)).length <= longestArgument;
}

/**
 * `plan` in consecutive pieces, each small enough to insert in one argument,
 * split between segments of its first stream; whole where it fits, and refused
 * where it does not and is being converted.
 */
function argumentSized(
  plan: EditPlan,
  resampler: number | undefined,
  longestArgument: number,
): DomainResult<readonly EditPlan[]> {
  if (fitsOneArgument(plan, resampler, longestArgument)) return succeed([plan]);
  if (resampler !== undefined) {
    return refused(
      'too-large-to-convert',
      'The copied audio is too intricate to convert to this audio’s rate in one change. Paste it into audio at its own rate, or copy less of it.',
    );
  }
  const { segments } = plan.streams[0];
  if (segments.length < 2) {
    return refused('too-large', 'The copied audio is too intricate to paste in one change.');
  }
  const middle = Math.floor(segments.length / 2);
  let boundary = 0;
  for (const segment of segments.slice(0, middle)) boundary += segment.length;
  const total = streamLength(plan.streams[0]);
  const halves = [slicePlan(plan, 0, boundary), slicePlan(plan, boundary, total)];
  const pieces: EditPlan[] = [];
  for (const half of halves) {
    if (!half.ok) return half;
    const split = argumentSized(half.value, resampler, longestArgument);
    if (!split.ok) return split;
    pieces.push(...split.value);
  }
  return succeed(pieces);
}
