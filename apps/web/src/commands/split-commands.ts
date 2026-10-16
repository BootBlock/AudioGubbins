/**
 * Splitting at the playhead (ADR-0051): a region there becomes two regions at
 * the split, each keeping the processing that covers its part and the loop
 * where the loop lies within it; where no region is, the sound is cut into two
 * regions over all of it, which is how a long recording is cut into many
 * sounds. The razor's click runs it.
 *
 * A region in an asset group stays in it, and the part split off joins the
 * same group in the same step, right after it in the assignment order, with
 * its processing and overrides (ADR-0101), so both halves keep the policy the
 * region had and one undo takes both back.
 */

import type { Command, CommandInvocation } from '@audiogubbins/commands';
import {
  anchorResolver,
  splitRegion,
  splitWholeAsset,
  type Asset,
  type Project,
  type Region,
  type SampleCount,
} from '@audiogubbins/domain';
import { memberKey, type GameAudioState } from '@audiogubbins/game-audio';
import {
  addRegionInvocation,
  addRegionWithProcessing,
  assignMemberInvocation,
  changeRegionInvocations,
} from '@audiogubbins/project-commands';

import { editedView } from './edit-target.js';
import { boundaryArgument, playheadOf } from './editor-target.js';
import { changeProject, onAsset, type ProjectTarget } from './project-edits.js';
import type { ShellContext } from './shell-context.js';
import { nextName, regionCommand } from './region-target.js';

/** Where a split is: the asset as the project holds it, and the boundary on its timeline. */
interface SplitPlace {
  readonly asset: Asset;
  readonly at: SampleCount;
  readonly region: Region['id'] | undefined;
}

/**
 * Puts each part split off a region of a group in that group right after the
 * region, as it belongs to it: the step for one split at a time, in the order
 * the splits are made, each place counted past the parts put in before it.
 */
function groupJoining(
  game: GameAudioState | undefined,
): (region: Region, second: Region) => readonly CommandInvocation[] {
  const placed: number[] = [];
  return (region, second) => {
    const key = memberKey({ kind: 'region', region: region.id });
    const index = game?.memberships.findIndex((one) => memberKey(one.member) === key) ?? -1;
    const membership = index < 0 ? undefined : game?.memberships[index];
    if (membership === undefined) return [];
    const before = placed.filter((one) => one <= index).length;
    placed.push(index);
    return [
      assignMemberInvocation(
        { kind: 'region', region: second.id },
        membership.group,
        membership.processing,
        { overrides: membership.overrides, position: index + before + 1 },
      ),
    ];
  };
}

/**
 * The steps that make `region` the pair it is split into: the first part is
 * the region changed, the second a region added, each with its processing,
 * and the second put in the first's group where it is in one.
 */
function splitSteps(
  {
    region,
    parts: [first, second],
  }: {
    readonly region: Region;
    readonly parts: readonly [Region, Region];
  },
  chains: Project['effectChains'],
  joining: (region: Region, second: Region) => readonly CommandInvocation[],
): readonly [CommandInvocation, ...CommandInvocation[]] {
  return [
    ...changeRegionInvocations(region, first, chains),
    ...addRegionWithProcessing(second, chains),
    ...joining(region, second),
  ];
}

/** Splits the regions at the place, as one change, or answers `false` where none is there. */
function splitRegions(context: ShellContext, project: ProjectTarget, place: SplitPlace): boolean {
  const { asset, at } = place;
  const resolver = anchorResolver(asset);
  const splits = [...project.state.project.regions.values()]
    .filter(
      (region) =>
        region.assetId === asset.id && (place.region === undefined || region.id === place.region),
    )
    .flatMap((region) => {
      const parts = splitRegion(asset, region, at, context.ids, resolver);
      // Wrapped, so the region and the pair it becomes stay one element.
      return parts === undefined ? [] : [{ region, parts }];
    });
  const [split, ...rest] = splits;
  if (split === undefined) return false;
  const chains = project.state.project.effectChains;
  const joining = groupJoining(project.state.gameAudio);
  changeProject(context, project.session, {
    description: 'Split',
    invocations: [
      ...splitSteps(split, chains, joining),
      ...rest.flatMap((one) => splitSteps(one, chains, joining)),
    ],
    said:
      rest.length === 0
        ? `Split ${split.region.displayName} in two.`
        : `Split ${String(splits.length)} regions in two.`,
  });
  return true;
}

/** Cuts the whole sound at the place into two regions over all of it, as one change. */
function splitWhole(
  context: ShellContext,
  project: ProjectTarget,
  place: SplitPlace,
): string | undefined {
  const { asset, at } = place;
  const parts = splitWholeAsset(asset, at, nextName(project.state, asset), context.ids);
  if (parts === undefined) return 'Move the playhead inside the sound to split it.';
  changeProject(context, project.session, {
    description: 'Split',
    invocations: [addRegionInvocation(parts[0]), addRegionInvocation(parts[1])],
    said: `Split ${asset.displayName} into two regions.`,
  });
  return undefined;
}

function splitCommand(): Command<ShellContext> {
  return regionCommand(
    'edit.split',
    'Split at the playhead',
    (context, invocation) => {
      const found = editedView(context, invocation);
      if (typeof found === 'string') return found;
      const { view, project } = found;
      const shown =
        boundaryArgument(invocation, 'at', view.asset) ?? playheadOf(context, view.asset);
      if (shown === 0 || shown >= view.asset.length) {
        return 'Move the playhead inside the sound to split it.';
      }
      const asset = project.state.project.assets.get(project.owner.asset.id);
      if (asset === undefined) return 'That sound is no longer in the project.';
      const region = project.owner.region?.id;
      const place = { asset, at: onAsset(project.owner, shown), region };
      if (splitRegions(context, project, place)) return undefined;
      if (region !== undefined) return 'The playhead is not inside the region.';
      // Where no region is, a split cuts the whole sound into two regions.
      return splitWhole(context, project, place);
    },
    ['split', 'razor', 'cut', 'divide', 'slice'],
  );
}

/** The split. */
export function splitCommands(): readonly Command<ShellContext>[] {
  return [splitCommand()];
}
