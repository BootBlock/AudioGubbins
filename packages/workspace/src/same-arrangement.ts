/**
 * Whether two arrangements put the same panels in the same places.
 *
 * Compared as text, two arrangements a user could not tell apart would be
 * different: the dock writes a group's fields in another order than a preset
 * does, and lists the centre's groups before the others, so a workspace as it
 * ships would compare unequal to itself once the dock had reported it. A reset
 * would be offered that changed nothing, and a report of nothing new would be
 * recorded as a change.
 */

import {
  DockRegion,
  type PanelGroup,
  type WorkspaceArrangement,
  type WorkspaceLayout,
} from './panel.js';

/** The regions in the one order both arrangements' groups are compared in. */
const REGIONS: readonly string[] = Object.values(DockRegion);

/**
 * The groups, those of each region together in the order the regions are
 * listed. The order of the groups within a region is kept, because it is where
 * each is drawn; the order across regions says nothing a user can see.
 */
function byRegion(groups: readonly PanelGroup[]): readonly PanelGroup[] {
  return [...groups].sort(
    (left, right) => REGIONS.indexOf(left.region) - REGIONS.indexOf(right.region),
  );
}

/**
 * Whether two stored values are the same, whatever order their fields were
 * written in. A field that is absent is the same as one that is `undefined`,
 * as it is once the value is stored.
 */
function sameValue(one: unknown, other: unknown): boolean {
  if (one === other) return true;
  if (Array.isArray(one) || Array.isArray(other)) {
    return (
      Array.isArray(one) &&
      Array.isArray(other) &&
      one.length === other.length &&
      one.every((item, index) => sameValue(item, other[index]))
    );
  }
  if (typeof one !== 'object' || typeof other !== 'object' || one === null || other === null) {
    return false;
  }
  const fields: Readonly<Record<string, unknown>> = { ...one };
  const otherFields: Readonly<Record<string, unknown>> = { ...other };
  const names = new Set([...Object.keys(fields), ...Object.keys(otherFields)]);
  return [...names].every((name) => sameValue(fields[name], otherFields[name]));
}

/**
 * Whether two layouts are the same layout: the same arrangement, under the
 * same name and identity.
 *
 * Field by field, not by the text `JSON.stringify` writes them as: two layouts
 * with the same content written in a different field order give different text,
 * and both sides are read back from storage, so the order follows however each
 * text was written. Compared as text, a copy another build wrote with its
 * fields in another order would look like a different version of every entry it
 * shared, and a whole collection would be set aside for nothing — which on a
 * browser near its quota is the path into the notice that says nothing can be
 * kept.
 */
export function sameLayout(one: WorkspaceLayout, other: WorkspaceLayout): boolean {
  return sameValue(one, other);
}

/** Whether two arrangements put the same panels in the same places, at the same sizes. */
export function sameArrangement(one: WorkspaceArrangement, other: WorkspaceArrangement): boolean {
  return (
    one.activePanelId === other.activePanelId &&
    sameValue(byRegion(one.groups), byRegion(other.groups))
  );
}
