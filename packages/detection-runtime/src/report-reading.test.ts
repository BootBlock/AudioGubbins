import { describe, expect, it } from 'vitest';

import { derivedSampleCount, type EditRange, type ProcessorState } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import type { AssistantReport, LearnedState } from './detection-result.js';
import {
  learnedStates,
  silenceRemovals,
  treatmentPlacement,
  type DetectionScope,
} from './report-reading.js';

function range(start: number, end: number): EditRange {
  return { start: derivedSampleCount(start), end: derivedSampleCount(end) };
}

/** A report recommending `steps` step keys, each having learned what `learned` says, taking out `removals`. */
function report(
  options: {
    readonly removals?: readonly EditRange[];
    readonly learned?: readonly LearnedState[];
  } = {},
): AssistantReport {
  const learned = options.learned ?? [];
  return {
    label: 'Silence',
    recommendation: {
      assistant: 'silence',
      detectors: [],
      findings: [],
      steps: learned.map((_, index) => ({ typeKey: `step-${String(index)}`, values: {} })),
      removals: options.removals ?? [],
    },
    learned,
    found: [],
    treated: learned.map(() => []),
  };
}

const SCOPE: DetectionScope = { range: range(100, 1_000), whole: false };

describe('where a recommendation is applied', () => {
  it('is the rack for the whole target, and a rack edit over a range', () => {
    expect(treatmentPlacement({ range: range(0, 1_000), whole: true })).toBe('rack');
    expect(treatmentPlacement(SCOPE)).toBe('range');
  });
});

describe('the silence a report takes out', () => {
  const removals = [range(100, 200), range(400, 500), range(900, 1_000)];

  it('at the edges is what starts or ends where the scope does', () => {
    expect(silenceRemovals(report({ removals }), SCOPE, 'edges')).toEqual([
      range(100, 200),
      range(900, 1_000),
    ]);
  });

  it('within is every other stretch', () => {
    expect(silenceRemovals(report({ removals }), SCOPE, 'within')).toEqual([range(400, 500)]);
  });

  it('both is every stretch, in order', () => {
    expect(silenceRemovals(report({ removals }), SCOPE, 'both')).toEqual(removals);
  });

  it('counts the edges of the scope, not of the audio', () => {
    // From the audio's start, but inside the scope analysed: within it.
    const scope: DetectionScope = { range: range(0, 1_000), whole: true };
    expect(silenceRemovals(report({ removals }), scope, 'edges')).toEqual([range(900, 1_000)]);
  });
});

describe('the states a report’s steps learned', () => {
  const profile: ProcessorState = { kind: 'noise-profile', values: [2_048, 48_000, 1] };

  it('are each step’s state in order, none where its processor reads none', () => {
    const states = learnedStates(
      report({ learned: [{ kind: 'none' }, { kind: 'learned', state: profile }] }),
    );
    expect(expectSuccess(states)).toEqual([undefined, profile]);
  });

  it('are refused with the reason where any step could not learn what it needs', () => {
    const reason = 'This build cannot learn what a "noise-reduction" processor needs.';
    const states = learnedStates(
      report({
        learned: [
          { kind: 'learned', state: profile },
          { kind: 'refused', reason },
        ],
      }),
    );
    expect(states.ok ? [] : states.failures).toMatchObject([
      { code: 'detection.state-not-learned', summary: reason },
    ]);
  });
});
