/**
 * Removing the silence an analysis found (REQ-AUDIO-018): the stretches the
 * Silence assistant would take out of the audio of the editor in use, at the
 * edges of what was analysed, the long pauses within it, or both, made into
 * the existing trim and delete edits of the asset (`removalEdits`) and run as
 * one change, which one undo reverses. From a region's view the edits change
 * the asset the region is part of, which is said, as a delete there does.
 *
 * It takes the silence settings as the detection does (`silence-threshold`
 * and the rest, `detector-arguments.ts`). Settings that judge otherwise than
 * the analysis did ask for a new analysis of the same audio and scope rather
 * than taking out what the old one found; the silence is removed once that
 * one has answered and the command is run again.
 */

import { CommandCategory, type Command, type CommandInvocation } from '@audiogubbins/commands';
import { removalEdits, shapesOf, type EditRange } from '@audiogubbins/domain';
import { SILENCE_ASSISTANT } from '@audiogubbins/processors';
import { counted } from '@audiogubbins/text';

import { SILENCE_PARTS, silenceRemovals, type SilencePart } from '../analysis/detection-control.js';
import { currentResult, scopeWords } from './analysis-results.js';
import { detectorValuesArgument, overlaid } from './detector-arguments.js';
import { analysedAgain } from './reanalysis.js';
import { editedView } from './edit-target.js';
import {
  chainInvocation,
  changeProject,
  needsProjectAsset,
  onAsset,
  onWholeAsset,
  type ProjectTarget,
} from './project-edits.js';
import { shellCommand, textArgument, type BodyAnswer } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The part of the silence an invocation names, `both` where it names none, or why it is not one. */
function silencePart(invocation: CommandInvocation): { readonly part: SilencePart } | string {
  const named = textArgument(invocation, 'part') ?? 'both';
  const part = SILENCE_PARTS.find((one) => one === named);
  return part === undefined
    ? 'Name the silence to take out: at the edges, within, or both.'
    : { part };
}

/** What `part` of the silence is called, as what is taken out and as what was not found. */
const SILENCE_WORDS: Readonly<
  Record<SilencePart, { readonly taken: string; readonly none: string }>
> = {
  edges: { taken: 'the silence at the edges', none: 'No silence was found at the edges.' },
  within: { taken: 'the long pauses', none: 'No long pause was found within.' },
  both: { taken: 'the silence', none: 'No silence was found to take out.' },
};

/**
 * Takes `removals`, found on the view's timeline, out of the asset of
 * `project` as one change, saying `said`, or answers why they cannot be.
 */
function removeFrom(
  context: ShellContext,
  project: ProjectTarget,
  removals: readonly EditRange[],
  said: string,
): BodyAnswer {
  const { owner } = project;
  const length = shapesOf(owner.asset).at(-1)?.length ?? 0;
  const edits = removalEdits(
    removals.map((range) => ({
      start: onAsset(owner, range.start),
      end: onAsset(owner, range.end),
    })),
    length,
  );
  if (!edits.ok) return edits.failures[0].summary;
  const [first, ...rest] = edits.value.map((edit) =>
    chainInvocation(context, { kind: 'asset', asset: owner.asset.id, range: edit.range }, edit),
  );
  if (first === undefined) return 'Nothing was found to take out.';
  changeProject(context, project.session, {
    description: 'Remove silence',
    invocations: [first, ...rest],
    said: onWholeAsset(owner, said),
  });
  return undefined;
}

/** Removes the part of the silence an invocation names, from the view it names. */
function removeSilence(context: ShellContext, invocation: CommandInvocation): BodyAnswer {
  const chosen = silencePart(invocation);
  if (typeof chosen === 'string') return chosen;
  const { part } = chosen;
  const found = editedView(context, invocation);
  if (typeof found === 'string') return found;
  const { view, project } = found;
  const detection = currentResult(context, view);
  if (typeof detection === 'string') return detection;
  const given = detectorValuesArgument(invocation);
  if (typeof given === 'string') return given;
  // What was found at other settings is found again at these first.
  const again = analysedAgain(
    context,
    view,
    detection,
    overlaid(detection.detectors, given),
    'Remove the silence once the Analysis panel shows what was found.',
  );
  if (again.kind === 'started') return undefined;
  if (again.kind === 'refused') return again.reason;
  const report = detection.result.reports.find(
    (one) => one.recommendation.assistant === SILENCE_ASSISTANT.key,
  );
  if (report === undefined) return `${view.asset.name} was not analysed for silence.`;
  const removals = silenceRemovals(report, detection.scope, part);
  if (removals.length === 0) return SILENCE_WORDS[part].none;
  const what = counted(removals.length, 'stretch', 'stretches');
  return removeFrom(
    context,
    project,
    removals,
    `Removed ${SILENCE_WORDS[part].taken} from ${scopeWords(view, detection.scope)}: ${what}.`,
  );
}

/** The command that removes the silence found. */
export function removeSilenceCommand(): Command<ShellContext> {
  return shellCommand(
    'analysis.remove-silence',
    'Remove the silence found',
    CommandCategory.Edit,
    removeSilence,
    {
      availability: needsProjectAsset,
      keywords: ['silence', 'trim', 'remove', 'pauses', 'dead air', 'top and tail'],
      description:
        'Takes out the silence the Silence assistant found: at the edges of what was analysed, the long pauses within it shortened to the pause kept, or both, as one change. Silence settings other than the analysis used (silence-threshold in dBFS, silence-shortest-edge, silence-shortest-pause and silence-pause-kept in seconds) analyse the audio again first.',
    },
  );
}
