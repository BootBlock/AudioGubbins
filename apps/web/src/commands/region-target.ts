/**
 * Which region a region command acts on, and the parts every region command
 * shares: a region is named by the `region` argument, or is the one the view
 * shows, or the one selected in a view of its asset; its boundaries are
 * restated at the asset's chain as it stands whenever they change, so they
 * stay on the content they were put on through every later edit (ADR-0051).
 */

import { CommandCategory, type Command, type CommandInvocation } from '@audiogubbins/commands';
import {
  isWellFormedId,
  unsafeBrandId,
  type Asset,
  type Region,
  type RegionId,
} from '@audiogubbins/domain';
import type { ProjectState } from '@audiogubbins/project-format';
import type { SelectionSet } from '@audiogubbins/timeline';

import type { ProjectOwner } from '../assets/editor-asset.js';
import { editedView } from './edit-target.js';
import { needsProjectAsset, type ProjectTarget } from './project-edits.js';
import { shellCommand, textArgument, type BodyAnswer } from './shell-command.js';
import type { ShellContext } from './shell-context.js';
import type { EditorTarget } from './editor-target.js';

/** A region of the project as it stands, the asset it is of, and where the command found it. */
export interface FoundRegion {
  readonly region: Region;
  readonly asset: Asset;
  readonly project: ProjectTarget;
  readonly view: EditorTarget;
}

export function regionCommand(
  id: string,
  label: string,
  run: (context: ShellContext, invocation: CommandInvocation) => BodyAnswer,
  keywords: readonly string[],
  discoverable = true,
): Command<ShellContext> {
  return shellCommand(id, label, CommandCategory.Edit, run, {
    availability: needsProjectAsset,
    keywords,
    discoverable,
  });
}

/** The regions a command acts on: the one named, the one shown, or those selected; or why none. */
export function foundRegions(
  context: ShellContext,
  invocation: CommandInvocation,
): readonly [FoundRegion, ...FoundRegion[]] | string {
  const found = editedView(context, invocation);
  if (typeof found === 'string') return found;
  const { view, project } = found;
  const { regions, assets } = project.state.project;
  const named = textArgument(invocation, 'region');
  const ids: readonly string[] =
    named !== undefined
      ? named.split(',').map((part) => part.trim())
      : regionsInView(project.owner, context.selections.of(view.asset.id));
  const held: FoundRegion[] = [];
  for (const id of ids) {
    const region = isWellFormedId(id) ? regions.get(unsafeBrandId<'RegionId'>(id)) : undefined;
    const asset = region === undefined ? undefined : assets.get(region.assetId);
    if (region === undefined || asset === undefined)
      return 'That region is no longer in the project.';
    held.push({ region, asset, project, view });
  }
  const [first, ...rest] = held;
  return first === undefined
    ? 'No region is selected. Click a region, or open one in a view of its own.'
    : [first, ...rest];
}

/**
 * The regions a view acts on where none is named: the one it shows, or those
 * selected in a view of their asset. The Inspector shows the same one.
 */
export function regionsInView(owner: ProjectOwner, selection: SelectionSet): readonly RegionId[] {
  if (owner.region !== undefined) return [owner.region.id];
  return selection.objects?.kind === 'regions' ? selection.objects.ids : [];
}

/** The one region a command acts on, or why there is not exactly one. */
export function oneRegion(
  context: ShellContext,
  invocation: CommandInvocation,
): FoundRegion | string {
  const found = foundRegions(context, invocation);
  if (typeof found === 'string') return found;
  return found.length === 1 ? found[0] : 'Select one region for this.';
}

/** The first "Region n" not in use on the asset. */
export function nextName(state: ProjectState, asset: Asset): string {
  const taken = new Set(
    [...state.project.regions.values()]
      .filter((region) => region.assetId === asset.id)
      .map((region) => region.displayName),
  );
  let number = taken.size + 1;
  while (taken.has(`Region ${String(number)}`)) number += 1;
  return `Region ${String(number)}`;
}
