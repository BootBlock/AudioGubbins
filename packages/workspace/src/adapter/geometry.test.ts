import { describe, expect, it } from 'vitest';

import { DockRegion, type PanelGroup } from '../panel.js';
import {
  enclosing,
  arrangementFrom,
  drawnGroups,
  proportionOf,
  type DrawnGroup,
  regionFromGeometry,
  type Rectangle,
} from './geometry.js';

/**
 * Reading a region back out of the docking engine's geometry.
 *
 * Each group is recorded in the region it is drawn in: were every group
 * recorded as the centre, any rearrangement would collapse the workspace into
 * one tab stack on the next load.
 */

/** A workspace 1000 by 800, which is the shape of every case below. */
const WORKSPACE: Rectangle = { x: 0, y: 0, width: 1000, height: 800 };

/** Nothing known of any group before, so every group is read at the size measured. */
const NOTHING_DRAWN: readonly DrawnGroup[] = [];

/** A group of the Editing preset: assets left, editor centre, inspector right, transport below. */
const EDITING = {
  assets: { x: 0, y: 0, width: 200, height: 680 },
  editor: { x: 200, y: 0, width: 580, height: 680 },
  inspector: { x: 780, y: 0, width: 220, height: 680 },
  transport: { x: 0, y: 680, width: 1000, height: 120 },
} as const;

describe('regionFromGeometry', () => {
  it('reads the four regions of the Editing preset', () => {
    expect(regionFromGeometry(EDITING.assets, WORKSPACE)).toBe(DockRegion.Left);
    expect(regionFromGeometry(EDITING.editor, WORKSPACE)).toBe(DockRegion.Centre);
    expect(regionFromGeometry(EDITING.inspector, WORKSPACE)).toBe(DockRegion.Right);
    expect(regionFromGeometry(EDITING.transport, WORKSPACE)).toBe(DockRegion.Bottom);
  });

  it('calls a group that spans the whole workspace the centre', () => {
    expect(regionFromGeometry(WORKSPACE, WORKSPACE)).toBe(DockRegion.Centre);
  });

  it('calls a wide group the centre even when it starts at the left edge', () => {
    // A user who drags the editor out to most of the window still means it to
    // be the main area; the left region is what is narrow, not what is
    // leftmost.
    const wide = { x: 0, y: 0, width: 900, height: 680 };
    expect(regionFromGeometry(wide, WORKSPACE)).toBe(DockRegion.Centre);
  });

  it('calls the left half of a divided bottom strip the bottom region, not the left', () => {
    // The bottom is tested first for exactly this: a bottom strip touches the
    // left edge as well, and one divided in two is narrow enough to be read as
    // the left region. The whole strip is too wide to be, so it cannot show
    // the order.
    const bottomLeft = { x: 0, y: 680, width: 500, height: 120 };
    expect(regionFromGeometry(bottomLeft, WORKSPACE)).toBe(DockRegion.Bottom);
  });

  it('allows a fraction of a pixel at an edge, because a splitter leaves one', () => {
    const nudged = { x: 0.6, y: 0.4, width: 200, height: 679 };
    expect(regionFromGeometry(nudged, WORKSPACE)).toBe(DockRegion.Left);
  });

  it('calls a group in the middle the centre, touching no edge', () => {
    const floating = { x: 300, y: 200, width: 300, height: 300 };
    expect(regionFromGeometry(floating, WORKSPACE)).toBe(DockRegion.Centre);
  });

  it('answers the centre rather than dividing by zero when nothing has been laid out', () => {
    const empty = { x: 0, y: 0, width: 0, height: 0 };
    expect(regionFromGeometry(empty, empty)).toBe(DockRegion.Centre);
  });

  it('reads a workspace that does not start at the origin', () => {
    // The engine reports page coordinates, so the workspace begins wherever the
    // menu bar ends.
    const offset: Rectangle = { x: 40, y: 64, width: 1000, height: 800 };
    const left = { x: 40, y: 64, width: 200, height: 680 };

    expect(regionFromGeometry(left, offset)).toBe(DockRegion.Left);
  });
});

describe('proportionOf', () => {
  it('measures a side region by width and a bottom region by height', () => {
    // The axis the user drags. Measuring a bottom strip by width would record a
    // number that is always close to one and lose the height they set.
    expect(proportionOf(EDITING.assets, WORKSPACE, DockRegion.Left)).toBeCloseTo(0.2, 5);
    expect(proportionOf(EDITING.transport, WORKSPACE, DockRegion.Bottom)).toBeCloseTo(0.15, 5);
  });

  it('keeps a proportion within a range a layout can be rebuilt from', () => {
    const sliver = { x: 0, y: 0, width: 1, height: 680 };

    expect(proportionOf(sliver, WORKSPACE, DockRegion.Left)).toBeGreaterThanOrEqual(0.05);
    expect(proportionOf(WORKSPACE, WORKSPACE, DockRegion.Centre)).toBeLessThanOrEqual(1);
  });

  it('answers one rather than dividing by zero', () => {
    const empty = { x: 0, y: 0, width: 0, height: 0 };
    expect(proportionOf(empty, empty, DockRegion.Centre)).toBe(1);
  });
});

describe('enclosing', () => {
  it('finds the workspace from the groups in it', () => {
    expect(enclosing(Object.values(EDITING))).toEqual(WORKSPACE);
  });

  it('answers an empty rectangle when there are no groups', () => {
    expect(enclosing([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('arrangementFrom', () => {
  const measured = [
    {
      rectangle: EDITING.assets,
      panels: [{ id: 'editing:asset-browser', kind: 'asset-browser' }],
      floating: false,
    },
    {
      rectangle: EDITING.editor,
      panels: [{ id: 'editing:editor', kind: 'editor' }],
      floating: false,
    },
    {
      rectangle: EDITING.inspector,
      panels: [{ id: 'editing:inspector', kind: 'inspector' }],
      floating: false,
    },
    {
      rectangle: EDITING.transport,
      panels: [{ id: 'editing:transport', kind: 'transport' }],
      floating: false,
    },
  ];

  it('records the region each group is actually in', () => {
    // The whole point. The adapter used to record every group as the centre, so
    // the next load anchored them all inside the centre and the workspace came
    // back as one tab strip.
    const layout = arrangementFrom(measured, 'editing:editor', WORKSPACE, NOTHING_DRAWN);

    expect(layout.groups.map((group) => group.region)).toEqual([
      DockRegion.Left,
      DockRegion.Centre,
      DockRegion.Right,
      DockRegion.Bottom,
    ]);
  });

  it('records each group along the axis its region is sized on', () => {
    const layout = arrangementFrom(measured, 'editing:editor', WORKSPACE, NOTHING_DRAWN);
    const proportions = Object.fromEntries(
      layout.groups.map((group) => [group.region, group.proportion]),
    );

    expect(proportions[DockRegion.Left]).toBeCloseTo(0.2, 5);
    expect(proportions[DockRegion.Bottom]).toBeCloseTo(0.15, 5);
  });

  it('drops a group the user emptied', () => {
    const layout = arrangementFrom(
      [...measured, { rectangle: EDITING.editor, panels: [], floating: false }],
      'editing:editor',
      WORKSPACE,
      NOTHING_DRAWN,
    );

    expect(layout.groups).toHaveLength(4);
  });

  it('keeps the active panel when it is still open', () => {
    const layout = arrangementFrom(measured, 'editing:inspector', WORKSPACE, NOTHING_DRAWN);
    expect(layout.activePanelId).toBe('editing:inspector');
  });

  it('moves the active panel onto something that exists when it has gone', () => {
    // A layout naming a panel that is no longer open makes every command that
    // acts on "this panel" refuse, for a reason the user cannot see.
    const layout = arrangementFrom(
      measured,
      'editing:a-panel-that-was-closed',
      WORKSPACE,
      NOTHING_DRAWN,
    );

    expect(layout.groups.flatMap((group) => group.panels).map((panel) => panel.id)).toContain(
      layout.activePanelId,
    );
  });

  it('carries no identity, so a rename cannot be undone by a later drag', () => {
    // It used to spread the layout the dock was mounted with, and the engine is
    // mounted once: after a rename the dock still reported the old name, which
    // was either written back over the rename or refused as another
    // workspace's. An arrangement has nowhere to carry a name.
    const arrangement: Record<string, unknown> = {
      ...arrangementFrom(measured, 'editing:editor', WORKSPACE, NOTHING_DRAWN),
    };

    expect(Object.keys(arrangement).sort()).toEqual(['activePanelId', 'groups']);
  });

  /** The Capabilities panel floating in the middle of the editor. */
  const floatingGroup = {
    rectangle: { x: 300, y: 200, width: 400, height: 300 },
    panels: [{ id: 'editing:capabilities', kind: 'capabilities' }],
    floating: true,
  };

  it('records a floating group as floating, with where it sits', () => {
    // The floating region was accepted by the contract and then mounted as a
    // tab in the centre, and a group the user floated was read back as
    // whichever docked region its rectangle looked like.
    const layout = arrangementFrom(
      [...measured, floatingGroup],
      'editing:editor',
      WORKSPACE,
      NOTHING_DRAWN,
    );
    const floating = layout.groups.find((group) => group.region === DockRegion.Floating);

    expect(floating?.placement).toEqual({ x: 0.3, y: 0.25, width: 0.4, height: 0.375 });
  });

  it('records a floating group against an edge as floating, not docked there', () => {
    const againstTheLeft = { ...floatingGroup, rectangle: { x: 0, y: 0, width: 150, height: 680 } };
    const layout = arrangementFrom(
      [...measured, againstTheLeft],
      'editing:editor',
      WORKSPACE,
      NOTHING_DRAWN,
    );

    expect(layout.groups.at(-1)?.region).toBe(DockRegion.Floating);
  });

  it('measures the docked groups without the floating one', () => {
    // A floating group dragged past an edge would otherwise stretch the
    // workspace every docked group is measured against, and move them all.
    const outside = { ...floatingGroup, rectangle: { x: 900, y: 700, width: 400, height: 300 } };
    const layout = arrangementFrom(
      [...measured, outside],
      'editing:editor',
      WORKSPACE,
      NOTHING_DRAWN,
    );

    expect(layout.groups.slice(0, 4).map((group) => group.region)).toEqual([
      DockRegion.Left,
      DockRegion.Centre,
      DockRegion.Right,
      DockRegion.Bottom,
    ]);
  });

  it('measures a floating group against the workspace when nothing is docked', () => {
    // With no docked group there is no extent to measure against, and every
    // floating group was read back as the whole screen and stored that way.
    const layout = arrangementFrom(
      [floatingGroup],
      'editing:capabilities',
      WORKSPACE,
      NOTHING_DRAWN,
    );

    expect(layout.groups[0]?.placement).toEqual({ x: 0.3, y: 0.25, width: 0.4, height: 0.375 });
  });

  it('gives no docked group a floating position', () => {
    const layout = arrangementFrom(
      [...measured, floatingGroup],
      'editing:editor',
      WORKSPACE,
      NOTHING_DRAWN,
    );
    for (const group of layout.groups.filter((one) => one.region !== DockRegion.Floating)) {
      expect(group.placement).toBeUndefined();
    }
  });

  /** A group of the Editing preset, as a layout stores it. */
  const stored = (
    region: DockRegion,
    id: string,
    kind: string,
    proportion: number,
  ): PanelGroup => ({
    region,
    panels: [{ id, kind }],
    activePanelId: id,
    proportion,
  });

  /**
   * The Editing groups as a layout stored them, each with the rectangle the
   * engine drew it in: shares it could not draw exactly, 0.1996 of 1000 pixels
   * at 200, and 0.1228 of 800, which is 98.24 pixels, at its minimum of 120.
   */
  const drawn: readonly DrawnGroup[] = [
    {
      group: stored(DockRegion.Left, 'editing:asset-browser', 'asset-browser', 0.1996),
      rectangle: EDITING.assets,
    },
    {
      group: stored(DockRegion.Centre, 'editing:editor', 'editor', 1),
      rectangle: EDITING.editor,
    },
    {
      group: stored(DockRegion.Bottom, 'editing:transport', 'transport', 0.1228),
      rectangle: EDITING.transport,
    },
  ];

  it('reads a group still drawn where it was back as it was stored', () => {
    // Read from the pixels, a group nobody had resized came back off the share
    // it was drawn from, rounded or held at the engine's minimum, and a
    // workspace as it ships no longer matched itself once the dock reported it.
    const layout = arrangementFrom(measured, 'editing:editor', WORKSPACE, drawn);
    const shares = Object.fromEntries(
      layout.groups.map((group) => [group.region, group.proportion]),
    );

    expect(shares[DockRegion.Left]).toBe(0.1996);
    expect(shares[DockRegion.Bottom]).toBe(0.1228);
  });

  it('reads it the same when the engine has rounded it since by less than a pixel', () => {
    const rounded = measured.map((one) =>
      one.panels[0]?.id === 'editing:asset-browser'
        ? { ...one, rectangle: { ...one.rectangle, width: 200.6 } }
        : one,
    );
    const layout = arrangementFrom(rounded, 'editing:editor', WORKSPACE, drawn);

    expect(layout.groups.find((group) => group.region === DockRegion.Left)?.proportion).toBe(
      0.1996,
    );
  });

  it('reads a group resized by more than a pixel at the share measured', () => {
    const wider = measured.map((one) =>
      one.panels[0]?.id === 'editing:asset-browser'
        ? { ...one, rectangle: { ...one.rectangle, width: 250 } }
        : one,
    );
    const layout = arrangementFrom(wider, 'editing:editor', WORKSPACE, drawn);

    expect(layout.groups.find((group) => group.region === DockRegion.Left)?.proportion).toBe(0.25);
  });

  it('reads a group at the share measured when it is not a group that was drawn', () => {
    // The same region with other panels is another group, whatever its size.
    const other: readonly DrawnGroup[] = [
      {
        group: stored(DockRegion.Left, 'editing:inspector', 'inspector', 0.1996),
        rectangle: EDITING.assets,
      },
    ];
    const layout = arrangementFrom(measured, 'editing:editor', WORKSPACE, other);

    expect(layout.groups.find((group) => group.region === DockRegion.Left)?.proportion).toBe(0.2);
  });

  it('reads the centre as the whole, since no share is ever applied to it', () => {
    // It takes the room the other groups leave, and its measured share differed
    // from the whole a preset gives it.
    for (const before of [NOTHING_DRAWN, drawn]) {
      const layout = arrangementFrom(measured, 'editing:editor', WORKSPACE, before);
      expect(layout.groups.find((group) => group.region === DockRegion.Centre)?.proportion).toBe(1);
    }
  });

  it('reads a bottom group resized by its height at the share measured', () => {
    // Each read-back rule was held on one axis only: a bottom group's height
    // read against a width would have kept the stored share, so dragging the
    // transport's splitter answered "nothing to do" and the resize was gone
    // after a reload.
    const taller = measured.map((one) =>
      one.panels[0]?.id === 'editing:transport'
        ? { ...one, rectangle: { ...one.rectangle, y: 600, height: 200 } }
        : one,
    );
    const layout = arrangementFrom(taller, 'editing:editor', WORKSPACE, drawn);

    expect(layout.groups.find((group) => group.region === DockRegion.Bottom)?.proportion).toBe(
      0.25,
    );
  });

  it('reads a group moved by two pixels as moved', () => {
    // The tolerance is one pixel, for the engine's own rounding. Widened, it
    // would read every resize smaller than it back as the share it was drawn
    // from.
    const nudged = measured.map((one) =>
      one.panels[0]?.id === 'editing:asset-browser'
        ? { ...one, rectangle: { ...one.rectangle, width: 202 } }
        : one,
    );
    const layout = arrangementFrom(nudged, 'editing:editor', WORKSPACE, drawn);

    expect(layout.groups.find((group) => group.region === DockRegion.Left)?.proportion).toBe(0.202);
  });

  it('reads a group of the same panels in another region at the share measured', () => {
    // The same panels dragged to the other side are another group, and the
    // share they had on the left says nothing about where they are now.
    const onTheRight: readonly DrawnGroup[] = [
      {
        group: stored(DockRegion.Right, 'editing:asset-browser', 'asset-browser', 0.1996),
        rectangle: EDITING.assets,
      },
    ];
    const layout = arrangementFrom(measured, 'editing:editor', WORKSPACE, onTheRight);

    expect(layout.groups.find((group) => group.region === DockRegion.Left)?.proportion).toBe(0.2);
  });

  it('keeps a side group dragged wider than the edge share on its side', () => {
    // Nothing stops a pointer past the edge share. Read from its rectangle
    // alone, the asset browser dragged to most of the window came back as a
    // second main area, and at the next mount it was a tab beside the editor.
    const widened = measured.map((one) => {
      const id = one.panels[0]?.id;
      if (id === 'editing:asset-browser') {
        return { ...one, rectangle: { ...one.rectangle, width: 700 } };
      }
      if (id === 'editing:editor') {
        return { ...one, rectangle: { ...one.rectangle, x: 700, width: 80 } };
      }
      return one;
    });
    const layout = arrangementFrom(widened, 'editing:editor', WORKSPACE, drawn);
    const assets = layout.groups.find((group) => group.panels[0]?.id === 'editing:asset-browser');

    expect(assets?.region).toBe(DockRegion.Left);
    expect(assets?.proportion).toBe(0.7);
    expect(layout.groups.filter((group) => group.region === DockRegion.Centre)).toHaveLength(1);
  });

  it('reads a side group moved off its side by where it is now', () => {
    // Against no edge, the asset browser is not on the left any more, whatever
    // it was before.
    const moved = measured.map((one) =>
      one.panels[0]?.id === 'editing:asset-browser'
        ? { ...one, rectangle: { x: 300, y: 100, width: 200, height: 300 } }
        : one,
    );
    const layout = arrangementFrom(moved, 'editing:editor', WORKSPACE, drawn);

    expect(
      layout.groups.find((group) => group.panels[0]?.id === 'editing:asset-browser')?.region,
    ).toBe(DockRegion.Centre);
  });

  it('reads a floating group resized, or moved down, at the placement measured', () => {
    // Only its `x` was held: a floating group the user made taller, wider or
    // moved down came back the size and place it was drawn at.
    const placement = { x: 0.3004, y: 0.2502, width: 0.3998, height: 0.3751 };
    const floatingDrawn: readonly DrawnGroup[] = [
      {
        group: {
          region: DockRegion.Floating,
          panels: floatingGroup.panels,
          activePanelId: 'editing:capabilities',
          proportion: 1,
          placement,
        },
        rectangle: floatingGroup.rectangle,
      },
    ];

    for (const [axis, change, expected] of [
      ['y', { y: 260 }, 0.325],
      ['width', { width: 500 }, 0.5],
      ['height', { height: 400 }, 0.5],
    ] as const) {
      const changed = arrangementFrom(
        [...measured, { ...floatingGroup, rectangle: { ...floatingGroup.rectangle, ...change } }],
        'editing:editor',
        WORKSPACE,
        floatingDrawn,
      );

      expect(changed.groups.at(-1)?.placement?.[axis]).toBe(expected);
    }
  });

  it('keeps a floating group where it was drawn while it has not moved', () => {
    const placement = { x: 0.3004, y: 0.2502, width: 0.3998, height: 0.3751 };
    const floatingDrawn: readonly DrawnGroup[] = [
      {
        group: {
          region: DockRegion.Floating,
          panels: floatingGroup.panels,
          activePanelId: 'editing:capabilities',
          proportion: 1,
          placement,
        },
        rectangle: floatingGroup.rectangle,
      },
    ];
    const kept = arrangementFrom(
      [...measured, floatingGroup],
      'editing:editor',
      WORKSPACE,
      floatingDrawn,
    );
    expect(kept.groups.at(-1)?.placement).toEqual(placement);

    const moved = arrangementFrom(
      [...measured, { ...floatingGroup, rectangle: { ...floatingGroup.rectangle, x: 310 } }],
      'editing:editor',
      WORKSPACE,
      floatingDrawn,
    );
    expect(moved.groups.at(-1)?.placement?.x).toBe(0.31);
  });
});

describe('drawnGroups', () => {
  it('pairs each group with the rectangle it was drawn in, found by its panels', () => {
    const groups: readonly PanelGroup[] = [
      {
        region: DockRegion.Right,
        panels: [{ id: 'editing:inspector', kind: 'inspector' }],
        activePanelId: 'editing:inspector',
        proportion: 0.22,
      },
      {
        region: DockRegion.Left,
        panels: [{ id: 'editing:gone', kind: 'asset-browser' }],
        activePanelId: 'editing:gone',
        proportion: 0.2,
      },
    ];
    const measured = [
      {
        rectangle: EDITING.inspector,
        panels: [{ id: 'editing:inspector', kind: 'inspector' }],
        floating: false,
      },
    ];

    expect(drawnGroups({ groups }, measured)).toEqual([
      { group: groups[0], rectangle: EDITING.inspector },
    ]);
  });
});
