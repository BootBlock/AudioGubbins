/**
 * Folding an asset's chain into its edit plan (ADR-0051, ADR-0060).
 *
 * The plan starts as one segment reading the whole unchanged source, and each
 * operation in order changes the first stream's segments: a deletion, a trim
 * and a reversal cut and reorder them, a level or channel edit adds a stage to
 * those it covers, a layout conversion adds a matrix to all of them, and an
 * insertion splices in its payload, or one segment reading it converted where
 * its rate differs. A rack edit, a spectral edit, a stretch and a conversion
 * of rate each move segments into a stream of their own that the first stream
 * reads processed (`processed-streams.ts`). A chain is validated before it is
 * folded (`operation-validation.ts`), so this fold assumes every position lies
 * where its operation says.
 *
 * A region's own processing is folded in among the chain, each operation just
 * before the asset's operation its basis counts to, on the timeline it was
 * placed on. Its stages are then in content frames like any other, so a later
 * cut, paste or reversal moves them with the content and never remakes them
 * from where the range has since been carried.
 *
 * The asset's rack then processes the whole of what the fold made, so it
 * follows the asset through every edit.
 */

import { channelCount, layoutsMatch } from '../audio/channel-layout.js';
import type { EffectChainId } from '../identity/branded-id.js';
import { chainOutputLayout } from '../processing/chain-validation.js';
import type { EffectChain } from '../processing/effect-chain.js';
import type { Asset } from '../project/asset.js';
import type { PlannedSpectralEdit, SpectralEdit } from '../spectral/spectral-edit.js';
import { FailureKind, fail, failure, mapResult, succeed, type DomainResult } from '../result.js';
import { derivedSampleCount } from '../time/sample-time.js';
import { versionKnown } from './algorithm-version.js';
import { insertedLength } from './edit-shape.js';
import type { EditOperation, EngineVersions, RangeEdit, RegionOperation } from './operations.js';
import type { EditPlan, PlanSegment } from './plan.js';
import {
  convertWhole,
  lengthOf,
  rackRange,
  rackWhole,
  spectralRange,
  stretchRange,
  type Folding,
} from './processed-streams.js';
import type { PlanContext } from './plan-context.js';
import { punchRange } from './punch-fold.js';
import { rangeEditStage } from './range-stages.js';
import { changeRange, reverseRange, sliceSegments } from './segment-list.js';
import { pruneStreams, shiftStreams } from './stream-tables.js';

/** A range edit on the first stream: the asset's own processing, or a region's. */
type Processing = Pick<RegionOperation, 'range' | 'channels' | 'edit'>;

/**
 * How a fold treats a rack edit: its chain run over its range, read from the
 * project's chains, or bypassed, the range left as the edits before it made
 * it, which is the sound with its processing bypassed (REQ-AUDIO-019).
 */
interface RangeRacks {
  readonly kind: 'run' | 'bypassed';
  readonly context: PlanContext;
}

/** The chain an edit or a rack names, or why the project does not have it. */
function namedChain(context: PlanContext, id: EffectChainId): DomainResult<EffectChain> {
  const chain = context.chains.get(id);
  return chain === undefined
    ? fail(
        failure(
          'editing.chain-missing',
          FailureKind.IntegrityViolation,
          'The audio names a chain of processors the project does not have.',
          { details: { chain: id } },
        ),
      )
    : succeed(chain);
}

/** A chain that a range is processed through keeping its layout, or why it cannot be. */
function rangeChain(
  folding: Folding,
  id: EffectChainId,
  context: PlanContext,
): DomainResult<EffectChain> {
  const { stream } = folding;
  const chain = namedChain(context, id);
  if (!chain.ok) return chain;
  const layout = chainOutputLayout(
    chain.value,
    context.catalogue,
    stream.layout,
    stream.sampleRate,
  );
  if (!layout.ok) return layout;
  if (!layoutsMatch(layout.value, stream.layout)) {
    return fail(
      failure(
        'editing.rack-changes-layout',
        FailureKind.Rejected,
        'A chain applied to a range must keep the audio’s channels; give it to the whole asset or region as its rack instead.',
        { details: { chain: id } },
      ),
    );
  }
  return chain;
}

/** A spectral edit as the plan carries it, its chain read from the project where it names one. */
function plannedSpectralEdit(
  edit: SpectralEdit,
  channels: readonly number[] | undefined,
  folding: Folding,
  context: PlanContext,
): DomainResult<PlannedSpectralEdit> {
  const scope = channels === undefined ? {} : { channels };
  const { operation } = edit;
  if (operation.kind !== 'process') {
    return succeed({ mask: edit.mask, resolution: edit.resolution, operation, ...scope });
  }
  return mapResult(rangeChain(folding, operation.chain, context), (chain) => ({
    mask: edit.mask,
    resolution: edit.resolution,
    operation: { kind: 'process', chain, input: folding.stream.layout },
    ...scope,
  }));
}

/** The folding with `processing` applied over its range of the first stream. */
function processRange(
  folding: Folding,
  processing: Processing,
  racks: RangeRacks,
): DomainResult<Folding> {
  const { stream } = folding;
  const { range } = processing;
  const edit: RangeEdit = processing.edit;
  if (edit.kind === 'punch') return punchRange(folding, range, edit, racks.context);
  if (edit.kind === 'spectral') {
    // A spectral edit changes no time and keeps the layout, so leaving it out
    // leaves every later edit where it was made, as a rack edit's does.
    if (racks.kind === 'bypassed') return succeed(folding);
    return mapResult(
      plannedSpectralEdit(edit, processing.channels, folding, racks.context),
      (planned) => spectralRange(folding, range.start, range.end, planned),
    );
  }
  if (edit.kind !== 'rack') {
    const stage = rangeEditStage(edit, range, processing.channels, channelCount(stream.layout));
    return succeed({
      ...folding,
      stream: { ...stream, segments: changeRange(stream.segments, range.start, range.end, stage) },
    });
  }
  // A rack edit changes no time and keeps the layout, so leaving it out
  // leaves every later edit where it was made.
  if (racks.kind === 'bypassed') return succeed(folding);
  return mapResult(rangeChain(folding, edit.chain, racks.context), (chain) =>
    rackRange(folding, range.start, range.end, chain),
  );
}

/** The first stream's segments after an operation that only cuts or turns them. */
function cutSegments(
  segments: readonly PlanSegment[],
  operation: Extract<EditOperation, { readonly kind: 'delete' | 'trim' | 'reverse' }>,
): PlanSegment[] {
  const total = lengthOf(segments);
  const { start, end } = operation.range;
  switch (operation.kind) {
    case 'delete':
      return [...sliceSegments(segments, 0, start), ...sliceSegments(segments, end, total)];
    case 'trim':
      return sliceSegments(segments, start, end);
    case 'reverse':
      return reverseRange(segments, start, end, total);
  }
}

/** The plan with `operation` folded into it. */
function foldOperation(
  plan: Folding,
  operation: EditOperation,
  racks: RangeRacks,
): DomainResult<Folding> {
  const { stream } = plan;
  switch (operation.kind) {
    case 'convert-layout':
      return succeed({
        ...plan,
        stream: {
          ...stream,
          layout: operation.layout,
          segments: stream.segments.map((segment) => ({
            ...segment,
            stages: [...segment.stages, { kind: 'matrix', matrix: operation.matrix }],
          })),
        },
      });
    case 'insert':
      return foldInsertion(plan, operation, racks.context.engine);
    case 'process':
      return processRange(plan, operation, racks);
    case 'stretch':
      return mapResult(
        versionKnown('stretch', operation.version, racks.context.engine.stretch),
        () => stretchRange(plan, operation.range.start, operation.range.end, operation.length),
      );
    case 'convert-rate':
      return mapResult(
        versionKnown('resampler', operation.version, racks.context.engine.resampler),
        () => convertWhole(plan, operation.sampleRate),
      );
    case 'delete':
    case 'trim':
    case 'reverse':
      return succeed({
        ...plan,
        stream: { ...stream, segments: cutSegments(stream.segments, operation) },
      });
  }
}

/**
 * The plan with a payload spliced in, or why it cannot be: a payload at
 * another rate converted by a version of the resampler this build does not
 * have. The payload's streams join the plan's after those already there,
 * renumbered, so a segment still reads only a stream after its own.
 */
function foldInsertion(
  plan: Folding,
  operation: Extract<EditOperation, { readonly kind: 'insert' }>,
  engine: EngineVersions,
): DomainResult<Folding> {
  const { stream } = plan;
  const total = lengthOf(stream.segments);
  const converted = operation.payload.streams[0].sampleRate !== stream.sampleRate;
  if (converted) {
    const known = versionKnown('resampler', operation.resampler, engine.resampler);
    if (!known.ok) return known;
  }
  // Converted, the payload's first stream becomes a stream of the plan, read
  // by one segment; otherwise its segments are spliced in and only the rest
  // join. Either way each keeps its place relative to the others.
  const next = 1 + plan.others.length;
  const [first, ...rest] = shiftStreams(operation.payload.streams, converted ? next : next - 1);
  const inserted: readonly PlanSegment[] = converted
    ? [
        {
          source: { kind: 'stream', stream: next },
          start: derivedSampleCount(0),
          length: derivedSampleCount(insertedLength(operation, stream.sampleRate)),
          reversed: false,
          stages: [],
        },
      ]
    : first.segments;
  return succeed({
    stream: {
      ...stream,
      segments: [
        ...sliceSegments(stream.segments, 0, operation.at),
        ...inserted,
        ...sliceSegments(stream.segments, operation.at, total),
      ],
    },
    others: converted ? [...plan.others, first, ...rest] : [...plan.others, ...rest],
  });
}

/** `processing` by the basis it is placed at, each basis's in the order given. */
function byBasis(
  asset: Asset,
  processing: readonly RegionOperation[],
): ReadonlyMap<number, readonly RegionOperation[]> {
  const placed = new Map<number, RegionOperation[]>();
  for (const operation of processing) {
    const { basis } = operation;
    // A basis the chain does not have names no timeline to fold at, so it is
    // left out, as validation refuses it.
    if (!Number.isInteger(basis) || basis < 0 || basis > asset.edits.length) continue;
    placed.set(basis, [...(placed.get(basis) ?? []), operation]);
  }
  return placed;
}

/** The fold of the asset's chain with `processing` among it, before any rack. */
function editedPlan(
  asset: Asset,
  processing: readonly RegionOperation[],
  racks: RangeRacks,
): DomainResult<EditPlan> {
  let folding: Folding = {
    stream: {
      sampleRate: asset.sampleRate,
      layout: asset.channelLayout,
      segments: [
        {
          source: { kind: 'media', asset: asset.id },
          start: derivedSampleCount(0),
          length: asset.length,
          reversed: false,
          stages: [],
        },
      ],
    },
    others: [],
  };
  const placed = byBasis(asset, processing);
  for (let basis = 0; basis <= asset.edits.length; basis += 1) {
    for (const operation of placed.get(basis) ?? []) {
      const folded = processRange(folding, operation, racks);
      if (!folded.ok) return folded;
      folding = folded.value;
    }
    const operation = asset.edits[basis];
    if (operation === undefined) continue;
    const folded = foldOperation(folding, operation, racks);
    if (!folded.ok) return folded;
    folding = folded.value;
  }
  return succeed({ streams: [folding.stream, ...folding.others] });
}

/** The plan with its whole sound through the rack `rack`, where one is named. */
export function withRack(
  plan: EditPlan,
  rack: EffectChainId | undefined,
  context: PlanContext,
): DomainResult<EditPlan> {
  if (rack === undefined) return succeed(plan);
  const chain = namedChain(context, rack);
  if (!chain.ok) return chain;
  return mapResult(
    chainOutputLayout(
      chain.value,
      context.catalogue,
      plan.streams[0].layout,
      plan.streams[0].sampleRate,
    ),
    (layout) => rackWhole(plan, chain.value, layout),
  );
}

/**
 * The plan of an asset before its rack: its chain, with a region's
 * `processing` folded in among it where given. What a rack edit over a range
 * of it reads, since a rack edit acts before the rack (ADR-0060's order).
 */
export function unrackedAssetPlan(
  asset: Asset,
  context: PlanContext,
  processing: readonly RegionOperation[] = [],
): DomainResult<EditPlan> {
  return mapResult(editedPlan(asset, processing, { kind: 'run', context }), pruneStreams);
}

/**
 * The plan of an asset with every chain it runs bypassed and every other edit
 * kept, with a region's `processing` folded in among it where given: its rack
 * edits leave their ranges as they were, and its rack is not run. What the
 * original sound is, beside the processed one, for comparing the two
 * (REQ-AUDIO-019). A region's is `bypassedRegionPlan`.
 */
export function bypassedAssetPlan(
  asset: Asset,
  context: PlanContext,
  processing: readonly RegionOperation[] = [],
): DomainResult<EditPlan> {
  return mapResult(editedPlan(asset, processing, { kind: 'bypassed', context }), pruneStreams);
}

/**
 * The plan of an asset as it stands: its chain, with a region's `processing`
 * folded in among it where given, then its rack, with no stream nothing reads.
 */
export function assetPlan(
  asset: Asset,
  context: PlanContext,
  processing: readonly RegionOperation[] = [],
): DomainResult<EditPlan> {
  const edited = editedPlan(asset, processing, { kind: 'run', context });
  if (!edited.ok) return edited;
  return mapResult(withRack(edited.value, asset.rack, context), pruneStreams);
}
