/**
 * The analysis commands (ADR-0062): asking the assistants what the audio of
 * the editor in use holds, stopping them, and applying what one recommends.
 *
 * Analysing reads the selection first, as a processing command does: the
 * selected range, or the whole asset or region shown with nothing selected
 * (ADR-0042). It changes nothing of the project. Applying is the only command
 * here that does, and it does it through the project's own commands as one
 * change, which one undo reverses: the recommended processors made as a new
 * chain, and that chain processing the range that was analysed, as a rack
 * edit, or the whole asset or region, as its rack. A target that has a rack
 * keeps it, the treatment after it, as the analysis heard it, in a chain of
 * its own so another target sharing that rack hears no change. Removing the
 * silence found, the other change an analysis leads to, is
 * `silence-commands.ts`.
 */

import {
  CommandCategory,
  unchanged,
  type Command,
  type CommandInvocation,
} from '@audiogubbins/commands';
import {
  treatmentChain,
  type DetectorValues,
  type EditTarget,
  type EffectChain,
  type ProcessorState,
} from '@audiogubbins/domain';
import { extendedRackInvocation, rackRangeInvocation } from '@audiogubbins/project-commands';
import type { AssistantReport } from '@audiogubbins/detection-runtime';
import { CANONICAL_ASSISTANTS, PROCESSOR_CATALOGUE } from '@audiogubbins/processors';

import {
  EVERY_ASSISTANT,
  detectionIdentity,
  treatmentPlacement,
  type Detection,
  type DetectionScope,
} from '../analysis/detection-control.js';
import { stepName } from '../analysis/detection-words.js';
import { RANGE_OR_WHOLE, editedView } from './edit-target.js';
import {
  editorTarget,
  focusedEditor,
  needsEditor,
  selectedTarget,
  type EditorTarget,
} from './editor-target.js';
import { currentResult, scopeWords } from './analysis-results.js';
import { detectorValuesArgument, sameJudging, valuesRefusal } from './detector-arguments.js';
import { currentBasis, needsProjectAsset, onAsset, type ProjectTarget } from './project-edits.js';
import { changeRacks } from './rack-changes.js';
import { analyseAgainCommand } from './reanalysis.js';
import { removeSilenceCommand } from './silence-commands.js';
import { rackTargetOf } from './rack-target.js';
import { availableUnless, shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The assistants an invocation names, as keys separated by commas, or every one. */
function assistantsArgument(invocation: CommandInvocation): readonly string[] {
  const named = textArgument(invocation, 'assistants');
  return named === undefined
    ? EVERY_ASSISTANT
    : named
        .split(',')
        .map((key) => key.trim())
        .filter((key) => key !== '');
}

/**
 * Whether `detection` is of `scope` of the audio `identity` names, with
 * `assistants` judging by `detectors`, running or answered: asked again, it
 * would find the same.
 */
function asked(
  detection: Detection | undefined,
  identity: string,
  scope: DetectionScope,
  assistants: readonly string[],
  detectors: DetectorValues,
): boolean {
  if (detection === undefined || detection.kind === 'failed') return false;
  const same =
    detection.identity === identity &&
    detection.scope.whole === scope.whole &&
    detection.scope.range.start === scope.range.start &&
    detection.scope.range.end === scope.range.end &&
    sameJudging(detection.detectors, detectors);
  return same && detection.assistants.join(',') === assistants.join(',');
}

/** Why `detectors` cannot be set on a detection by `assistants`: a value for a detector none runs. */
function unrunRefusal(
  assistants: readonly string[],
  detectors: DetectorValues,
): string | undefined {
  const run = new Set(
    CANONICAL_ASSISTANTS.filter((assistant) => assistants.includes(assistant.key)).flatMap(
      (assistant) => assistant.detectors.map((detector) => detector.identity.key),
    ),
  );
  const unrun = Object.keys(detectors).find((key) => !run.has(key));
  return unrun === undefined
    ? undefined
    : `No assistant asked for runs the ${unrun} detector, so its settings cannot be used.`;
}

/**
 * The assistants an invocation asks for and the values their detectors judge
 * by, or why they cannot be asked for.
 */
function askedFor(
  invocation: CommandInvocation,
): { readonly assistants: readonly string[]; readonly detectors: DetectorValues } | string {
  const assistants = assistantsArgument(invocation);
  if (assistants.length === 0) return 'Name at least one assistant to analyse the audio with.';
  const detectors = detectorValuesArgument(invocation);
  if (typeof detectors === 'string') return detectors;
  return (
    valuesRefusal(detectors) ?? unrunRefusal(assistants, detectors) ?? { assistants, detectors }
  );
}

function detectCommand(): Command<ShellContext> {
  return shellCommand(
    'analysis.detect',
    'Analyse the audio',
    CommandCategory.Edit,
    (context, invocation) => {
      const view = editorTarget(context, invocation);
      if (typeof view === 'string') return view;
      const target = selectedTarget(context, view.asset, RANGE_OR_WHOLE);
      if (typeof target === 'string') return target;
      if (target.kind !== 'time' && target.kind !== 'whole-asset') {
        return 'This analyses a time range. Select one first, or select nothing to analyse the whole sound.';
      }
      if (target.range.end <= target.range.start) return 'The selected range holds no audio.';
      const scope: DetectionScope = { range: target.range, whole: target.kind === 'whole-asset' };
      const quality = context.audioSettings.get().renderQuality;
      const asking = askedFor(invocation);
      if (typeof asking === 'string') return asking;
      const { assistants, detectors } = asking;
      if (
        asked(
          context.detection.of(view.asset.id),
          detectionIdentity(view.asset, quality),
          scope,
          assistants,
          detectors,
        )
      ) {
        return unchanged(
          'analysis.unchanged',
          `The analysis of ${scopeWords(view, scope)} is current; the Analysis panel shows what was found.`,
        );
      }
      context.detection.detect(view.asset, scope, quality, assistants, detectors);
      context.interaction.announce(`Analysing ${scopeWords(view, scope)}.`);
      return undefined;
    },
    {
      availability: needsEditor,
      keywords: ['analyse', 'detect', 'find', 'clicks', 'hum', 'noise', 'clipping', 'repair'],
      description:
        'Finds clicks, clipping, hum, noise, a DC offset, onsets and silence in the selection, or in the whole sound with nothing selected, and recommends what would treat them. The silence settings (silence-threshold in dBFS, silence-shortest-edge, silence-shortest-pause and silence-pause-kept in seconds) may be given.',
    },
  );
}

/** The detection of the editor in use that is running, or why there is none. */
function runningDetection(context: ShellContext): EditorTarget | string {
  const view = focusedEditor(context);
  if (typeof view === 'string') return view;
  return context.detection.of(view.asset.id)?.kind === 'running'
    ? view
    : `${view.asset.name} is not being analysed.`;
}

function cancelCommand(): Command<ShellContext> {
  return shellCommand(
    'analysis.cancel',
    'Stop analysing',
    CommandCategory.Edit,
    (context, invocation) => {
      const view = editorTarget(context, invocation);
      if (typeof view === 'string') return view;
      if (!context.detection.cancel(view.asset.id))
        return `${view.asset.name} is not being analysed.`;
      context.interaction.announce(`Stopped analysing ${view.asset.name}.`);
      return undefined;
    },
    {
      availability: (context) => {
        const running = runningDetection(context);
        return availableUnless(typeof running === 'string' ? running : undefined);
      },
      keywords: ['stop', 'cancel', 'analysis', 'analyse'],
    },
  );
}

/** The state each of `report`'s steps learned, or why one of them could not learn it. */
function learnedStates(report: AssistantReport): readonly (ProcessorState | undefined)[] | string {
  const states: (ProcessorState | undefined)[] = [];
  for (const learned of report.learned) {
    if (learned.kind === 'refused') return learned.reason;
    states.push(learned.kind === 'learned' ? learned.state : undefined);
  }
  return states;
}

/** The invocation that processes the range analysed, on the asset's timeline, with `chain`. */
function rangeInvocation(
  context: ShellContext,
  project: ProjectTarget,
  scope: DetectionScope,
  chain: EffectChain,
): CommandInvocation {
  const { owner } = project;
  const range = { start: onAsset(owner, scope.range.start), end: onAsset(owner, scope.range.end) };
  const target: EditTarget =
    owner.region === undefined
      ? { kind: 'asset', asset: owner.asset.id, range }
      : {
          kind: 'region',
          asset: owner.asset.id,
          region: owner.region.id,
          basis: currentBasis(owner),
          range,
        };
  return rackRangeInvocation(target, context.ids.next<'EditOperationId'>(), chain);
}

function applyCommand(): Command<ShellContext> {
  return shellCommand(
    'analysis.apply',
    'Apply a recommendation',
    CommandCategory.Edit,
    (context, invocation) => {
      const found = editedView(context, invocation);
      if (typeof found === 'string') return found;
      const { view, project } = found;
      const detection = currentResult(context, view);
      if (typeof detection === 'string') return detection;
      const key = textArgument(invocation, 'assistant');
      const report = detection.result.reports.find((one) => one.recommendation.assistant === key);
      if (report === undefined) return 'Name an assistant whose recommendation to apply.';
      const { steps } = report.recommendation;
      if (steps.length === 0) return `The ${report.label} assistant recommends nothing to apply.`;
      const states = learnedStates(report);
      if (typeof states === 'string') return states;
      const chain = treatmentChain(steps, states, PROCESSOR_CATALOGUE, context.ids);
      if (!chain.ok) return chain.failures[0].summary;
      const change =
        treatmentPlacement(detection.scope) === 'rack'
          ? extendedRackInvocation(
              project.state.project,
              rackTargetOf(project.owner),
              chain.value,
              context.ids,
            )
          : rangeInvocation(context, project, detection.scope, chain.value);
      const names = steps.map((step) => stepName(step).toLowerCase());
      return changeRacks(context, {
        description: `Apply the ${report.label} recommendation`,
        invocations: [change],
        said: `Applied the ${report.label} recommendation to ${scopeWords(view, detection.scope)}: ${names.join(', ')}.`,
      });
    },
    {
      availability: needsProjectAsset,
      keywords: ['apply', 'recommendation', 'treat', 'repair', 'restore'],
      discoverable: false,
    },
  );
}

/** The commands that analyse the audio and apply what the assistants recommend. */
export function analysisCommands(): readonly Command<ShellContext>[] {
  return [
    detectCommand(),
    cancelCommand(),
    analyseAgainCommand(),
    applyCommand(),
    removeSilenceCommand(),
  ];
}
