/**
 * Reading an AudioGubbins region back out of a rectangle.
 *
 * The docking engine arranges groups in a grid and reports where each one ended
 * up as a rectangle. AudioGubbins stores a region instead — left, right, bottom
 * or centre — because a region is what a preset declares, what a layout
 * validates, and what survives replacing the engine (`ADR-0010`).
 *
 * Turning one into the other is a decision, so it is made here, in a pure
 * function with no engine types, rather than inside the adapter where it cannot
 * be tested. Without the decision every group would be recorded as centre: on
 * the next load every group would be anchored inside the centre, and the user's
 * left, right and bottom panels would come back as tabs in one stack.
 */

import {
  DockRegion,
  type FloatingPlacement,
  type OpenPanel,
  type PanelGroup,
  type WorkspaceArrangement,
} from '../panel.js';

/** A rectangle, in the coordinates the engine reports. */
export interface Rectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * How close an edge has to be to count as touching.
 *
 * In device pixels. A grid splitter leaves a fraction of a pixel between a
 * group and the edge it is docked against, and a browser's own rounding adds
 * more, so an exact comparison would classify a docked group as floating in the
 * middle.
 */
const EDGE_TOLERANCE = 2;

/**
 * The largest share of the workspace an edge region may take, for a group read
 * back with nothing to say which region it was in.
 *
 * A group occupying most of the width is the main area however far left it
 * starts. The threshold is deliberately generous: a user who drags the asset
 * browser out to half the window still means it to be the left region, and the
 * only cost of being wrong is that the group is treated as the main area, which
 * is where an unclassifiable group belongs anyway. A group that was on a side
 * is not read by it ({@link regionOf}).
 */
const EDGE_SHARE = 0.6;

/** Which edges of the workspace a group is drawn against. */
interface Edges {
  readonly left: boolean;
  readonly right: boolean;
  readonly top: boolean;
  readonly bottom: boolean;
}

/** The edges of `container` that `group` is drawn against. */
function edgesOf(group: Rectangle, container: Rectangle): Edges {
  return {
    left: group.x - container.x <= EDGE_TOLERANCE,
    right: container.x + container.width - (group.x + group.width) <= EDGE_TOLERANCE,
    top: group.y - container.y <= EDGE_TOLERANCE,
    bottom: container.y + container.height - (group.y + group.height) <= EDGE_TOLERANCE,
  };
}

/** Whether a group drawn against `edges` is against the side `region` names, and not across from it. */
function againstItsSide(region: DockRegion, edges: Edges): boolean {
  if (region === DockRegion.Left) return edges.left && !edges.right;
  if (region === DockRegion.Right) return edges.right && !edges.left;
  if (region === DockRegion.Bottom) return edges.bottom && !edges.top;
  return false;
}

/**
 * Which region a group occupies, read from its rectangle alone.
 *
 * The bottom is tested first, because a bottom strip usually spans the whole
 * width and would otherwise satisfy the left test as well.
 */
export function regionFromGeometry(group: Rectangle, container: Rectangle): DockRegion {
  if (container.width <= 0 || container.height <= 0) return DockRegion.Centre;

  const edges = edgesOf(group, container);
  const widthShare = group.width / container.width;
  const heightShare = group.height / container.height;

  if (againstItsSide(DockRegion.Bottom, edges) && heightShare <= EDGE_SHARE)
    return DockRegion.Bottom;
  if (againstItsSide(DockRegion.Left, edges) && widthShare <= EDGE_SHARE) return DockRegion.Left;
  if (againstItsSide(DockRegion.Right, edges) && widthShare <= EDGE_SHARE) return DockRegion.Right;

  return DockRegion.Centre;
}

/**
 * How much of the workspace a group takes, along the axis its region is sized
 * on.
 *
 * A left or right region is sized by width and a bottom region by height, which
 * is the number a user changes when they drag its splitter. Recording the width
 * of a bottom strip would store a number that is always close to one and lose
 * the only dimension the user had set.
 */
export function proportionOf(group: Rectangle, container: Rectangle, region: DockRegion): number {
  if (container.width <= 0 || container.height <= 0) return 1;

  const share =
    region === DockRegion.Bottom ? group.height / container.height : group.width / container.width;

  return Math.min(1, Math.max(0.05, share));
}

/** The rectangle enclosing every group, which is the workspace itself. */
export function enclosing(rectangles: readonly Rectangle[]): Rectangle {
  const [first] = rectangles;
  if (first === undefined) return { x: 0, y: 0, width: 0, height: 0 };

  let left = first.x;
  let top = first.y;
  let right = first.x + first.width;
  let bottom = first.y + first.height;

  for (const rectangle of rectangles) {
    left = Math.min(left, rectangle.x);
    top = Math.min(top, rectangle.y);
    right = Math.max(right, rectangle.x + rectangle.width);
    bottom = Math.max(bottom, rectangle.y + rectangle.height);
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** One group as the engine reported it, measured and stripped of engine types. */
export interface MeasuredGroup {
  readonly rectangle: Rectangle;
  readonly panels: readonly OpenPanel[];

  /** The panel whose tab is in front, as the engine reports it. */
  readonly activePanelId?: string;

  /**
   * Whether the group floats over the workspace rather than being docked in it.
   *
   * Reported by the engine rather than guessed from the rectangle: a floating
   * group can sit anywhere, including against an edge, where its rectangle
   * looks exactly like a docked one.
   */
  readonly floating: boolean;
}

/** A value constrained to the range from 0 to 1. */
function unit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Where a floating group sits, as fractions of the docked workspace.
 *
 * Measured against the docked groups' extent, which is the workspace the group
 * floats over; the floating group itself is left out of that extent, or a group
 * dragged near an edge would stretch the workspace it is measured against.
 *
 * With nothing docked there is no extent, and the engine's own element is
 * measured instead; measured against an empty extent, every floating group
 * would be read back as the whole screen, and stored that way.
 */
function placementOf(group: Rectangle, container: Rectangle): FloatingPlacement {
  if (container.width <= 0 || container.height <= 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  return {
    x: unit((group.x - container.x) / container.width),
    y: unit((group.y - container.y) / container.height),
    width: Math.max(0.01, unit(group.width / container.width)),
    height: Math.max(0.01, unit(group.height / container.height)),
  };
}

/**
 * A group as it was last known, with the rectangle it was drawn in then: how
 * the engine drew the layout it was mounted with, and after that how it drew
 * each arrangement it reported, and how it draws that arrangement again
 * whenever it lays the grid out at a new size.
 */
export interface DrawnGroup {
  readonly group: PanelGroup;
  readonly rectangle: Rectangle;
}

/** Whether two groups hold the same panels, in the same order. */
function samePanels(one: readonly OpenPanel[], other: readonly OpenPanel[]): boolean {
  return one.length === other.length && one.every((panel, index) => panel.id === other[index]?.id);
}

/**
 * Each group of an arrangement paired with the rectangle the engine drew it
 * in, found among the measured groups by the panels it holds.
 */
export function drawnGroups(
  arrangement: WorkspaceArrangement,
  measured: readonly MeasuredGroup[],
): readonly DrawnGroup[] {
  return arrangement.groups.flatMap((group) => {
    const drawn = measured.find((one) => samePanels(one.panels, group.panels));
    return drawn === undefined ? [] : [{ group, rectangle: drawn.rectangle }];
  });
}

/** How far, in pixels, a length may move between two readings and still be the one drawn. */
const DRAWING_TOLERANCE = 1;

/** Whether a length measured now is the one measured before, as the engine rounds it. */
function drawnAt(now: number, before: number): boolean {
  return Math.abs(now - before) <= DRAWING_TOLERANCE;
}

/** The group a measured one was before: in the same region, with the same panels. */
function drawnGroupFor(
  before: readonly DrawnGroup[],
  region: DockRegion,
  panels: readonly OpenPanel[],
): DrawnGroup | undefined {
  return before.find((one) => one.group.region === region && samePanels(one.group.panels, panels));
}

/**
 * Which region a docked group occupies: the side it was on, while it is still
 * drawn against that side, and otherwise the region its rectangle says.
 *
 * Read from the rectangle alone, a side group dragged wider than
 * {@link EDGE_SHARE} would come back as the main area: nothing stops a pointer
 * there, the engine keeping a group no smaller than its own minimum, so the
 * asset browser can be dragged to most of the window. The arrangement would
 * then hold two main areas and be stored so, and at the next mount the asset
 * browser would be a tab beside the editor, its width gone, with nothing said.
 * A group moved to another side, or into the middle, is no longer against the
 * side it was on, and is read from its rectangle alone.
 */
function regionOf(
  measured: MeasuredGroup,
  container: Rectangle,
  before: readonly DrawnGroup[],
): DockRegion {
  const was = before.find(
    (one) =>
      one.group.region !== DockRegion.Floating &&
      one.group.region !== DockRegion.Centre &&
      samePanels(one.group.panels, measured.panels),
  );
  if (
    was !== undefined &&
    againstItsSide(was.group.region, edgesOf(measured.rectangle, container))
  ) {
    return was.group.region;
  }
  return regionFromGeometry(measured.rectangle, container);
}

/**
 * A docked group's share of its region's axis: the share it had while it is
 * still drawn at the size it had, and the share measured once it is not.
 *
 * Read from the pixels alone, a group nobody had resized would read back off
 * the share it was drawn from: the engine draws in whole pixels, and keeps a
 * group no smaller than its own minimum, so Transport's 16% of 614 pixels is
 * drawn at 100. A workspace as it ships would then not match itself once the
 * dock had reported it. The centre takes the room the other groups leave, and
 * no share is ever applied to it, so it is the whole.
 */
function shareOf(
  rectangle: Rectangle,
  container: Rectangle,
  region: DockRegion,
  before: DrawnGroup | undefined,
): number {
  if (region === DockRegion.Centre) return 1;
  const unmoved =
    before !== undefined &&
    (region === DockRegion.Bottom
      ? drawnAt(rectangle.height, before.rectangle.height)
      : drawnAt(rectangle.width, before.rectangle.width));
  return unmoved ? before.group.proportion : proportionOf(rectangle, container, region);
}

/** A floating group's placement: the one it had while it is still where it was drawn. */
function placementFor(
  rectangle: Rectangle,
  container: Rectangle,
  before: DrawnGroup | undefined,
): FloatingPlacement {
  const stored = before?.group.placement;
  if (before === undefined || stored === undefined) return placementOf(rectangle, container);
  const drawn = before.rectangle;
  const unmoved =
    drawnAt(rectangle.x, drawn.x) &&
    drawnAt(rectangle.y, drawn.y) &&
    drawnAt(rectangle.width, drawn.width) &&
    drawnAt(rectangle.height, drawn.height);
  return unmoved ? stored : placementOf(rectangle, container);
}

/**
 * The arrangement a set of measured groups describes.
 *
 * The whole read-back path, with no engine types in it, so that what the
 * adapter records can be tested without mounting a docking engine. The
 * adapter's remaining job is to measure.
 *
 * An arrangement and not a layout: the engine is mounted once with a layout and
 * never learns that the workspace was renamed, so a layout built here would
 * carry an identity that is one rename out of date.
 *
 * `before` is each group as it was last known and where it was drawn then. A
 * group still drawn where it was reads back as it was, so an arrangement nobody
 * has changed reads back as itself.
 */
export function arrangementFrom(
  measured: readonly MeasuredGroup[],
  activePanelId: string | undefined,
  workspace: Rectangle,
  before: readonly DrawnGroup[],
): WorkspaceArrangement {
  const docked = measured.filter((one) => !one.floating).map((one) => one.rectangle);
  const container = docked.length === 0 ? workspace : enclosing(docked);

  // A group the engine reports with no panels is dropped here, so every group
  // that remains has a first panel to fall back on and none needs an
  // identifier invented for it.
  const groups = measured.flatMap((one): PanelGroup[] => {
    const [first] = one.panels;
    if (first === undefined) return [];

    const activePanelId = one.activePanelId ?? first.id;

    if (one.floating) {
      return [
        {
          region: DockRegion.Floating,
          panels: [...one.panels],
          activePanelId,
          proportion: 1,
          placement: placementFor(
            one.rectangle,
            container,
            drawnGroupFor(before, DockRegion.Floating, one.panels),
          ),
        },
      ];
    }

    const region = regionOf(one, container, before);
    return [
      {
        region,
        panels: [...one.panels],
        activePanelId,
        proportion: shareOf(
          one.rectangle,
          container,
          region,
          drawnGroupFor(before, region, one.panels),
        ),
      },
    ];
  });

  const open = groups.flatMap((group) => group.panels);
  const active = open.some((panel) => panel.id === activePanelId) ? activePanelId : open[0]?.id;

  return {
    groups,
    ...(active === undefined ? {} : { activePanelId: active }),
  };
}
