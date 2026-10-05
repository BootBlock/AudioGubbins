/**
 * What an asset's chain leaves after each operation: its rate, its layout and
 * its length.
 *
 * Every operation's positions are stated in the timeline the operations before
 * it left (ADR-0051), so validating one, and resolving a position stated at a
 * basis, both need the shape at that point in the chain. This is the one place
 * that says how each operation changes it.
 */

import type { ChannelLayout } from '../audio/channel-layout.js';
import type { SampleRate } from '../time/sample-time.js';
import type { Asset } from '../project/asset.js';
import type { EditOperation } from './operations.js';
import { convertedFrameCount, streamLength } from './plan.js';

/** An asset's rate, layout and length at one point in its chain. */
export interface EditShape {
  readonly sampleRate: SampleRate;
  readonly layout: ChannelLayout;
  readonly length: number;
}

/** The shape of an asset's unchanged source. */
export function sourceShape(asset: Asset): EditShape {
  return { sampleRate: asset.sampleRate, layout: asset.channelLayout, length: asset.length };
}

/**
 * How many frames an insertion adds to a timeline at `rate`: its payload's
 * first stream, converted where its rate differs.
 */
export function insertedLength(
  operation: Extract<EditOperation, { readonly kind: 'insert' }>,
  rate: SampleRate,
): number {
  const [stream] = operation.payload.streams;
  const length = streamLength(stream);
  return stream.sampleRate === rate ? length : convertedFrameCount(length, stream.sampleRate, rate);
}

/** The shape after `operation`, which must be valid for `shape`. */
export function shapeAfter(shape: EditShape, operation: EditOperation): EditShape {
  switch (operation.kind) {
    case 'delete':
      return {
        ...shape,
        length: shape.length - (operation.range.end - operation.range.start),
      };
    case 'trim':
      return { ...shape, length: operation.range.end - operation.range.start };
    case 'insert':
      return { ...shape, length: shape.length + insertedLength(operation, shape.sampleRate) };
    case 'convert-layout':
      return { ...shape, layout: operation.layout };
    case 'reverse':
    case 'process':
      return shape;
  }
}

/**
 * The shape before each of the asset's operations and after the last: entry
 * `k` is the timeline operation `k` acts on, and a position stated at basis
 * `k` lies in it.
 */
export function shapesOf(asset: Asset): readonly EditShape[] {
  let shape = sourceShape(asset);
  const shapes: EditShape[] = [shape];
  for (const operation of asset.edits) {
    shape = shapeAfter(shape, operation);
    shapes.push(shape);
  }
  return shapes;
}
