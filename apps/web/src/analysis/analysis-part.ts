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

import type { InteractionStore } from '../state/interaction-store.js';
import { DetectionControl } from './detection-control.js';
import { browserDetectionWorker } from './detection-threads.js';

/**
 * Builds the analysis part, saying what each detection found through
 * `interaction`, its racked sounds read from the renders of `previews`.
 */
export function startAnalysis(interaction: InteractionStore, previews: PreviewHost) {
  const detection = new DetectionControl({
    host: new DetectionHost({ createWorker: () => browserDetectionWorker(previews) }),
    announce: (text) => {
      interaction.announce(text);
    },
  });
  return {
    parts: { detection },
    dispose: () => {
      detection.dispose();
    },
  };
}
