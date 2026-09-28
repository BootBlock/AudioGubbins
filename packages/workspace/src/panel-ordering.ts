/**
 * Where a panel sits among its group's tabs, moved one place at a time.
 *
 * The engine reorders tabs by dragging one over another, which is a pointer
 * gesture with no alternative; this is the keyboard's and a finger's way to the
 * same change (REQ-UX-057, WCAG 2.5.7). Apart from a group's size and a
 * floating group's placement: an order is a list, and neither of those is.
 */

import {
  PANEL_NOT_OPEN,
  groupContaining,
  type OpenPanel,
  type PanelId,
  type WorkspaceLayout,
} from './panel.js';

/** The refusal when a panel is the only one in its group, so it has no neighbour to pass. */
const ALONE_IN_ITS_GROUP = 'That panel is the only one in its group.';

/** The refusal when a panel is already first among its group's tabs. */
const ALREADY_FIRST = 'That panel is already first in its group.';

/** The refusal when a panel is already last among its group's tabs. */
const ALREADY_LAST = 'That panel is already last in its group.';

/**
 * Where a panel goes when it is moved along its group's tabs, or why it
 * cannot.
 *
 * The engine reorders tabs by dragging one over another, which is a pointer
 * gesture with no alternative.
 */
function reorderPlan(
  layout: WorkspaceLayout,
  id: PanelId,
  places: number,
): readonly OpenPanel[] | string {
  const group = groupContaining(layout, id);
  if (group === undefined) return PANEL_NOT_OPEN;
  if (group.panels.length <= 1) return ALONE_IN_ITS_GROUP;

  const at = group.panels.findIndex((panel) => panel.id === id);
  const to = at + places;
  if (to < 0) return ALREADY_FIRST;
  if (to >= group.panels.length) return ALREADY_LAST;

  // The panel taken as a one-element slice rather than by index. Read by index
  // it would be `OpenPanel | undefined` under `noUncheckedIndexedAccess`, and
  // the guard that quiets that could never run: the lookup above found its
  // group, so a search of that group's own panels cannot miss it, and the
  // refusal it would return is one no user could ever be shown.
  return group.panels.toSpliced(at, 1).toSpliced(to, 0, ...group.panels.slice(at, at + 1));
}

/**
 * Why a panel cannot be moved along its group's tabs, or `undefined` when it
 * can.
 */
export function reorderingProblem(
  layout: WorkspaceLayout,
  id: PanelId,
  places: number,
): string | undefined {
  const plan = reorderPlan(layout, id, places);
  return typeof plan === 'string' ? plan : undefined;
}

/** Moves a panel along its group's tabs, and says why it could not. */
export function withPanelReordered(
  layout: WorkspaceLayout,
  id: PanelId,
  places: number,
): WorkspaceLayout | string {
  const plan = reorderPlan(layout, id, places);
  if (typeof plan === 'string') return plan;

  return {
    ...layout,
    groups: layout.groups.map((one) =>
      one.panels.some((panel) => panel.id === id) ? { ...one, panels: plan } : one,
    ),
  };
}
