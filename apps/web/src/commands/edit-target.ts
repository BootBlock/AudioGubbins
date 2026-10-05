/**
 * What an edit command acts on, its `EditTarget`, selection first (ADR-0042,
 * ADR-0051): the range and channels the active selection resolves to, or the
 * whole asset or region shown where nothing is selected and the command says it
 * acts on the whole; stated on the asset's edited timeline, where every
 * operation is placed, at a basis of its chain as it stands.
 *
 * A view of a region shows the region's slice of its asset, so the view's
 * range is moved on by the region's start. Each command names what it does
 * with nothing selected in its request, so the documented whole target is the
 * command's own rule and never a guess.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import type { EditRange, EditTarget } from '@audiogubbins/domain';
import { SelectionFacet, type MadeFacet, type TargetRequest } from '@audiogubbins/timeline';

import type { EditorAsset } from '../assets/editor-asset.js';
import { editorTarget, selectedTarget, type EditorTarget } from './editor-target.js';
import { currentBasis, onAsset, projectTarget, type ProjectTarget } from './project-edits.js';
import type { ShellContext } from './shell-context.js';

/** The target a command acts on, and the view and project it came from. */
export interface EditScope {
  readonly view: EditorTarget;
  readonly project: ProjectTarget;
  /** The asset or region shown, with the range and channels the selection resolves. */
  readonly target: EditTarget;
  /** The range as the view shows it. */
  readonly shown: EditRange;
  /** Whether nothing was selected, so the whole asset or region is the target. */
  readonly whole: boolean;
}

/** A time range, or the whole asset or region where nothing is selected. */
export const RANGE_OR_WHOLE: TargetRequest = {
  accepts: new Set<MadeFacet>([SelectionFacet.Time]),
  whenNothing: 'whole-asset',
};

/** A time range, and nothing else: an edit that would empty the asset never falls back to it. */
export const RANGE_ONLY: TargetRequest = {
  accepts: new Set<MadeFacet>([SelectionFacet.Time]),
  whenNothing: 'refuse',
};

/**
 * Why a change of time cannot be made on the scope's channels alone, or
 * `undefined` where it acts on every channel: time taken from some channels
 * would put the others out of step (ADR-0051).
 */
export function partOfTheChannels(scope: EditScope): string | undefined {
  return scope.target.channels === undefined
    ? undefined
    : 'A change of time acts on every channel, or the channels would fall out of step. Select every channel first.';
}

/** The view and the project asset it shows, or why the view shows none. */
export function editedView(
  context: ShellContext,
  invocation: CommandInvocation,
): { readonly view: EditorTarget; readonly project: ProjectTarget } | string {
  const view = editorTarget(context, invocation);
  if (typeof view === 'string') return view;
  const project = projectTarget(context, view.asset);
  return typeof project === 'string' ? project : { view, project };
}

/** The scope a command making `request` acts on in the view it names, or why there is none. */
export function editScope(
  context: ShellContext,
  invocation: CommandInvocation,
  request: TargetRequest,
): EditScope | string {
  const found = editedView(context, invocation);
  if (typeof found === 'string') return found;
  const { view, project } = found;
  const target = selectedTarget(context, view.asset, request);
  if (typeof target === 'string') return target;
  if (target.kind !== 'time' && target.kind !== 'whole-asset') {
    return 'This acts on a time range. Select one first, or select nothing to act on the whole sound.';
  }
  if (target.range.end <= target.range.start) return 'The selected range holds no audio.';
  const { owner } = project;
  const range: EditRange = {
    start: onAsset(owner, target.range.start),
    end: onAsset(owner, target.range.end),
  };
  const channels =
    target.channels.length === channelCountOf(view.asset) ? {} : { channels: target.channels };
  return {
    view,
    project,
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
    shown: target.range,
    whole: target.kind === 'whole-asset',
  };
}

function channelCountOf(asset: EditorAsset): number {
  return asset.layout.roles.length;
}
