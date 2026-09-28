/**
 * How much room a panel's group takes, changed a step at a time.
 *
 * The engine resizes a group by dragging the splitter beside it, which is a
 * pointer gesture; these are the keyboard's and a finger's way to the same
 * change (REQ-UX-057). Apart from the rest of the panel contract because the
 * limits a size is kept inside, and how the centre is sized by what the others
 * leave it, are a concept of their own. Where a floating group sits is
 * `panel-nudging.ts` and where a panel sits among its group's tabs is
 * `panel-ordering.ts`: each is a change of one step to one thing, and none of
 * the three is the others.
 */

import {
  PANEL_NOT_OPEN,
  DEFAULT_FLOATING_PLACEMENT,
  DockRegion,
  differs,
  groupContaining,
  isDocked,
  type FloatingPlacement,
  type PanelGroup,
  type PanelId,
  type WorkspaceLayout,
} from './panel.js';

/**
 * How much of its region a group gains or loses in one step.
 *
 * Coarse enough that a keyboard user reaches a useful size in a few presses,
 * fine enough that they can stop where they want.
 */
const RESIZE_STEP = 0.05;

/** The smallest and largest share a docked group may take. */
const PROPORTION_RANGE = { minimum: 0.1, maximum: 0.9 } as const;

/**
 * The largest share a left, right or bottom group may take by a command, so
 * the main area keeps most of the room.
 *
 * Below the share past which a group read back with nothing to say which region
 * it was in counts as the main area (`EDGE_SHARE` in `adapter/geometry.ts`).
 * Were the read-back to go by the rectangle alone, a side grown past it by a
 * command would come back as the centre, and the panel the user had just been
 * told had more room on the left would then be in the middle.
 */
const LARGEST_SIDE_SHARE = 0.55;

/**
 * The most the left and the right may take together, so the main area keeps a
 * share of its own. Past it the engine would stop moving at the centre's
 * minimum width while the command went on saying the panel had more room.
 */
const LARGEST_SIDES_TOGETHER = 0.8;

/** The largest share a docked group may take, given the shares of the others. */
function largestShare(group: PanelGroup, shares: ReadonlyMap<PanelGroup, number>): number {
  if (group.region === DockRegion.Centre) return PROPORTION_RANGE.maximum;
  if (group.region === DockRegion.Bottom) return LARGEST_SIDE_SHARE;

  const otherSides = [...shares]
    .filter(
      ([one]) =>
        one !== group && (one.region === DockRegion.Left || one.region === DockRegion.Right),
    )
    .reduce((sum, [, share]) => sum + share, 0);
  return Math.min(LARGEST_SIDE_SHARE, LARGEST_SIDES_TOGETHER - otherSides);
}

/** A group's share, moved by a number of steps and kept inside the range. */
function resized(group: PanelGroup, steps: number): number {
  const wanted = group.proportion + steps * RESIZE_STEP;
  return Math.min(PROPORTION_RANGE.maximum, Math.max(PROPORTION_RANGE.minimum, wanted));
}

/** The smallest a floating panel may be, as a share of the workspace each way. */
const SMALLEST_FLOATING_SHARE = 0.15;

/**
 * A floating group's placement, grown or shrunk about its centre.
 *
 * Kept inside the workspace: a panel grown past an edge is moved back in rather
 * than drawn where the user cannot reach its edges.
 */
function resizedPlacement(placement: FloatingPlacement, steps: number): FloatingPlacement {
  const size = (share: number): number =>
    Math.min(1, Math.max(SMALLEST_FLOATING_SHARE, share + steps * RESIZE_STEP));

  const width = size(placement.width);
  const height = size(placement.height);
  const centreX = placement.x + placement.width / 2;
  const centreY = placement.y + placement.height / 2;

  return {
    x: Math.min(1 - width, Math.max(0, centreX - width / 2)),
    y: Math.min(1 - height, Math.max(0, centreY - height / 2)),
    width,
    height,
  };
}

/** The refusal when a resize has no neighbour to take the room. */
const NOTHING_BESIDE_IT = 'There is nothing beside it to take the room.';

/**
 * The groups a resize changes, with what each becomes, or why it cannot.
 *
 * A group in the centre is sized by what the others leave it: the adapter gives
 * a left, right or bottom group its share of the workspace and the centre takes
 * the rest, which is what a docking engine does. Growing the centre is
 * therefore shrinking its neighbours, and a command that changed the centre's
 * own share instead would store a smaller number and move nothing on screen.
 * Growing a side group takes its room from the centre in the same way, so the
 * shares of the docked groups are not meant to add up to one: the centre's is
 * whatever is left.
 *
 * A floating group is sized by its placement, grown or shrunk about its centre,
 * rather than refused with an instruction to drag its edges, which is the
 * pointer-only gesture these commands exist to replace.
 */
function resizePlan(
  layout: WorkspaceLayout,
  id: PanelId,
  steps: number,
): ReadonlyMap<PanelGroup, PanelGroup> | string {
  const group = groupContaining(layout, id);
  if (group === undefined) return PANEL_NOT_OPEN;

  const limit =
    steps > 0 ? 'That panel is as large as it goes.' : 'That panel is as small as it goes.';

  if (group.region === DockRegion.Floating) {
    const placement = group.placement ?? DEFAULT_FLOATING_PLACEMENT;
    const next = resizedPlacement(placement, steps);
    const changed = differs(next.width, placement.width) || differs(next.height, placement.height);
    return changed ? new Map([[group, { ...group, placement: next }]]) : limit;
  }

  const docked = layout.groups.filter(isDocked);
  if (docked.length <= 1) return NOTHING_BESIDE_IT;

  // The centre's neighbours move the other way: the room has to come from
  // somewhere. Another centre group is not a neighbour, because the adapter
  // sizes the main area by what the others leave it and gives a second centre
  // group no share of its own.
  const changing =
    group.region === DockRegion.Centre
      ? docked.filter((one) => one.region !== DockRegion.Centre)
      : [group];
  if (changing.length === 0) return NOTHING_BESIDE_IT;

  const direction = group.region === DockRegion.Centre ? -steps : steps;

  // Each share is decided against the others as they will be, not as they
  // were, so two sides grown in one step cannot pass their limit together.
  const shares = new Map(docked.map((one) => [one, one.proportion]));
  for (const one of changing) {
    shares.set(one, Math.min(resized(one, direction), largestShare(one, shares)));
  }

  const plan = new Map(
    changing.flatMap((one): [PanelGroup, PanelGroup][] => {
      const share = shares.get(one) ?? one.proportion;
      return differs(share, one.proportion) ? [[one, { ...one, proportion: share }]] : [];
    }),
  );

  // A step that moved nothing, or moved a share the wrong way because a limit
  // now sits below it, is refused rather than reported as more room.
  const wrongWay = [...plan].some(([one, next]) =>
    direction > 0 ? next.proportion < one.proportion : next.proportion > one.proportion,
  );
  return plan.size === 0 || wrongWay ? limit : plan;
}

/**
 * Why a panel's group cannot be grown or shrunk, or `undefined` when it can.
 *
 * Asked separately so a menu entry can say why before the user chooses it.
 */
export function resizingProblem(
  layout: WorkspaceLayout,
  id: PanelId,
  steps: number,
): string | undefined {
  const plan = resizePlan(layout, id, steps);
  return typeof plan === 'string' ? plan : undefined;
}

/**
 * Grows or shrinks the group holding a panel, and says why it could not.
 *
 * The engine resizes a group by dragging the splitter between it and its
 * neighbour, which is a pointer gesture. Without this, a keyboard user would
 * have no way to change how much room a panel takes.
 */
export function withGroupResized(
  layout: WorkspaceLayout,
  id: PanelId,
  steps: number,
): WorkspaceLayout | string {
  const plan = resizePlan(layout, id, steps);
  if (typeof plan === 'string') return plan;

  return { ...layout, groups: layout.groups.map((one) => plan.get(one) ?? one) };
}
