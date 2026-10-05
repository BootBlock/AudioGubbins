/**
 * The region commands (ADR-0051, REQ-EDIT-014): making a region of the
 * selection, trimming one to the selection, removing regions, and opening one
 * in a view of its own. Each change is one project command, or one change of
 * several, that the history keeps and undo reverses; its audio stays in the
 * asset it was made of.
 */

import { unchanged, type Command, type CommandInvocation } from '@audiogubbins/commands';
import { restateRegion, type Region } from '@audiogubbins/domain';
import {
  addRegionInvocation,
  removeRegionInvocation,
  setRegionInvocation,
} from '@audiogubbins/project-commands';

import { regionEntryId } from '../assets/project-entry.js';
import { RANGE_ONLY, editScope, type EditScope } from './edit-target.js';
import { changeProject, currentBasis } from './project-edits.js';
import { textArgument, type BodyAnswer } from './shell-command.js';
import type { ShellContext } from './shell-context.js';
import { foundRegions, nextName, oneRegion, regionCommand } from './region-target.js';

function createCommand(): Command<ShellContext> {
  return regionCommand(
    'region.create',
    'Make a region of the selection',
    (context, invocation) => {
      const scope = editScope(context, invocation, RANGE_ONLY);
      if (typeof scope === 'string') return scope;
      const { owner, state, session } = scope.project;
      const region: Region = {
        id: context.ids.next<'RegionId'>(),
        assetId: owner.asset.id,
        displayName: textArgument(invocation, 'name') ?? nextName(state, owner.asset),
        basis: currentBasis(owner),
        start: scope.target.range.start,
        end: scope.target.range.end,
        tags: [],
        operations: [],
      };
      changeProject(context, session, {
        description: `Make ${region.displayName}`,
        invocations: [addRegionInvocation(region)],
        said: `${region.displayName} made of ${owner.asset.displayName}.`,
      });
      return undefined;
    },
    ['region', 'make', 'create', 'new', 'cut up'],
  );
}

/** Sets the boundaries of the region a view shows to the scope's range, which trims it. */
export function setRegionBounds(context: ShellContext, scope: EditScope): BodyAnswer {
  const { state, session } = scope.project;
  const { target } = scope;
  const region = target.kind === 'region' ? state.project.regions.get(target.region) : undefined;
  const asset = state.project.assets.get(target.asset);
  if (region === undefined || asset === undefined)
    return 'That region is no longer in the project.';
  changeProject(context, session, {
    description: `Trim ${region.displayName}`,
    invocations: [setRegionInvocation(restateRegion(region, asset, target.range))],
    said: `Trimmed ${region.displayName} to the selection.`,
  });
  return undefined;
}

/** Removes the regions the invocation names, shows or has selected, as one change. */
export function removeRegions(context: ShellContext, invocation: CommandInvocation): BodyAnswer {
  const found = foundRegions(context, invocation);
  if (typeof found === 'string') return found;
  const [first, ...rest] = found;
  const many = `${String(found.length)} regions`;
  changeProject(context, first.project.session, {
    description: rest.length === 0 ? `Remove ${first.region.displayName}` : `Remove ${many}`,
    invocations: [
      removeRegionInvocation(first.region),
      ...rest.map((one) => removeRegionInvocation(one.region)),
    ],
    said:
      rest.length === 0
        ? `${first.region.displayName} removed. Its audio is still in ${first.asset.displayName}.`
        : `${many} removed. Their audio is still in the sounds they were made of.`,
  });
  return undefined;
}

function removeCommand(): Command<ShellContext> {
  return regionCommand('region.remove', 'Remove the region', removeRegions, [
    'region',
    'remove',
    'delete',
  ]);
}

function openCommand(): Command<ShellContext> {
  return regionCommand(
    'region.open',
    'Open the region in this view',
    (context, invocation) => {
      const found = oneRegion(context, invocation);
      if (typeof found === 'string') return found;
      const asset = context.assets.find(regionEntryId(found.region.id));
      if (asset === undefined) {
        const unopened = context.assets.get().unopened.get(regionEntryId(found.region.id));
        return unopened === undefined
          ? 'That region cannot be shown.'
          : `${unopened.name} cannot be shown yet. ${unopened.reason}`;
      }
      if (found.view.asset.id === asset.id) {
        return unchanged('region.open-already', `${asset.name} is open in this view already.`);
      }
      context.editorViews.open(found.view.panel, asset);
      context.interaction.announce(`${asset.name} is open.`);
      return undefined;
    },
    ['region', 'open', 'view', 'show'],
  );
}

/** The commands that make, trim, remove and open regions. */
export function regionCommands(): readonly Command<ShellContext>[] {
  return [createCommand(), removeCommand(), openCommand()];
}
