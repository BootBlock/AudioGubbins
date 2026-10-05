/**
 * Folding an asset's chain into its edit plan (ADR-0051).
 *
 * The plan starts as one segment reading the whole unchanged source, and each
 * operation in order changes the first stream's segments: a deletion, a trim
 * and a reversal cut and reorder them, a range edit adds a stage to those it
 * covers, a layout conversion adds a matrix to all of them, and an insertion
 * splices in its payload, or one segment reading it converted where its rate
 * differs. A chain is validated before it is folded
 * (`operation-validation.ts`), so this fold assumes every position lies where
 * its operation says.
 *
 * A region's own processing is folded in among the chain, each operation just
 * before the asset's operation its basis counts to, on the timeline it was
 * placed on. Its stages are then in content frames like any other, so a later
 * cut, paste or reversal moves them with the content and never remakes them
 * from where the range has since been carried.
 */

import type { Asset } from '../project/asset.js';
import { derivedSampleCount } from '../time/sample-time.js';
import { channelCount } from '../audio/channel-layout.js';
import type { EditOperation, RegionOperation } from './operations.js';
import { insertedLength } from './edit-shape.js';
import type { EditPlan, PlanSegment, PlanStream } from './plan.js';
import { changeRange, reverseRange, sliceSegments } from './segment-list.js';
import { rangeEditStage } from './range-stages.js';
import { pruneStreams, shiftStreams } from './stream-tables.js';

/** The plan being folded: its first stream's segments and every other stream. */
interface Folding {
  readonly stream: PlanStream;
  readonly others: readonly PlanStream[];
}

/** The total length of a list of segments. */
function lengthOf(segments: readonly PlanSegment[]): number {
  let length = 0;
  for (const segment of segments) length += segment.length;
  return length;
}

/** An operation that changes only the first stream's segments. */
type SegmentOperation = Exclude<EditOperation, { readonly kind: 'insert' | 'convert-layout' }>;

/** A range edit on the first stream: the asset's own processing, or a region's. */
type Processing = Pick<RegionOperation, 'range' | 'channels' | 'edit'>;

/** The first stream's segments with `processing` as a stage on each segment it covers. */
function processedSegments(stream: PlanStream, processing: Processing): PlanSegment[] {
  const { range } = processing;
  return changeRange(
    stream.segments,
    range.start,
    range.end,
    rangeEditStage(processing.edit, range, processing.channels, channelCount(stream.layout)),
  );
}

/** The first stream's segments with `operation` applied to them. */
function segmentsAfter(
  stream: PlanStream,
  operation: SegmentOperation,
  total: number,
): PlanSegment[] {
  const { segments } = stream;
  const { start, end } = operation.range;
  switch (operation.kind) {
    case 'delete':
      return [...sliceSegments(segments, 0, start), ...sliceSegments(segments, end, total)];
    case 'trim':
      return sliceSegments(segments, start, end);
    case 'reverse':
      return reverseRange(segments, start, end, total);
    case 'process':
      return processedSegments(stream, operation);
  }
}

/** The plan with `operation` folded into it. */
function foldOperation(plan: Folding, operation: EditOperation): Folding {
  const { stream } = plan;
  const total = lengthOf(stream.segments);
  switch (operation.kind) {
    case 'convert-layout':
      return {
        ...plan,
        stream: {
          ...stream,
          layout: operation.layout,
          segments: stream.segments.map((segment) => ({
            ...segment,
            stages: [...segment.stages, { kind: 'matrix', matrix: operation.matrix }],
          })),
        },
      };
    case 'insert':
      return foldInsertion(plan, operation, total);
    default:
      return { ...plan, stream: { ...stream, segments: segmentsAfter(stream, operation, total) } };
  }
}

/**
 * The plan with a payload spliced in. The payload's streams join the plan's
 * after those already there, renumbered, so a segment still reads only a
 * stream after its own.
 */
function foldInsertion(
  plan: Folding,
  operation: Extract<EditOperation, { readonly kind: 'insert' }>,
  total: number,
): Folding {
  const { stream } = plan;
  const converted = operation.payload.streams[0].sampleRate !== stream.sampleRate;
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
  return {
    stream: {
      ...stream,
      segments: [
        ...sliceSegments(stream.segments, 0, operation.at),
        ...inserted,
        ...sliceSegments(stream.segments, operation.at, total),
      ],
    },
    others: converted ? [...plan.others, first, ...rest] : [...plan.others, ...rest],
  };
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

/**
 * The plan of an asset's chain as it stands, with a region's `processing`
 * folded in among it where given, and no stream nothing reads.
 */
export function assetPlan(asset: Asset, processing: readonly RegionOperation[] = []): EditPlan {
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
      folding = {
        ...folding,
        stream: { ...folding.stream, segments: processedSegments(folding.stream, operation) },
      };
    }
    const operation = asset.edits[basis];
    if (operation !== undefined) folding = foldOperation(folding, operation);
  }
  return pruneStreams({ streams: [folding.stream, ...folding.others] });
}
