/**
 * Splitting at the playhead (ADR-0051): a region there becomes two regions at
 * the split, each keeping the processing that covers its part and the loop
 * where the loop lies within it; where no region is, the sound is cut into two
 * regions over all of it, which is how a long recording is cut into many
 * sounds. The razor's click runs it.
 */

import type { Command } from '@audiogubbins/commands';
import {
  anchorResolver,
  derivedSampleCount,
  type AnchorResolver,
  type Asset,
  type Region,
  type SampleCount,
} from '@audiogubbins/domain';
import { addRegionInvocation, setRegionInvocation } from '@audiogubbins/project-commands';

import { editedView } from './edit-target.js';
import { boundaryArgument, playheadOf } from './editor-target.js';
import { changeProject, onAsset, type ProjectTarget } from './project-edits.js';
import type { ShellContext } from './shell-context.js';
import { nextName, regionCommand, restated } from './region-target.js';

/** The two regions `region` becomes split at `at`, each keeping the processing over its part. */
function splitRegion(
  context: ShellContext,
  found: { readonly region: Region; readonly asset: Asset; readonly resolver: AnchorResolver },
  at: number,
): readonly [Region, Region] | undefined {
  const { region, asset, resolver } = found;
  const span = resolver.span(region.basis, { start: region.start, end: region.end });
  if (span === undefined || at <= span.start || at >= span.end) return undefined;
  const covers = (part: { readonly start: number; readonly end: number }) =>
    region.operations.filter((operation) => {
      const range = resolver.span(operation.basis, operation.range);
      return range !== undefined && range.start < part.end && range.end > part.start;
    });
  const loop =
    region.loop === undefined
      ? undefined
      : resolver.span(region.loop.basis, { start: region.loop.start, end: region.loop.end });
  const before = { start: span.start, end: at };
  const after = { start: at, end: span.end };
  const keepsLoop = (part: typeof before) =>
    loop !== undefined && loop.start >= part.start && loop.end <= part.end;
  const { loop: _loop, ...unlooped } = region;
  const first = restated(keepsLoop(before) ? region : unlooped, asset, before);
  const second: Region = restated(
    {
      ...(keepsLoop(after) ? region : unlooped),
      id: context.ids.next<'RegionId'>(),
      displayName: `${region.displayName} (2)`,
      operations: covers(after).map((operation) => ({
        ...operation,
        id: context.ids.next<'EditOperationId'>(),
      })),
    },
    asset,
    after,
  );
  return [{ ...first, operations: covers(before) }, second];
}

/** Where a split is: the asset as the project holds it, and the boundary on its timeline. */
interface SplitPlace {
  readonly asset: Asset;
  readonly at: SampleCount;
  readonly length: number;
  readonly region: Region['id'] | undefined;
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
      // Wrapped, so the pair a region becomes stays one element.
      const parts = splitRegion(context, { region, asset, resolver }, at);
      return parts === undefined ? [] : [parts];
    });
  const [split, ...rest] = splits;
  if (split === undefined) return false;
  const [first, second] = split;
  changeProject(context, project.session, {
    description: 'Split',
    invocations: [
      setRegionInvocation(first),
      addRegionInvocation(second),
      ...rest.flatMap(([one, other]) => [setRegionInvocation(one), addRegionInvocation(other)]),
    ],
    said:
      rest.length === 0
        ? `Split ${first.displayName} in two.`
        : `Split ${String(splits.length)} regions in two.`,
  });
  return true;
}

/** Cuts the whole sound at the place into two regions over all of it, as one change. */
function splitWhole(context: ShellContext, project: ProjectTarget, place: SplitPlace): void {
  const { asset, at } = place;
  const made = (name: string, start: number, end: number): Region => ({
    id: context.ids.next<'RegionId'>(),
    assetId: asset.id,
    displayName: name,
    basis: asset.edits.length,
    start: derivedSampleCount(start),
    end: derivedSampleCount(end),
    tags: [],
    operations: [],
  });
  const name = nextName(project.state, asset);
  changeProject(context, project.session, {
    description: 'Split',
    invocations: [
      addRegionInvocation(made(name, 0, at)),
      addRegionInvocation(made(`${name} (2)`, at, place.length)),
    ],
    said: `Split ${asset.displayName} into two regions.`,
  });
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
      const place = { asset, at: onAsset(project.owner, shown), length: view.asset.length, region };
      if (splitRegions(context, project, place)) return undefined;
      if (region !== undefined) return 'The playhead is not inside the region.';
      // Where no region is, a split cuts the whole sound into two regions.
      splitWhole(context, project, place);
      return undefined;
    },
    ['split', 'razor', 'cut', 'divide', 'slice'],
  );
}

/** The split. */
export function splitCommands(): readonly Command<ShellContext>[] {
  return [splitCommand()];
}
