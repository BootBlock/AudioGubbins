/**
 * Where a floating panel's group sits, moved a step at a time.
 *
 * The engine moves a floating group by dragging its title bar, which is a
 * pointer gesture; these are the keyboard's and a finger's way to the same
 * change (REQ-UX-057, WCAG 2.5.7). Apart from how much room a group takes,
 * because a placement is kept inside the workspace's own edges and a size is
 * kept inside what the groups beside it leave.
 */

import {
  PANEL_NOT_OPEN,
  DEFAULT_FLOATING_PLACEMENT,
  DockRegion,
  differs,
  groupContaining,
  type FloatingPlacement,
  type PanelGroup,
  type PanelId,
  type WorkspaceLayout,
} from './panel.js';

/** How far one nudge moves a floating group, as a share of the workspace. */
const MOVE_STEP = 0.05;

/**
 * A floating group's placement, moved and kept inside the workspace.
 *
 * Kept inside so that a group cannot be nudged out of reach: moved past an
 * edge it stops against it, which also gives the user a way back from wherever
 * a drag left it.
 */
function movedPlacement(placement: FloatingPlacement, x: number, y: number): FloatingPlacement {
  const along = (start: number, size: number, steps: number): number =>
    Math.min(1 - size, Math.max(0, start + steps * MOVE_STEP));

  return {
    ...placement,
    x: along(placement.x, placement.width, x),
    y: along(placement.y, placement.height, y),
  };
}

/**
 * The floating group a nudge moves, with where it goes, or why it cannot move.
 *
 * Only a floating group has a place of its own to move: a docked one is where
 * its region puts it, and the commands that change that are the ones that move
 * a panel to another region.
 */
function movePlan(
  layout: WorkspaceLayout,
  id: PanelId,
  x: number,
  y: number,
): ReadonlyMap<PanelGroup, PanelGroup> | string {
  const group = groupContaining(layout, id);
  if (group === undefined) return PANEL_NOT_OPEN;
  if (group.region !== DockRegion.Floating) return ONLY_A_FLOATING_PANEL_MOVES;

  const placement = group.placement ?? DEFAULT_FLOATING_PLACEMENT;
  const next = movedPlacement(placement, x, y);
  const changed = differs(next.x, placement.x) || differs(next.y, placement.y);
  return changed ? new Map([[group, { ...group, placement: next }]]) : AGAINST_THE_EDGE;
}

/** The refusal when a panel is docked, so its place is its region's. */
const ONLY_A_FLOATING_PANEL_MOVES =
  'Only a floating panel can be nudged. Use the commands that move this panel to a side.';

/** The refusal when a floating group is already against the edge it is nudged towards. */
const AGAINST_THE_EDGE = 'That panel is already against that edge.';

/**
 * Why a floating panel cannot be nudged, or `undefined` when it can.
 *
 * Asked separately so a menu entry can say why before the user chooses it.
 */
export function nudgingProblem(
  layout: WorkspaceLayout,
  id: PanelId,
  x: number,
  y: number,
): string | undefined {
  const plan = movePlan(layout, id, x, y);
  return typeof plan === 'string' ? plan : undefined;
}

/**
 * Nudges the floating group holding a panel, and says why it could not.
 *
 * The engine moves a floating group by dragging its header, which is a pointer
 * gesture with no alternative: without this, a panel could be floated, resized
 * and re-docked from the keyboard, and moved only by dragging (WCAG 2.5.7).
 */
export function withGroupNudged(
  layout: WorkspaceLayout,
  id: PanelId,
  x: number,
  y: number,
): WorkspaceLayout | string {
  const plan = movePlan(layout, id, x, y);
  if (typeof plan === 'string') return plan;

  return { ...layout, groups: layout.groups.map((one) => plan.get(one) ?? one) };
}
