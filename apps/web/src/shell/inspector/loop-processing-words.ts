/**
 * The words for how a loop renders the effects upstream of it (ADR-0107): the
 * Inspector's choice and the reason it gives where the loop cannot render as
 * chosen, and the Loop panel's explanation of a seam fault that comes from
 * running the effects from the region's start. Both read the domain's one
 * answer (`loopRendering`), so what the person is told is what is heard.
 */

import { ProcessingAcrossLoop, type LoopRendering } from '@audiogubbins/domain';

const LIST = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' });

/** What the Inspector's choice of how a loop renders its effects is called. */
export const PROCESSING_ACROSS_LOOP_LABEL = 'Effects across the loop';

/** Each way a loop renders its effects, as the Inspector offers it. */
export const PROCESSING_ACROSS_LOOP_NAMES: ReadonlyMap<ProcessingAcrossLoop, string> = new Map([
  [ProcessingAcrossLoop.Wrapped, 'Carried over from the loop’s end'],
  [ProcessingAcrossLoop.FromStart, 'From the region’s start'],
]);

/** `processors`, named, as the subject of a sentence about measuring. */
function measuring(processors: readonly string[]): string {
  const names = LIST.format(processors);
  return processors.length === 1
    ? `${names} measures the whole of its input`
    : `${names} measure the whole of their input`;
}

/**
 * What the Inspector says of a loop rendered as `rendering`, where the choice
 * is not simply what is heard: nothing upstream that the choice changes, or a
 * processor that keeps the loop from carrying its effects over. Nothing where
 * the loop renders as chosen.
 */
export function loopRenderingNote(rendering: LoopRendering): string | undefined {
  if (rendering.kind === 'wrapped') return undefined;
  const { cause } = rendering;
  switch (cause.kind) {
    case 'chosen':
      return undefined;
    case 'unprocessed':
      return 'No effect processes this region, so either choice sounds the same.';
    case 'whole-pass':
      return `Its effects run from the region’s start: ${measuring(cause.processors)}, so the loop cannot carry them over from its end.`;
  }
}

/**
 * Why a loop's seam may warn or fail where its effects run from the region's
 * start (ADR-0107): the head of the loop carries the tail of the audio before
 * it, and, where the person chose it, that the loop can carry its effects over
 * instead. Nothing where the effects are carried over or nothing processes.
 */
export function seamCauseWords(rendering: LoopRendering): string | undefined {
  if (rendering.kind === 'wrapped') return undefined;
  const { cause } = rendering;
  const head =
    'Its effects run from the region’s start, so the head of the loop carries the tail of the audio before it, not of its own end.';
  switch (cause.kind) {
    case 'unprocessed':
      return undefined;
    case 'chosen':
      return `${head} Set “${PROCESSING_ACROSS_LOOP_LABEL}” to “${PROCESSING_ACROSS_LOOP_NAMES.get(ProcessingAcrossLoop.Wrapped) ?? ''}” in the Inspector to hear the loop as it repeats.`;
    case 'whole-pass':
      return `${head} They cannot be carried over from its end, since ${measuring(cause.processors)}.`;
  }
}
