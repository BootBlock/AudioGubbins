/**
 * Moving one end of a region (REQ-EDIT-014, ADR-0051): its start or its end
 * goes to a position of the view, the playhead where none is given, and the
 * other end stays where it is, so a region is trimmed or widened one side at a
 * time. Dragging a region's edge runs the same commands.
 */

import { unchanged, type Command } from '@audiogubbins/commands';
import {
  RegionBoundary,
  anchorResolver,
  placeRegion,
  regionEnd,
  restateRegion,
} from '@audiogubbins/domain';
import { setRegionInvocation } from '@audiogubbins/project-commands';
import { formatPosition } from '@audiogubbins/timeline';

import { boundaryArgument, playheadOf } from './editor-target.js';
import { changeProject, onAsset } from './project-edits.js';
import type { ShellContext } from './shell-context.js';
import { oneRegion, regionCommand } from './region-target.js';

/** How each end's command is named, and how the end is spoken of beside the other. */
const ENDS: Readonly<
  Record<
    RegionBoundary,
    {
      readonly id: string;
      readonly label: string;
      readonly noun: string;
      readonly order: string;
      readonly other: string;
    }
  >
> = {
  [RegionBoundary.Start]: {
    id: 'region.move-start',
    label: 'Move the region’s start to the playhead',
    noun: 'start',
    order: 'before',
    other: 'end',
  },
  [RegionBoundary.End]: {
    id: 'region.move-end',
    label: 'Move the region’s end to the playhead',
    noun: 'end',
    order: 'after',
    other: 'start',
  },
};

function moveBoundaryCommand(boundary: RegionBoundary): Command<ShellContext> {
  const words = ENDS[boundary];
  return regionCommand(
    words.id,
    words.label,
    (context, invocation) => {
      const found = oneRegion(context, invocation);
      if (typeof found === 'string') return found;
      const { region, asset, project, view } = found;
      const name = region.displayName;
      if (region.assetId !== project.owner.asset.id) {
        return `${name} is not part of the sound this view shows. Open its sound to move its ends.`;
      }
      const placed = placeRegion(anchorResolver(asset), region);
      if (placed === undefined) {
        return `The audio ${name} covered has been removed. Undo that edit to move its ends.`;
      }
      const shown =
        boundaryArgument(invocation, 'to', view.asset) ?? playheadOf(context, view.asset);
      const to = onAsset(project.owner, shown);
      const span =
        boundary === RegionBoundary.Start
          ? { start: to, end: regionEnd(placed) }
          : { start: placed.start, end: to };
      if (to === (boundary === RegionBoundary.Start ? placed.start : regionEnd(placed))) {
        return unchanged('region.boundary-there', `The ${words.noun} of ${name} is there already.`);
      }
      if (span.end <= span.start) {
        return `The ${words.noun} of ${name} must stay ${words.order} its ${words.other}.`;
      }
      const at = formatPosition(shown, view.asset.sampleRate, view.state.timeFormat);
      changeProject(context, project.session, {
        description: `Move the ${words.noun} of ${name}`,
        invocations: [setRegionInvocation(restateRegion(region, asset, span))],
        said: `Moved the ${words.noun} of ${name} to ${at}.`,
      });
      return undefined;
    },
    ['region', words.noun, 'move', 'trim', 'boundary', 'edge', 'playhead'],
  );
}

/** The commands that move a region's start and its end. */
export function regionBoundaryCommands(): readonly Command<ShellContext>[] {
  return [moveBoundaryCommand(RegionBoundary.Start), moveBoundaryCommand(RegionBoundary.End)];
}
