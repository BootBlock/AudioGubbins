/**
 * The edges of a one-shot (ADR-0105): the span its sound and the lead-in and
 * tail before and after it cover, and the trim and fades that make a member
 * that span. A region is trimmed by its own boundaries and faded by its own
 * processing; an asset by trim and fade edits of its chain, each fade on the
 * timeline the trim leaves. A fade already at an edge is not made again.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import {
  derivedSampleCount,
  removalEdits,
  succeed,
  type DomainResult,
  type EditRange,
  type EditTarget,
  type FadeDirection,
  type FadeShape,
  type IdGenerator,
} from '@audiogubbins/domain';
import { silenceRemovals, type AssistantReport } from '@audiogubbins/detection-runtime';
import {
  applyInvocation,
  processTargetInvocation,
  setRegionInvocation,
} from '@audiogubbins/project-commands';

import { timeText } from './durations.js';
import { assetFades, hasFadeAt, regionFades } from './existing-operations.js';
import { spanLength, type MemberSubject } from './workflow-subjects.js';

/** The shapes of the fades in and out. */
export interface FadeShapes {
  readonly in: FadeShape;
  readonly out: FadeShape;
}

/** The span of the member's own timeline its sound and its lead-in and tail cover. */
export function keptSpan(
  report: AssistantReport,
  scope: { readonly range: EditRange; readonly whole: boolean },
  length: number,
  leadIn: number,
  tail: number,
): EditRange {
  const edges = silenceRemovals(report, scope, 'edges');
  const leading = edges.find((range) => range.start === 0);
  const trailing = edges.find((range) => range.end === length);
  return {
    start: derivedSampleCount(Math.max(0, (leading?.end ?? 0) - leadIn)),
    end: derivedSampleCount(Math.min(length, (trailing?.start ?? length) + tail)),
  };
}

/** What one part of preparing a member makes, and what it says. */
export interface Part {
  readonly invocations: readonly CommandInvocation[];
  readonly changes: readonly string[];
}

/** One fade, where `fades` hold none like it. */
function fadePart(
  subject: MemberSubject,
  target: EditTarget,
  direction: FadeDirection,
  shape: FadeShape,
  exists: boolean,
  ids: IdGenerator,
): Part {
  const length = target.range.end - target.range.start;
  if (exists || length === 0) return { invocations: [], changes: [] };
  return {
    invocations: [
      processTargetInvocation(target, ids.next<'EditOperationId'>(), {
        kind: 'fade',
        direction,
        shape,
      }),
    ],
    changes: [
      `Fade "${subject.name}" ${direction} over ${timeText(length, subject.sampleRate)}, ${shape}.`,
    ],
  };
}

/** The trim and the fades of a region, on its asset's timeline. */
export function regionParts(
  subject: MemberSubject,
  kept: EditRange,
  fadeIn: number,
  fadeOut: number,
  shapes: FadeShapes,
  ids: IdGenerator,
): readonly Part[] {
  const { asset, region, span } = subject;
  if (region === undefined) return [];
  const start = span.start + kept.start;
  const end = span.start + kept.end;
  const basis = asset.edits.length;
  const trimmed = start !== span.start || end !== span.end;
  const fades = regionFades(asset, region);
  const target = (from: number, to: number): EditTarget => ({
    kind: 'region',
    asset: asset.id,
    region: region.id,
    basis,
    range: { start: derivedSampleCount(from), end: derivedSampleCount(to) },
  });
  return [
    trimmed
      ? {
          invocations: [
            setRegionInvocation({
              ...region,
              basis,
              start: derivedSampleCount(start),
              end: derivedSampleCount(end),
            }),
          ],
          changes: [
            `Trim "${subject.name}" to its sound: ${timeText(kept.end - kept.start, subject.sampleRate)} kept.`,
          ],
        }
      : { invocations: [], changes: [] },
    fadePart(
      subject,
      target(start, start + fadeIn),
      'in',
      shapes.in,
      hasFadeAt(fades, 'in', start, fadeIn),
      ids,
    ),
    fadePart(
      subject,
      target(end - fadeOut, end),
      'out',
      shapes.out,
      hasFadeAt(fades, 'out', end, fadeOut),
      ids,
    ),
  ];
}

/** The trim edit and the fades of an asset, each on its timeline as the edits before leave it. */
export function assetParts(
  subject: MemberSubject,
  kept: EditRange,
  fadeIn: number,
  fadeOut: number,
  shapes: FadeShapes,
  ids: IdGenerator,
): DomainResult<readonly Part[]> {
  const { asset } = subject;
  const length = spanLength(subject.span);
  const removals: EditRange[] = [];
  if (kept.start > 0) removals.push({ start: derivedSampleCount(0), end: kept.start });
  if (kept.end < length) removals.push({ start: kept.end, end: derivedSampleCount(length) });
  const edits = removalEdits(removals, length);
  if (!edits.ok) return edits;
  const operations = edits.value.map((edit) => ({
    id: ids.next<'EditOperationId'>(),
    kind: edit.kind,
    range: edit.range,
  }));
  const trimmed = { ...asset, edits: [...asset.edits, ...operations] };
  const fades = assetFades(trimmed);
  const keptLength = kept.end - kept.start;
  const target = (from: number, to: number): EditTarget => ({
    kind: 'asset',
    asset: asset.id,
    range: { start: derivedSampleCount(from), end: derivedSampleCount(to) },
  });
  return succeed([
    {
      invocations: operations.map((operation) => applyInvocation(asset, operation)),
      changes:
        operations.length === 0
          ? []
          : [
              `Trim "${subject.name}" to its sound: ${timeText(keptLength, subject.sampleRate)} kept.`,
            ],
    },
    fadePart(subject, target(0, fadeIn), 'in', shapes.in, hasFadeAt(fades, 'in', 0, fadeIn), ids),
    fadePart(
      subject,
      target(keptLength - fadeOut, keptLength),
      'out',
      shapes.out,
      hasFadeAt(fades, 'out', keptLength, fadeOut),
      ids,
    ),
  ]);
}
