/**
 * Folding an asset's chain into its edit plan (ADR-0051).
 *
 * The plan starts as one segment reading the whole unchanged source, and each
 * operation in order changes the first stream's segments: a deletion, a trim
 * and a reversal cut and reorder them, a range edit adds a stage to those it
 * covers, a layout conversion adds a matrix to all of them, and an insertion
 * splices in its payload, or one segment reading it converted where its rate
 * differs. A chain is validated before it is folded (`operation-validation.ts`),
 * so this fold assumes every position lies where its operation says.
 */

import type { Asset } from '../project/asset.js';
import { derivedSampleCount } from '../time/sample-time.js';
import { channelCount } from '../audio/channel-layout.js';
import type { EditOperation } from './operations.js';
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

/** The plan with `operation` folded into it. */
function foldOperation(plan: Folding, operation: EditOperation): Folding {
  const { stream } = plan;
  const total = lengthOf(stream.segments);
  const withSegments = (segments: PlanSegment[]): Folding => ({
    ...plan,
    stream: { ...stream, segments },
  });
  switch (operation.kind) {
    case 'delete':
      return withSegments([
        ...sliceSegments(stream.segments, 0, operation.range.start),
        ...sliceSegments(stream.segments, operation.range.end, total),
      ]);
    case 'trim':
      return withSegments(
        sliceSegments(stream.segments, operation.range.start, operation.range.end),
      );
    case 'reverse':
      return withSegments(
        reverseRange(stream.segments, operation.range.start, operation.range.end, total),
      );
    case 'process':
      return withSegments(
        changeRange(
          stream.segments,
          operation.range.start,
          operation.range.end,
          rangeEditStage(
            operation.edit,
            operation.range,
            operation.channels,
            channelCount(stream.layout),
          ),
        ),
      );
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

/** The plan of an asset's chain as it stands, with no stream nothing reads. */
export function assetPlan(asset: Asset): EditPlan {
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
  for (const operation of asset.edits) folding = foldOperation(folding, operation);
  return pruneStreams({ streams: [folding.stream, ...folding.others] });
}
