/**
 * The reference vectors Phase 11's runtime is held to (ADR-0104): each
 * vector's log is the simulation's, event for event, and each holds what it
 * says it holds.
 */

import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';

import { PREVIEW_VECTORS, eventSource, vectorInput } from '../testing/preview-vectors.js';
import { simulatePreview } from './preview-simulation.js';

describe('the preview vectors', () => {
  it.each(PREVIEW_VECTORS.map((vector) => [vector.name, vector] as const))(
    '%s: its log is the simulation’s',
    (_name, vector) => {
      const log = expectSuccess(simulatePreview(vectorInput(vector))).log;
      // Written as the calls that make them, so a changed event reads as one.
      expect(log.events.map(eventSource)).toEqual(vector.events.map(eventSource));
      expect(log.events).toEqual(vector.events);
    },
  );

  it('hold every kind of event, refusal and steal', () => {
    const kinds = new Set(
      PREVIEW_VECTORS.flatMap((vector) => vector.events.map((event) => event.kind)),
    );
    expect([...kinds].toSorted()).toEqual([
      'budget-rejected',
      'budget-stolen',
      'ended',
      'rejected',
      'started',
      'stolen',
      'stopped',
      'suppressed',
    ]);
  });
});
