/**
 * The composition root's analysis part: the session's detections, on the one
 * detection worker the browser runs (ADR-0062).
 *
 * Its own module beside `application.ts`, as the editor part is, because it
 * is a part of the root with its own real collaborator, the worker. Nothing
 * heavy is started here: the worker is made by the first detection asked for,
 * so a page that analyses nothing starts none.
 */

import type { PreviewHost } from '@audiogubbins/audio-runtime';
import { DetectionHost } from '@audiogubbins/detection-runtime';

import type { ModelServices } from '../ml/model-services.js';
import type { InteractionStore } from '../state/interaction-store.js';
import { createLoudnessStore } from '../state/loudness-store.js';
import { DetectionControl } from './detection-control.js';
import { LoudnessMeasuring } from './loudness-measuring.js';
import { browserDetectionWorker } from './detection-threads.js';

/**
 * Builds the analysis part, saying what each detection found through
 * `interaction`, its racked sounds read from the renders of `previews`, its
 * worker connected to the models a chain runs by `models`.
 */
export function startAnalysis(
  interaction: InteractionStore,
  previews: PreviewHost,
  models: Pick<ModelServices, 'startChainWorker'>,
) {
  const announce = (text: string): void => {
    interaction.announce(text);
  };
  // One worker for the detections and the loudness measurements, its host
  // stopped with the detections.
  const host = new DetectionHost({ createWorker: () => browserDetectionWorker(previews, models) });
  const detection = new DetectionControl({ host, announce });
  const loudness = new LoudnessMeasuring({ host, store: createLoudnessStore(), announce });
  return {
    parts: { detection, loudness },
    dispose: () => {
      loudness.cancel();
      detection.dispose();
    },
  };
}
