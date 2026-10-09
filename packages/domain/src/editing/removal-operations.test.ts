import { describe, expect, it } from 'vitest';

import { operationId, range } from '../testing/editing-fixtures.js';
import { applyEdit, type Samples } from '../testing/edit-oracle.js';
import { expectFailureCode, expectSuccess } from '../testing/unwrap.js';
import { removalEdits } from './removal-operations.js';

const LENGTH = 100;

/** Two channels whose every sample is its own frame, so what is left says what was taken. */
const SOURCE: Samples = [
  Float32Array.from({ length: LENGTH }, (_, frame) => frame),
  Float32Array.from({ length: LENGTH }, (_, frame) => -frame),
];

/** The samples left once `removals` are taken out of {@link SOURCE} by the edits they make. */
function leftAfter(removals: readonly (readonly [number, number])[]): readonly number[] {
  const edits = expectSuccess(
    removalEdits(
      removals.map(([start, end]) => range(start, end)),
      LENGTH,
    ),
  );
  let samples = SOURCE;
  for (const [index, edit] of edits.entries()) {
    samples = applyEdit(samples, { id: operationId(`removal-${String(index)}`), ...edit });
  }
  expect([...(samples[1] ?? [])]).toEqual([...(samples[0] ?? [])].map((frame) => -frame));
  return [...(samples[0] ?? [])];
}

/** The frames of {@link SOURCE} outside `removals`. */
function outside(removals: readonly (readonly [number, number])[]): readonly number[] {
  return [...(SOURCE[0] ?? [])].filter(
    (frame) => !removals.some(([start, end]) => frame >= start && frame < end),
  );
}

describe('taking spans out of a timeline by trim and delete', () => {
  it('takes out exactly the spans, at the edges, within and both, applied in order', () => {
    for (const removals of [
      [[0, 10]],
      [[90, 100]],
      [[20, 30]],
      [
        [0, 5],
        [40, 45],
        [60, 70],
        [95, 100],
      ],
      [
        [10, 20],
        [21, 22],
        [80, 100],
      ],
    ] as const) {
      expect(leftAfter(removals), JSON.stringify(removals)).toEqual(outside(removals));
    }
  });

  it('trims the edges in one edit after the deletes within, and deletes the last span first', () => {
    const edits = expectSuccess(
      removalEdits([range(0, 5), range(40, 45), range(60, 70), range(95, 100)], LENGTH),
    );
    expect(edits).toEqual([
      { kind: 'delete', range: range(60, 70) },
      { kind: 'delete', range: range(40, 45) },
      { kind: 'trim', range: range(5, 80) },
    ]);
  });

  it('refuses spans that would leave nothing, overlap, run backwards or lie outside', () => {
    expect(expectFailureCode(removalEdits([range(0, LENGTH)], LENGTH))).toBe(
      'editing.removal-leaves-nothing',
    );
    expect(expectFailureCode(removalEdits([range(0, 50), range(50, LENGTH)], LENGTH))).toBe(
      'editing.removal-order',
    );
    expect(expectFailureCode(removalEdits([range(30, 40), range(10, 20)], LENGTH))).toBe(
      'editing.removal-order',
    );
    expect(expectFailureCode(removalEdits([range(90, 110)], LENGTH))).toBe(
      'editing.removal-outside',
    );
    expect(expectFailureCode(removalEdits([range(20, 20)], LENGTH))).toBe('editing.removal-empty');
  });
});
