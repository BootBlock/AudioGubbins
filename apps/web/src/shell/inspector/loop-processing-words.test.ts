import { describe, expect, it } from 'vitest';

import type { LoopRendering } from '@audiogubbins/domain';

import { loopRenderingNote, seamCauseWords } from './loop-processing-words.js';

const WRAPPED: LoopRendering = { kind: 'wrapped', racks: [] };
const CHOSEN: LoopRendering = { kind: 'from-start', cause: { kind: 'chosen' } };
const UNPROCESSED: LoopRendering = { kind: 'from-start', cause: { kind: 'unprocessed' } };

function measuring(...processors: readonly string[]): LoopRendering {
  return { kind: 'from-start', cause: { kind: 'whole-pass', processors } };
}

describe('the words for how a loop renders its effects (ADR-0107)', () => {
  it('notes in the Inspector only a loop not heard as chosen', () => {
    expect(loopRenderingNote(WRAPPED)).toBeUndefined();
    expect(loopRenderingNote(CHOSEN)).toBeUndefined();
    expect(loopRenderingNote(UNPROCESSED)).toBe(
      'No effect processes this region, so either choice sounds the same.',
    );
    expect(loopRenderingNote(measuring('Peak normalisation', 'Loudness normalisation'))).toBe(
      'Its effects run from the region’s start: Peak normalisation and Loudness normalisation measure the whole of their input, so the loop cannot carry them over from its end.',
    );
  });

  it('explains a seam fault only where effects run from the region’s start', () => {
    expect(seamCauseWords(WRAPPED)).toBeUndefined();
    expect(seamCauseWords(UNPROCESSED)).toBeUndefined();
    expect(seamCauseWords(CHOSEN)).toMatch(
      /Set “Effects across the loop” to “Carried over from the loop’s end” in the Inspector/u,
    );
    expect(seamCauseWords(measuring('Loudness normalisation'))).toBe(
      'Its effects run from the region’s start, so the head of the loop carries the tail of the audio before it, not of its own end. They cannot be carried over from its end, since Loudness normalisation measures the whole of its input.',
    );
  });
});
