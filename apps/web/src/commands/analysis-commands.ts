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
 * its own so another target sharing that rack hears no change.
 */

import {
  CommandCategory,
  unchanged,
  type Command,
  type CommandInvocation,
} from '@audiogubbins/commands';
import {
  chainUseCount,
  chainUsers,
  copyChain,
  treatmentChain,
  type EditTarget,
  type EffectChain,
  type ProcessorState,
} from '@audiogubbins/domain';
import {
  addChainInvocation,
  processTargetInvocation,
  removeChainInvocation,
  setRackInvocation,
  type RackTarget,
} from '@audiogubbins/project-commands';
import type { AssistantReport } from '@audiogubbins/detection-runtime';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import { formatPosition } from '@audiogubbins/timeline';

import {
  EVERY_ASSISTANT,
  detectionIdentity,
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
import {
  changeProject,
  currentBasis,
  needsProjectAsset,
  onAsset,
  type ProjectTarget,
} from './project-edits.js';
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

/** What `scope` of the view's audio is, in a phrase: all of it, or a range of it. */
function scopeWords(view: EditorTarget, scope: DetectionScope): string {
  if (scope.whole) return `all of ${view.asset.name}`;
  const at = (frames: number): string =>
    formatPosition(frames, view.asset.sampleRate, view.state.timeFormat);
  return `${view.asset.name} from ${at(scope.range.start)} to ${at(scope.range.end)}`;
}

/**
 * Whether `detection` is of `scope` of the audio `identity` names, with
 * `assistants`, running or answered: asked again, it would find the same.
 */
function asked(
  detection: Detection | undefined,
  identity: string,
  scope: DetectionScope,
  assistants: readonly string[],
): boolean {
  if (detection === undefined || detection.kind === 'failed') return false;
  const same =
    detection.identity === identity &&
    detection.scope.whole === scope.whole &&
    detection.scope.range.start === scope.range.start &&
    detection.scope.range.end === scope.range.end;
  return same && detection.assistants.join(',') === assistants.join(',');
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
      const assistants = assistantsArgument(invocation);
      if (assistants.length === 0) return 'Name at least one assistant to analyse the audio with.';
      if (
        asked(
          context.detection.of(view.asset.id),
          detectionIdentity(view.asset, quality),
          scope,
          assistants,
        )
      ) {
        return unchanged(
          'analysis.unchanged',
          `The analysis of ${scopeWords(view, scope)} is current; the Analysis panel shows what was found.`,
        );
      }
      context.detection.detect(view.asset, scope, quality, assistants);
      context.interaction.announce(`Analysing ${scopeWords(view, scope)}.`);
      return undefined;
    },
    {
      availability: needsEditor,
      keywords: ['analyse', 'detect', 'find', 'clicks', 'hum', 'noise', 'clipping', 'repair'],
      description:
        'Finds clicks, clipping, hum, noise, a DC offset and onsets in the selection, or in the whole sound with nothing selected, and recommends what would treat them.',
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

/**
 * The finished detection of the view's audio as it is now, or why there is
 * none to apply: none asked for, still running, failed, or made of the audio
 * as it was before an edit since.
 */
function currentResult(
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

/** The state each of `report`'s steps learned, or why one of them could not learn it. */
function learnedStates(report: AssistantReport): readonly (ProcessorState | undefined)[] | string {
  const states: (ProcessorState | undefined)[] = [];
  for (const learned of report.learned) {
    if (learned.kind === 'refused') return learned.reason;
    states.push(learned.kind === 'learned' ? learned.state : undefined);
  }
  return states;
}

/** What a target's rack command names: the asset, or the region the view shows. */
function rackTarget(project: ProjectTarget): RackTarget {
  const { owner } = project;
  return owner.region === undefined
    ? { kind: 'asset', asset: owner.asset }
    : { kind: 'region', region: owner.region, asset: owner.asset };
}

/** The invocations that give the whole target `chain` as its rack, after any rack it has. */
function rackInvocations(
  context: ShellContext,
  project: ProjectTarget,
  chain: EffectChain,
): readonly CommandInvocation[] | string {
  const target = rackTarget(project);
  const existing = target.kind === 'asset' ? target.asset.rack : target.region.rack;
  if (existing === undefined) {
    return [addChainInvocation(chain), setRackInvocation(target, chain.id)];
  }
  const { project: state } = project.state;
  const rack = state.effectChains.get(existing);
  if (rack === undefined) return 'Its rack names a chain the project does not hold.';
  const extended: EffectChain = {
    id: chain.id,
    slots: [...copyChain(rack, context.ids).slots, ...chain.slots],
  };
  // The rack it had is taken out only where nothing else names it, as a chain
  // something names cannot be removed.
  const unnamed = chainUseCount(chainUsers(state, existing)) === 1;
  return [
    addChainInvocation(extended),
    setRackInvocation(target, extended.id),
    ...(unnamed ? [removeChainInvocation(existing)] : []),
  ];
}

/** The invocations that process the range analysed, on the asset's timeline, with `chain`. */
function rangeInvocations(
  context: ShellContext,
  project: ProjectTarget,
  scope: DetectionScope,
  chain: EffectChain,
): readonly CommandInvocation[] {
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
  return [
    addChainInvocation(chain),
    processTargetInvocation(target, context.ids.next<'EditOperationId'>(), {
      kind: 'rack',
      chain: chain.id,
    }),
  ];
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
      const invocations = detection.scope.whole
        ? rackInvocations(context, project, chain.value)
        : rangeInvocations(context, project, detection.scope, chain.value);
      if (typeof invocations === 'string') return invocations;
      const [first, ...rest] = invocations;
      if (first === undefined) return 'There is nothing to apply.';
      const names = steps.map((step) => stepName(step).toLowerCase());
      changeProject(context, project.session, {
        description: `Apply the ${report.label} recommendation`,
        invocations: [first, ...rest],
        said: `Applied the ${report.label} recommendation to ${scopeWords(view, detection.scope)}: ${names.join(', ')}.`,
      });
      return undefined;
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
  return [detectCommand(), cancelCommand(), applyCommand()];
}
