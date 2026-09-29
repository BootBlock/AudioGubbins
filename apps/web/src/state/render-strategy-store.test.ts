import { describe, expect, it } from 'vitest';

import { sampleCount, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  PRESET_SETTINGS,
  PerformanceProfile,
  ProcessingMode,
  assessRender,
} from '@audiogubbins/audio-engine';

import {
  PlanningStage,
  awaitingDecision,
  createRenderStrategyStore,
  type ContestedAssessment,
} from './render-strategy-store.js';

/** A render of ten seconds chosen in the foreground over a warning that the processor is too slow. */
function contested(): ContestedAssessment {
  const assessment = expectSuccess(
    assessRender({
      frames: expectSuccess(sampleCount(480_000)),
      channels: 2,
      sampleRate: expectSuccess(sampleRate(48_000)),
      settings: PRESET_SETTINGS[PerformanceProfile.Balanced],
      measuredCostRatio: 2,
      override: ProcessingMode.FinalOffline,
    }),
  );
  const { safer } = assessment;
  if (safer === undefined) throw new Error('The assessment offered no safer strategy.');
  return { ...assessment, safer };
}

describe('the planning of renders', () => {
  it('starts with nothing planned and nothing measured', () => {
    expect(createRenderStrategyStore().get()).toEqual({
      planning: { stage: PlanningStage.None },
      measuredCostRatio: undefined,
    });
  });

  it('holds a render waiting on a decision until it is decided', () => {
    const store = createRenderStrategyStore();
    const assessment = contested();

    store.awaitDecision(assessment);
    expect(awaitingDecision(store.get())).toBe(assessment);

    store.decide(assessment.safer);
    expect(awaitingDecision(store.get())).toBeUndefined();
    expect(store.get().planning).toEqual({
      stage: PlanningStage.Decided,
      strategy: assessment.safer,
    });
  });

  it('keeps what the last render measured across the renders after it', () => {
    const store = createRenderStrategyStore();
    store.measured(0.25);
    store.awaitDecision(contested());
    expect(store.get().measuredCostRatio).toBe(0.25);
  });
});
