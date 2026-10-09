/**
 * Analysing again at other detector settings (ADR-0062): the analysis shown
 * of the editor in use, run once more over the same audio, scope and
 * assistants, its detectors judging by settings laid over the ones it used.
 * One way, which the command a view's settings run and the silence removal
 * both take, so a changed setting is never answered from what was found at
 * the old one, and never analyses whatever happens to be selected now.
 */

import { CommandCategory, unchanged, type Command } from '@audiogubbins/commands';
import type { DetectorValues } from '@audiogubbins/domain';

import type { Detection } from '../analysis/detection-control.js';
import { scopeWords } from './analysis-results.js';
import {
  detectorValuesArgument,
  overlaid,
  sameJudging,
  valuesRefusal,
} from './detector-arguments.js';
import { editorTarget, needsEditor, type EditorTarget } from './editor-target.js';
import { shellCommand } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** What asking to analyse again came to. */
export type AnalysedAgain =
  | { readonly kind: 'started' }
  | { readonly kind: 'same' }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * Analyses `detection`'s scope of the view's audio again, its detectors
 * judging by `detectors`, saying so with `next` after: started; the same,
 * where `detectors` judge as the analysis did, which is left as it is; or
 * refused, with why they cannot be judged by, as the worker would refuse them.
 */
export function analysedAgain(
  context: ShellContext,
  view: EditorTarget,
  detection: Detection,
  detectors: DetectorValues,
  next?: string,
): AnalysedAgain {
  const refusal = valuesRefusal(detectors);
  if (refusal !== undefined) return { kind: 'refused', reason: refusal };
  if (sameJudging(detection.detectors, detectors)) return { kind: 'same' };
  const { scope, assistants } = detection;
  const quality = context.audioSettings.get().renderQuality;
  context.detection.detect(view.asset, scope, quality, assistants, detectors);
  const said = `Analysing ${scopeWords(view, scope)} again at these settings.`;
  context.interaction.announce(next === undefined ? said : `${said} ${next}`);
  return { kind: 'started' };
}

/** The command that analyses again at the settings it is given, as the Analysis panel's fields do. */
export function analyseAgainCommand(): Command<ShellContext> {
  return shellCommand(
    'analysis.analyse-again',
    'Analyse again at these settings',
    CommandCategory.Edit,
    (context, invocation) => {
      const view = editorTarget(context, invocation);
      if (typeof view === 'string') return view;
      const detection = context.detection.of(view.asset.id);
      if (detection === undefined)
        return `${view.asset.name} has not been analysed. Analyse it first.`;
      const given = detectorValuesArgument(invocation);
      if (typeof given === 'string') return given;
      const again = analysedAgain(context, view, detection, overlaid(detection.detectors, given));
      if (again.kind === 'started') return undefined;
      return again.kind === 'same'
        ? unchanged(
            'analysis.unchanged',
            `${view.asset.name} was analysed at these settings; the Analysis panel shows what was found.`,
          )
        : again.reason;
    },
    {
      availability: needsEditor,
      keywords: ['analyse', 'again', 'settings', 'silence', 'threshold', 'pause'],
      description:
        'Analyses the range of the analysis shown again, with the same assistants, at the detector settings given (silence-threshold in dBFS, silence-shortest-edge, silence-shortest-pause and silence-pause-kept in seconds), keeping every other setting it used.',
    },
  );
}
