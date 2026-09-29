/**
 * How the latest offline render was planned to run, and what the machine
 * measured of the last one: the processing mode chosen and why
 * (REQ-ARCH-079), the priority it queues at (REQ-ARCH-084), and what its
 * resources warned of (REQ-ARCH-087).
 *
 * Its own partition, apart from the render's progress in the engine's view,
 * because it outlives a render: the cost measured by one render is what the
 * next is planned by, and a render waiting on the person's decision has not
 * started at all. The render control reports here; the panel reads it.
 */

import type { RenderAssessment, RenderStrategy } from '@audiogubbins/audio-engine';

import { observable, type Observable } from './observable.js';

/** How far planning the latest render has got. */
export const PlanningStage = {
  /** No render has been asked for. */
  None: 'none',
  /**
   * The resources warned of something, and the render waits for the person to
   * choose between the strategy chosen and the safer one the warning offers.
   */
  AwaitingDecision: 'awaiting-decision',
  /** The render runs, or ran, under `strategy`. */
  Decided: 'decided',
} as const;

/** How far planning the latest render has got. */
export type PlanningStage = (typeof PlanningStage)[keyof typeof PlanningStage];

/** A render's assessment where a warning offers a safer strategy than the one chosen. */
export type ContestedAssessment = RenderAssessment & { readonly safer: RenderStrategy };

/** How the latest render was planned. */
export type RenderPlanning =
  | { readonly stage: typeof PlanningStage.None }
  | {
      readonly stage: typeof PlanningStage.AwaitingDecision;
      readonly assessment: ContestedAssessment;
    }
  | { readonly stage: typeof PlanningStage.Decided; readonly strategy: RenderStrategy };

/** How renders are planned, and what planning them has learned. */
export interface RenderStrategyView {
  readonly planning: RenderPlanning;
  /**
   * Seconds taken per second of audio by the last render that finished,
   * queueing and the worker's start included; `undefined` before any has.
   */
  readonly measuredCostRatio: number | undefined;
}

/** The planning of renders, and how the render control reports to it. */
export interface RenderStrategyStore extends Observable<RenderStrategyView> {
  readonly awaitDecision: (assessment: ContestedAssessment) => void;
  readonly decide: (strategy: RenderStrategy) => void;
  readonly measured: (costRatio: number) => void;
}

/** Creates the store, with nothing planned and nothing measured. */
export function createRenderStrategyStore(): RenderStrategyStore {
  const state = observable<RenderStrategyView>({
    planning: { stage: PlanningStage.None },
    measuredCostRatio: undefined,
  });

  return {
    get: state.get,
    subscribe: state.subscribe,

    awaitDecision: (assessment) => {
      state.update((view) => ({
        ...view,
        planning: { stage: PlanningStage.AwaitingDecision, assessment },
      }));
    },

    decide: (strategy) => {
      state.update((view) => ({ ...view, planning: { stage: PlanningStage.Decided, strategy } }));
    },

    measured: (measuredCostRatio) => {
      state.update((view) => ({ ...view, measuredCostRatio }));
    },
  };
}

/** The assessment waiting on the person's decision, if one is. */
export function awaitingDecision(view: RenderStrategyView): ContestedAssessment | undefined {
  return view.planning.stage === PlanningStage.AwaitingDecision
    ? view.planning.assessment
    : undefined;
}
