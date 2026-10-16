/**
 * The composition root's analysis part: the session's detections and loop
 * analyses, on the one detection worker the browser runs, and its loop
 * auditions, on the transport (ADR-0062, ADR-0103).
 *
 * Its own module beside `application.ts`, as the editor part is, because it
 * is a part of the root with its own real collaborator, the worker. Nothing
 * heavy is started here: the worker is made by the first detection asked for,
 * so a page that analyses nothing starts none.
 */

import type { PreviewHost } from '@audiogubbins/audio-runtime';
import { DetectionHost } from '@audiogubbins/detection-runtime';

import { browserSchedule } from '../audio/browser-schedule.js';
import { LoopAuditioning } from '../audio/loop-audition.js';
import type { PlaybackControl } from '../audio/playback-control.js';
import type { ModelServices } from '../ml/model-services.js';
import type { AudioViewStore } from '../state/audio-view-store.js';
import type { InteractionStore } from '../state/interaction-store.js';
import { createLoopAnalysisStore } from '../state/loop-analysis-store.js';
import { DetectionControl } from './detection-control.js';
import { browserDetectionWorker } from './detection-threads.js';
import { LoopAnalysing } from './loop-analysing.js';
import { WorkflowAnalysing } from './workflow-analysing.js';

/**
 * Builds the analysis part, saying what each detection found through
 * `interaction`, its racked sounds read from the renders of `previews`, its
 * worker connected to the models a chain runs by `models`, and its loop
 * auditions played on `transport`.
 */
export function startAnalysis(
  interaction: InteractionStore,
  previews: PreviewHost,
  models: Pick<ModelServices, 'startChainWorker'>,
  transport: { readonly playback: PlaybackControl; readonly audio: AudioViewStore },
) {
  const announce = (text: string): void => {
    interaction.announce(text);
  };
  // One worker for the detections and the loop analyses, its host stopped
  // with the detections.
  const host = new DetectionHost({ createWorker: () => browserDetectionWorker(previews, models) });
  const detection = new DetectionControl({ host, announce });
  const loopAnalysis = new LoopAnalysing({ host, store: createLoopAnalysisStore(), announce });
  // A workflow's analyses run in turn through the two above, each started
  // once the one before it is no longer running.
  const workflowAnalysis = new WorkflowAnalysing([detection, loopAnalysis.analyses]);
  // A loop is heard on the transport, cycled by the page's timers.
  const loopAudition = new LoopAuditioning({ ...transport, schedule: browserSchedule });
  return {
    parts: { detection, loopAnalysis, workflowAnalysis, loopAudition },
    dispose: () => {
      workflowAnalysis.cancel();
      loopAudition.dispose();
      loopAnalysis.dispose();
      detection.dispose();
    },
  };
}
