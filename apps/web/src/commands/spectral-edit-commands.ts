/**
 * The spectral edits (ADR-0081, REQ-AUDIO-016): attenuating, removing,
 * isolating, healing and cleaning up the area of time and frequency the
 * spectral selection holds, each one project command the history keeps and
 * undo reverses, the source never rewritten.
 *
 * Each acts on the spectral selection alone, the facet made last, and is
 * refused with any other (ADR-0042). Its range is the selection's support
 * widened by half a frame each side, within the asset or the region shown
 * (`spectralPlacement`), so no changed frame reaches past it, and its mask is
 * stated relative to that range. It keeps the selection's channel scope. A gain
 * is typed in decibels and kept as the linear factor the domain holds,
 * converted once here. Cleaning up runs a restoration or model processor, new
 * to the project in a chain of its own that enters and leaves with the edit; a
 * processor whose model this page cannot run is applied all the same, as the
 * project keeps it, and the person is told why it is not heard. An edit the
 * domain refuses, for its mask, its resolution, its gain or its chain, is
 * refused with the reason and nothing changes.
 */

import { decibelsToGain } from '@audiogubbins/audio-engine';
import { CommandCategory, type Command, type CommandInvocation } from '@audiogubbins/commands';
import {
  DEFAULT_SPECTRAL_RESOLUTION,
  ProcessorCategory,
  channelCount,
  instantiateProcessor,
  isSpectralReduction,
  isSpectralResolution,
  spectralEditProblem,
  spectralPlacement,
  type EditTarget,
  type EffectChain,
  type EffectChainId,
  type SpectralEditOperation,
  type SpectralMask,
  type SpectralOperationKind,
} from '@audiogubbins/domain';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import { processTargetInvocation } from '@audiogubbins/project-commands';
import { SelectionFacet, type MadeFacet, type TargetRequest } from '@audiogubbins/timeline';

import { editedView } from './edit-target.js';
import { numberArgument, selectedTarget, type EditorTarget } from './editor-target.js';
import {
  changeProject,
  currentBasis,
  needsProjectAsset,
  onAsset,
  type ProjectTarget,
} from './project-edits.js';
import { processorLabel } from './rack-words.js';
import { shellCommand, textArgument, type BodyAnswer } from './shell-command.js';
import type { ShellContext } from './shell-context.js';
import { spectralComparisonCommands } from './spectral-comparison-commands.js';

/** A spectral edit acts on a spectral selection, and on nothing else. */
const SPECTRAL_AREA: TargetRequest = {
  accepts: new Set<MadeFacet>([SelectionFacet.Spectral]),
  whenNothing: 'refuse',
};

/** How far an attenuation lowers the area where the person names no gain, in decibels. */
export const DEFAULT_ATTENUATION_DECIBELS = -12;

/** The processors a spectral clean-up runs: restoration, by signal processing or a model. */
export const CLEANUP_PROCESSORS = [...PROCESSOR_CATALOGUE.values()].filter(
  (descriptor) => descriptor.category === ProcessorCategory.Restoration,
);

/** What a spectral edit acts on: the view, the project, the edit's target and where it lies. */
interface SpectralScope {
  readonly view: { readonly view: EditorTarget; readonly project: ProjectTarget };
  readonly target: EditTarget;
  /** The selection's mask relative to the target's range. */
  readonly mask: SpectralMask;
  readonly length: number;
}

/**
 * The resolution an invocation names by `resolution`, or the domain's
 * default where it names none, or why it is none this build analyses with.
 */
function resolutionOf(invocation: CommandInvocation): number | string {
  const value = invocation.arguments?.['resolution'];
  if (value === undefined) return DEFAULT_SPECTRAL_RESOLUTION;
  return typeof value === 'number' && isSpectralResolution(value)
    ? value
    : 'A spectral edit analyses in frames of a power of two from 256 to 16,384 samples.';
}

/** Where a spectral edit at `resolution` of the selection of the view named lies, or why none can. */
function spectralScope(
  context: ShellContext,
  invocation: CommandInvocation,
  resolution: number,
): SpectralScope | string {
  const view = editedView(context, invocation);
  if (typeof view === 'string') return view;
  const { asset } = view.view;
  const selected = selectedTarget(context, asset, SPECTRAL_AREA);
  if (typeof selected === 'string') return selected;
  if (selected.kind !== 'spectral') return 'A spectral edit acts on a spectral selection.';
  const placed = spectralPlacement(selected.mask, resolution, asset.length);
  if (placed === undefined) return 'The spectral selection reaches no audio.';
  const { owner } = view.project;
  const range = { start: onAsset(owner, placed.start), end: onAsset(owner, placed.end) };
  const channels =
    selected.channels.length === channelCount(asset.layout) ? {} : { channels: selected.channels };
  return {
    view,
    mask: placed.mask,
    length: placed.end - placed.start,
    target:
      owner.region === undefined
        ? { kind: 'asset', asset: owner.asset.id, range, ...channels }
        : {
            kind: 'region',
            asset: owner.asset.id,
            region: owner.region.id,
            basis: currentBasis(owner),
            range,
            ...channels,
          },
  };
}

/**
 * Makes the spectral edit `operation` of the selection, with `chain` new to
 * the project where it runs one, saying `done` once it is made; or why it
 * cannot be made, the domain's own reason where it refuses the edit.
 */
function applied(
  context: ShellContext,
  invocation: CommandInvocation,
  operation: SpectralEditOperation,
  done: (name: string) => string,
  chain?: EffectChain,
): BodyAnswer {
  const resolution = resolutionOf(invocation);
  if (typeof resolution === 'string') return resolution;
  const scope = spectralScope(context, invocation, resolution);
  if (typeof scope === 'string') return scope;
  const edit = { kind: 'spectral', mask: scope.mask, resolution, operation } as const;
  const chains = new Map<EffectChainId, EffectChain>(scope.view.project.state.project.effectChains);
  if (chain !== undefined) chains.set(chain.id, chain);
  const problem = spectralEditProblem(edit, scope.length, chains);
  if (problem !== undefined) return problem;
  const said = done(scope.view.view.asset.name);
  changeProject(context, scope.view.project.session, {
    description: said,
    invocations: [
      processTargetInvocation(scope.target, context.ids.next<'EditOperationId'>(), edit, chain),
    ],
    said,
  });
  return undefined;
}

/**
 * The factor a gain of `decibels` below nothing makes, as the domain keeps
 * it (ADR-0081), or why it makes none an attenuation may apply.
 */
function reductionOf(decibels: number): number | string {
  // Converted once, where the decibels are typed, by the engine's canonical
  // conversion: the factor is what is kept, so the edit gives the same bits on
  // every machine.
  const factor = decibelsToGain(decibels);
  return isSpectralReduction(factor)
    ? factor
    : 'A spectral reduction lowers the level: give a number of decibels below nothing.';
}

/** The decibels in words, with the typographic minus a screen reader says as "minus". */
function decibelsWords(decibels: number): string {
  return `${String(decibels).replace('-', '−')} dB`;
}

/** A spectral edit command, available where the editor in use shows an asset of the project. */
function spectralCommand(
  kind: SpectralOperationKind | 'remove',
  label: string,
  run: (context: ShellContext, invocation: CommandInvocation) => BodyAnswer,
  options: { readonly keywords: readonly string[]; readonly description: string },
): Command<ShellContext> {
  return shellCommand(`spectral.${kind}`, label, CommandCategory.Edit, run, {
    availability: needsProjectAsset,
    ...options,
  });
}

function attenuateCommand(): Command<ShellContext> {
  return spectralCommand(
    'attenuate',
    'Attenuate the spectral selection',
    (context, invocation) => {
      const decibels = numberArgument(invocation, 'decibels') ?? DEFAULT_ATTENUATION_DECIBELS;
      const gain = reductionOf(decibels);
      if (typeof gain === 'string') return gain;
      return applied(
        context,
        invocation,
        { kind: 'attenuate', gain },
        (name) => `Attenuated an area of ${name} by ${decibelsWords(decibels)}.`,
      );
    },
    {
      keywords: ['attenuate', 'reduce', 'lower', 'spectral', 'quieter', 'decibels'],
      description: `Lowers what the spectral selection holds by the decibels given, ${decibelsWords(DEFAULT_ATTENUATION_DECIBELS)} where none are.`,
    },
  );
}

function removeCommand(): Command<ShellContext> {
  return spectralCommand(
    'remove',
    'Remove the spectral selection',
    (context, invocation) =>
      applied(
        context,
        invocation,
        { kind: 'attenuate', gain: 0 },
        (name) => `Removed an area of ${name}.`,
      ),
    {
      keywords: ['remove', 'delete', 'erase', 'spectral', 'silence', 'area'],
      description: 'Takes what the spectral selection holds out of the sound, leaving the rest.',
    },
  );
}

function isolateCommand(): Command<ShellContext> {
  return spectralCommand(
    'isolate',
    'Isolate the spectral selection',
    (context, invocation) => {
      const decibels = numberArgument(invocation, 'decibels');
      const gain = decibels === undefined ? 0 : reductionOf(decibels);
      if (typeof gain === 'string') return gain;
      return applied(context, invocation, { kind: 'isolate', gain }, (name) =>
        decibels === undefined
          ? `Isolated an area of ${name}, the rest of its span removed.`
          : `Isolated an area of ${name}, the rest of its span lowered by ${decibelsWords(decibels)}.`,
      );
    },
    {
      keywords: ['isolate', 'keep', 'solo', 'spectral', 'area', 'rest'],
      description:
        'Keeps what the spectral selection holds and lowers everything else over its span by the decibels given, or removes it where none are.',
    },
  );
}

function healCommand(): Command<ShellContext> {
  return spectralCommand(
    'heal',
    'Heal the spectral selection',
    (context, invocation) =>
      applied(context, invocation, { kind: 'heal' }, (name) => `Healed an area of ${name}.`),
    {
      keywords: ['heal', 'repair', 'fill', 'interpolate', 'spectral', 'patch'],
      description:
        'Fills what the spectral selection holds with what surrounds it in time, keeping the phase.',
    },
  );
}

function cleanUpCommand(): Command<ShellContext> {
  return spectralCommand(
    'process',
    'Clean up the spectral selection',
    (context, invocation) => {
      const typeKey = textArgument(invocation, 'typeKey');
      const descriptor = CLEANUP_PROCESSORS.find((one) => one.typeKey === typeKey);
      if (descriptor === undefined) {
        return 'Choose a restoration processor to clean the area up with.';
      }
      const processor = instantiateProcessor(context.ids.next<'ProcessorId'>(), descriptor);
      const chain: EffectChain = { id: context.ids.next<'EffectChainId'>(), slots: [processor] };
      const cannot = context.modelGate.get()(processor);
      const name = processorLabel(descriptor.typeKey);
      return applied(
        context,
        invocation,
        { kind: 'process', chain: chain.id },
        (asset) =>
          `Cleaned up an area of ${asset} with ${name}.${cannot === undefined ? '' : ` It is not heard yet: ${cannot}`}`,
        chain,
      );
    },
    {
      keywords: ['clean', 'cleanup', 'repair', 'denoise', 'restore', 'model', 'spectral'],
      description:
        'Runs a restoration processor over the spectral selection and takes its output there, in a chain of its own the Effects rack shows.',
    },
  );
}

/** The commands that make spectral edits, and the one that compares one with before it. */
export function spectralEditCommands(): readonly Command<ShellContext>[] {
  return [
    attenuateCommand(),
    removeCommand(),
    isolateCommand(),
    healCommand(),
    cleanUpCommand(),
    ...spectralComparisonCommands(),
  ];
}
