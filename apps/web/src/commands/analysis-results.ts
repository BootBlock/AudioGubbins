/**
 * What the analysis commands read of a detection: the finished one of a
 * view's audio as it is now, and what it was of, in words.
 */

import { formatPosition } from '@audiogubbins/timeline';

import {
  detectionIdentity,
  type Detection,
  type DetectionScope,
} from '../analysis/detection-control.js';
import type { EditorTarget } from './editor-target.js';
import type { ShellContext } from './shell-context.js';

/** What `scope` of the view's audio is, in a phrase: all of it, or a range of it. */
export function scopeWords(view: EditorTarget, scope: DetectionScope): string {
  if (scope.whole) return `all of ${view.asset.name}`;
  const at = (frames: number): string =>
    formatPosition(frames, view.asset.sampleRate, view.state.timeFormat);
  return `${view.asset.name} from ${at(scope.range.start)} to ${at(scope.range.end)}`;
}

/**
 * The finished detection of the view's audio as it is now, or why there is
 * none to apply: none asked for, still running, failed, or made of the audio
 * as it was before an edit since.
 */
export function currentResult(
  context: ShellContext,
  view: EditorTarget,
): Extract<Detection, { readonly kind: 'done' }> | string {
  const { name } = view.asset;
  const detection = context.detection.of(view.asset.id);
  if (detection === undefined) return `${name} has not been analysed. Analyse it first.`;
  if (detection.kind === 'running') return `${name} is still being analysed.`;
  if (detection.kind === 'failed') return detection.reason;
  const identity = detectionIdentity(view.asset, context.audioSettings.get().renderQuality);
  return detection.identity === identity
    ? detection
    : `${name} has changed since it was analysed. Analyse it again before applying what was found.`;
}
