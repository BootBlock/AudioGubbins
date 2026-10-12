/**
 * Where each spectral edit of an asset applies, on the timeline a view of it
 * shows (ADR-0082): the outline the editor draws of each, distinct from the
 * selection.
 *
 * A spectral edit's mask is stated relative to the start of its operation's
 * range, on the timeline its operation was made on. Every point of it is
 * carried through the operations after it as a marker is (ADR-0051), so the
 * outline follows the sound the edit changed through a deletion before it, an
 * insertion, a reversal or a stretch; a rectangle's range is carried as a
 * span, which a reversal turns round. Only positions move: the mask's
 * frequencies, softness and strengths are the edit's own. The outline is
 * worked out once for each state of the asset, as its markers are.
 */

import {
  Affinity,
  anchorResolver,
  derivedSampleCount,
  type AnchorResolver,
  type Span,
  type EditOperation,
  type SpectralEdit,
  type SpectralMask,
  type SpectralPoint,
  type SpectralShape,
} from '@audiogubbins/domain';
import type { SpectralEditOutline } from '@audiogubbins/editor-view';

import type { ProjectOwner } from '../assets/editor-asset.js';

/** An operation of the chain that carries a spectral edit. */
type SpectralOperation = Extract<EditOperation, { readonly kind: 'process' }> & {
  readonly edit: SpectralEdit;
};

function isSpectral(operation: EditOperation): operation is SpectralOperation {
  return operation.kind === 'process' && operation.edit.kind === 'spectral';
}

/**
 * How the positions of an edit's mask are carried: from where its range
 * began when it was made, at `basis`, to where it begins now, `span.start`.
 */
interface Carrying {
  readonly resolver: AnchorResolver;
  readonly basis: number;
  /** Where the edit's range began on the timeline it was made on. */
  readonly start: number;
  /** Where the edit's range lies now. */
  readonly span: Span;
}

/**
 * `position`, relative to the start of the edit's range, carried to the
 * timeline as it stands and stated relative to where the range begins now,
 * which no carried position precedes, since carrying keeps the order of what
 * it moves.
 */
function carried({ resolver, basis, start, span }: Carrying, position: number): number {
  return (resolver.position(basis, start + position, Affinity.After) ?? span.start) - span.start;
}

/** `shape` with its positions carried as `carrying` says. */
function carriedShape(carrying: Carrying, shape: SpectralShape): SpectralShape {
  const point = <P extends SpectralPoint>(one: P): P => ({
    ...one,
    position: derivedSampleCount(carried(carrying, one.position)),
  });
  switch (shape.kind) {
    case 'rectangle': {
      // Carried as a span, which a reversal turns round.
      const { resolver, basis, start, span } = carrying;
      const range =
        resolver.span(basis, { start: start + shape.range.start, end: start + shape.range.end }) ??
        span;
      return {
        ...shape,
        range: {
          start: derivedSampleCount(range.start - span.start),
          end: derivedSampleCount(range.end - span.start),
        },
      };
    }
    case 'polygon': {
      const [a, b, c, ...rest] = shape.points;
      return { ...shape, points: [point(a), point(b), point(c), ...rest.map(point)] };
    }
    case 'stroke': {
      const [first, ...rest] = shape.points;
      return { ...shape, points: [point(first), ...rest.map(point)] };
    }
  }
}

/** The outline of the spectral edit `operation`, made at `basis`, on the edited timeline. */
function outlineOf(
  resolver: AnchorResolver,
  basis: number,
  operation: SpectralOperation,
  offset: number,
): SpectralEditOutline | undefined {
  const start = operation.range.start;
  const span = resolver.span(basis, { start, end: operation.range.end });
  if (span === undefined) return undefined;
  const carrying: Carrying = { resolver, basis, start, span };
  const moved = (shape: SpectralShape): SpectralShape => carriedShape(carrying, shape);
  const { mask } = operation.edit;
  const [first, ...rest] = mask.shapes;
  const placed: SpectralMask = {
    feather: mask.feather,
    shapes: [moved(first), ...rest.map(moved)],
  };
  return {
    mask: placed,
    from: span.start - offset,
    ...(operation.channels === undefined ? {} : { channels: operation.channels }),
  };
}

/** Where an asset's view starts on its edited timeline, and the asset. */
type ViewedAsset = Pick<ProjectOwner, 'asset' | 'offset'>;

/** Each viewed asset's outlines, worked out once for each state of it. */
const OUTLINES = new WeakMap<ViewedAsset, readonly SpectralEditOutline[]>();

/** Where each spectral edit of `viewed.asset` applies, on the timeline its view shows. */
export function spectralEditOutlines(viewed: ViewedAsset): readonly SpectralEditOutline[] {
  const known = OUTLINES.get(viewed);
  if (known !== undefined) return known;
  const resolver = anchorResolver(viewed.asset);
  const outlines: SpectralEditOutline[] = [];
  viewed.asset.edits.forEach((operation, basis) => {
    if (!isSpectral(operation)) return;
    const outline = outlineOf(resolver, basis, operation, viewed.offset);
    if (outline !== undefined) outlines.push(outline);
  });
  OUTLINES.set(viewed, outlines);
  return outlines;
}
