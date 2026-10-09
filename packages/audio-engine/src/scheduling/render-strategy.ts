/**
 * How one offline render runs: its chunks, its mode and its priority
 * (REQ-ARCH-079, REQ-ARCH-084, REQ-ARCH-087).
 *
 * The workload is planned first, against the resources the host measured, so
 * the mode is chosen knowing what the plan warned of; the mode then decides
 * the priority the render queues at. Where a warning offers a safer strategy
 * than the one chosen, which is the case where a person chose the foreground
 * over the processor's warning, the safer one is planned beside it and the
 * person decides: the render is never refused for its size, and a person who
 * knows what they are doing proceeds as they chose.
 */

import { mapResult, type DomainResult } from '@audiogubbins/domain';

import {
  ProcessingMode,
  ProcessingPurpose,
  selectProcessingMode,
  type ProcessingModeChoice,
} from '../profiles/processing-mode.js';
import { JobPriority } from './priority-scheduler.js';
import { planChunks, type ChunkPlan, type ChunkPlanRequest } from './workload.js';

/** What a render is planned from: its chunk plan's request, and any mode the person chose. */
export interface RenderStrategyRequest extends ChunkPlanRequest {
  /** The mode the person chose over the automatic one, if any. */
  readonly override?: ProcessingMode;
}

/** One way to run the render. */
export interface RenderStrategy {
  readonly choice: ProcessingModeChoice;
  readonly priority: JobPriority;
  readonly plan: ChunkPlan;
}

/** How the render would run, and the safer way its warnings offer where that differs. */
export interface RenderAssessment {
  readonly strategy: RenderStrategy;
  /** Present only where a warning offers a strategy safer than the one chosen. */
  readonly safer?: RenderStrategy;
}

/**
 * The priority a render queues at: the background for background rendering,
 * and the foreground for a render someone is waiting on.
 */
function priorityOf(choice: ProcessingModeChoice): JobPriority {
  return choice.mode === ProcessingMode.BackgroundOffline
    ? JobPriority.Background
    : JobPriority.Foreground;
}

function strategyOf(choice: ProcessingModeChoice, plan: ChunkPlan): RenderStrategy {
  return { choice, priority: priorityOf(choice), plan };
}

/**
 * The background, which a warning about the processor offers, where the
 * render was going to hold up playback and editing instead.
 */
function saferThan(strategy: RenderStrategy): RenderStrategy | undefined {
  const compute = strategy.plan.warnings.find((warning) => warning.resource === 'compute');
  if (compute === undefined || strategy.priority === JobPriority.Background) return undefined;
  return strategyOf(
    {
      mode: ProcessingMode.BackgroundOffline,
      reason: `Rendering in the background at the chosen render quality, as the warning offers. ${compute.saferStrategy}`,
      overridden: true,
    },
    strategy.plan,
  );
}

/** Plans a render: its chunks, the mode it runs in and why, and any safer way to run it. */
export function assessRender(request: RenderStrategyRequest): DomainResult<RenderAssessment> {
  const planned = planChunks(request);
  if (!planned.ok) return planned;
  const plan = planned.value;
  return mapResult(
    selectProcessingMode({
      purpose: ProcessingPurpose.FinalRender,
      settings: request.settings,
      warnings: plan.warnings,
      ...(request.measuredCostRatio === undefined
        ? {}
        : { measuredCostRatio: request.measuredCostRatio }),
      ...(request.override === undefined ? {} : { override: request.override }),
    }),
    (choice) => {
      const strategy = strategyOf(choice, plan);
      const safer = saferThan(strategy);
      return safer === undefined ? { strategy } : { strategy, safer };
    },
  );
}
