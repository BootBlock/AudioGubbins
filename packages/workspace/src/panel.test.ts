import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import {
  DockRegion,
  closureProblem,
  movingProblem,
  openingProblem,
  panelsIn,
  withPanel,
  withPanelMoved,
  withoutPanel,
  type PanelDescriptor,
  type PanelKind,
  type WorkspaceLayout,
} from './panel.js';
import { resizingProblem, withGroupResized } from './panel-sizing.js';
import { PanelKinds } from './presets.js';

/**
 * Closing a panel, which is the one layout change a user makes by command.
 *
 * REQ-EDIT-073 makes every meaningful action a command, and closing a panel is
 * the action the docking tabs deliberately do not carry a control for: the
 * engine's own control nests an interactive element inside the tab and cannot
 * be reached from the keyboard at all. The command is the replacement, so what
 * it leaves behind has to be a layout the user can keep working in.
 */

/** A layout with two groups, four panels, and a stated active panel. */
function layout(overrides: Partial<WorkspaceLayout> = {}): WorkspaceLayout {
  return {
    schemaVersion: SCHEMA_VERSIONS.workspaceLayout,
    id: 'mine',
    displayName: 'My workspace',
    builtIn: false,
    groups: [
      {
        region: DockRegion.Centre,
        proportion: 0.7,
        panels: [
          { id: 'editor-a', kind: PanelKinds.Editor },
          { id: 'editor-b', kind: PanelKinds.Editor },
        ],
        activePanelId: 'editor-b',
      },
      {
        region: DockRegion.Left,
        proportion: 0.3,
        panels: [
          { id: 'assets', kind: PanelKinds.AssetBrowser },
          { id: 'inspector', kind: PanelKinds.Inspector },
        ],
        activePanelId: 'assets',
      },
    ],
    activePanelId: 'editor-b',
    ...overrides,
  };
}

describe('withoutPanel', () => {
  it('removes the panel and leaves the rest where they were', () => {
    const after = withoutPanel(layout(), 'editor-b');

    expect(panelsIn(after).map((panel) => panel.id)).toEqual(['editor-a', 'assets', 'inspector']);
    expect(after.groups).toHaveLength(2);
  });

  it('moves the active panel off the one that was closed', () => {
    // A layout naming a panel that is gone makes every command that acts on
    // "this panel" refuse, for a reason the user cannot see or correct.
    const after = withoutPanel(layout(), 'editor-b');

    expect(after.activePanelId).toBe('editor-a');
    expect(panelsIn(after).map((panel) => panel.id)).toContain(after.activePanelId);
  });

  it('leaves the active panel alone when something else was closed', () => {
    const after = withoutPanel(layout(), 'assets');
    expect(after.activePanelId).toBe('editor-b');
  });

  it('gives a group a new active tab when its active one was closed', () => {
    const after = withoutPanel(layout(), 'assets');
    const left = after.groups.find((group) => group.region === DockRegion.Left);

    expect(left?.activePanelId).toBe('inspector');
  });

  it('removes a group left with nothing in it', () => {
    // An empty region is a gap the user can neither fill nor close, so the
    // group goes with its last panel.
    const one = withoutPanel(layout(), 'assets');
    const after = withoutPanel(one, 'inspector');

    expect(after.groups).toHaveLength(1);
    expect(after.groups[0]?.region).toBe(DockRegion.Centre);
  });

  it('refuses to close the last panel, returning the layout unchanged', () => {
    const single = layout({
      groups: [
        {
          region: DockRegion.Centre,
          proportion: 1,
          panels: [{ id: 'editor-a', kind: PanelKinds.Editor }],
          activePanelId: 'editor-a',
        },
      ],
      activePanelId: 'editor-a',
    });

    // The same object, so a caller can tell refusal from a change without
    // comparing the contents.
    expect(withoutPanel(single, 'editor-a')).toBe(single);
  });

  it('leaves a layout alone when the panel is not in it', () => {
    const before = layout();
    const after = withoutPanel(before, 'a-panel-from-another-workspace');

    expect(panelsIn(after).map((panel) => panel.id)).toEqual(
      panelsIn(before).map((panel) => panel.id),
    );
    expect(after.activePanelId).toBe(before.activePanelId);
  });

  it('refuses whatever closing refuses, the last docked panel included', () => {
    // The rule was stated twice, and the copy here knew only "the last panel
    // of all", so it closed the last docked panel beside a floating one.
    const before: WorkspaceLayout = {
      ...layout(),
      groups: [
        {
          region: DockRegion.Centre,
          panels: [{ id: 'editor-a', kind: PanelKinds.Editor }],
          activePanelId: 'editor-a',
          proportion: 1,
        },
        {
          region: DockRegion.Floating,
          panels: [{ id: 'inspector', kind: PanelKinds.Inspector }],
          activePanelId: 'inspector',
          proportion: 1,
          placement: { x: 0.3, y: 0.2, width: 0.4, height: 0.5 },
        },
      ],
      activePanelId: 'editor-a',
    };

    expect(closureProblem(before, 'editor-a')).toBeDefined();
    expect(withoutPanel(before, 'editor-a')).toBe(before);
  });

  it('keeps every panel that is left reachable, however many are closed', () => {
    let current = layout();

    for (const id of ['editor-b', 'assets', 'inspector']) {
      current = withoutPanel(current, id);

      const remaining = panelsIn(current).map((panel) => panel.id);
      expect(remaining).toContain(current.activePanelId);

      for (const group of current.groups) {
        expect(group.panels.map((panel) => panel.id)).toContain(group.activePanelId);
      }
    }

    expect(panelsIn(current).map((panel) => panel.id)).toEqual(['editor-a']);
  });
});

describe('closureProblem', () => {
  it('permits closing a panel that is open, with more than one left', () => {
    expect(closureProblem(layout(), 'assets')).toBeUndefined();
  });

  it('refuses a panel that is not open, and says so in its own words', () => {
    // Distinct from the only-panel refusal. The caller used to tell them apart
    // by comparing object identity, which reported this one as success and
    // announced "The panel is closed." while nothing had closed.
    expect(closureProblem(layout(), 'a-panel-from-another-workspace')).toBe(
      'That panel is not open.',
    );
  });

  it('refuses the last panel, because nothing would be left to work in', () => {
    const single = layout({
      groups: [
        {
          region: DockRegion.Centre,
          proportion: 1,
          panels: [{ id: 'editor-a', kind: PanelKinds.Editor }],
          activePanelId: 'editor-a',
        },
      ],
      activePanelId: 'editor-a',
    });

    expect(closureProblem(single, 'editor-a')).toContain('only panel');
  });
});

/** The descriptor of a panel the user may have only one of. */
function descriptor(
  kind: PanelKind,
  title: string,
  defaultRegion: DockRegion,
  allowsMultiple = false,
): PanelDescriptor {
  return { kind, title, defaultRegion, allowsMultiple, closable: true };
}

describe('withPanel', () => {
  /**
   * Opening a panel, which is what makes closing one reversible.
   *
   * REQ-UX-058 requires the capability and diagnostic surfaces to be reachable,
   * and the docking tab deliberately carries no close control, so without a way
   * to open one, a panel the user closed would have no way back at all.
   */

  it('adds the panel to the group of the region its descriptor names', () => {
    const after = withPanel(layout(), descriptor('capabilities', 'Capabilities', DockRegion.Left));
    const left = after.groups.find((group) => group.region === DockRegion.Left);

    expect(left?.panels.map((panel) => panel.kind)).toEqual([
      PanelKinds.AssetBrowser,
      PanelKinds.Inspector,
      'capabilities',
    ]);
  });

  it('makes a group for a region the layout does not have yet', () => {
    // The whole purpose of `defaultRegion`: a layout does not have to have
    // anticipated a panel for the panel to be openable.
    const after = withPanel(layout(), descriptor('diagnostics', 'Diagnostics', DockRegion.Bottom));
    const bottom = after.groups.find((group) => group.region === DockRegion.Bottom);

    expect(bottom?.panels.map((panel) => panel.kind)).toEqual(['diagnostics']);
    expect(bottom?.proportion).toBeGreaterThan(0);
    expect(bottom?.proportion).toBeLessThanOrEqual(1);
  });

  it('makes the panel the active one, in its group and in the layout', () => {
    const after = withPanel(layout(), descriptor('capabilities', 'Capabilities', DockRegion.Left));
    const left = after.groups.find((group) => group.region === DockRegion.Left);

    expect(after.activePanelId).toBe('capabilities');
    expect(left?.activePanelId).toBe('capabilities');
  });

  it('brings an open panel forward rather than opening a second one', () => {
    // An Inspector in two places shows one selection twice, and neither is the
    // authoritative one (REQ-EDIT-072).
    const after = withPanel(
      layout(),
      descriptor(PanelKinds.Inspector, 'Inspector', DockRegion.Right),
    );

    expect(panelsIn(after).filter((panel) => panel.kind === PanelKinds.Inspector)).toHaveLength(1);
    expect(after.activePanelId).toBe('inspector');
    expect(after.groups.find((group) => group.region === DockRegion.Left)?.activePanelId).toBe(
      'inspector',
    );
  });

  it('opens a second panel of a kind that allows several', () => {
    const after = withPanel(
      layout(),
      descriptor(PanelKinds.Editor, 'Editor', DockRegion.Centre, true),
    );

    expect(panelsIn(after).filter((panel) => panel.kind === PanelKinds.Editor)).toHaveLength(3);
  });

  it('gives each panel of a repeatable kind its own identifier', () => {
    const one = withPanel(
      layout(),
      descriptor(PanelKinds.Editor, 'Editor', DockRegion.Centre, true),
    );
    const two = withPanel(one, descriptor(PanelKinds.Editor, 'Editor', DockRegion.Centre, true));

    const ids = panelsIn(two).map((panel) => panel.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leaves every other panel where it was', () => {
    const before = layout();
    const after = withPanel(before, descriptor('capabilities', 'Capabilities', DockRegion.Left));

    expect(panelsIn(after).map((panel) => panel.id)).toEqual([
      ...panelsIn(before).map((panel) => panel.id),
      'capabilities',
    ]);
  });
});

describe('openingProblem', () => {
  it('allows a panel that is not open', () => {
    expect(
      openingProblem(layout(), descriptor('capabilities', 'Capabilities', DockRegion.Left)),
    ).toBeUndefined();
  });

  it('allows an open panel that is behind another tab', () => {
    // A panel the user cannot see is one that showing genuinely changes.
    expect(
      openingProblem(layout(), descriptor(PanelKinds.Inspector, 'Inspector', DockRegion.Right)),
    ).toBeUndefined();
  });

  it('refuses the panel the user is already looking at, and says so', () => {
    const after = withPanel(
      layout(),
      descriptor(PanelKinds.Inspector, 'Inspector', DockRegion.Right),
    );

    expect(
      openingProblem(after, descriptor(PanelKinds.Inspector, 'Inspector', DockRegion.Right)),
    ).toBe('The Inspector panel is already open.');
  });

  it('never refuses a kind that allows several', () => {
    expect(
      openingProblem(layout(), descriptor(PanelKinds.Editor, 'Editor', DockRegion.Centre, true)),
    ).toBeUndefined();
  });
});

/**
 * Moving and sizing a panel without a pointer.
 *
 * The docking engine moves a panel with the browser's drag-and-drop, which a
 * keyboard cannot reach and a touch screen does not produce, so without these a
 * tablet user could look at the workspace and not arrange it.
 */
describe('withPanel beside another', () => {
  const editor = descriptor(PanelKinds.Editor, 'Editor', DockRegion.Centre, true);

  it('opens a panel in a group of its own beside the one given, the two sharing its width', () => {
    const after = withPanel(layout(), editor, 'editor-a');

    expect(
      after.groups.map((group) => [group.region, group.proportion, group.activePanelId]),
    ).toEqual([
      [DockRegion.Centre, 0.35, 'editor-b'],
      [DockRegion.Centre, 0.35, 'editor'],
      [DockRegion.Left, 0.3, 'assets'],
    ]);
    expect(after.activePanelId).toBe('editor');
  });

  it('opens it where any panel opens beside one docked at an edge', () => {
    const after = withPanel(layout(), editor, 'assets');

    expect(after).toEqual(withPanel(layout(), editor));
  });
});

describe('withPanelMoved', () => {
  it('moves a panel into a region that already has a group', () => {
    const after = withPanelMoved(layout(), 'editor-a', DockRegion.Left);
    if (typeof after === 'string') throw new Error(after);

    const left = after.groups.find((group) => group.region === DockRegion.Left);
    expect(left?.panels.map((panel) => panel.id)).toEqual(['assets', 'inspector', 'editor-a']);
    expect(left?.activePanelId).toBe('editor-a');
    expect(after.activePanelId).toBe('editor-a');
  });

  it('makes a group for a region that has none, at the size a preset would give it', () => {
    const after = withPanelMoved(layout(), 'inspector', DockRegion.Bottom);
    if (typeof after === 'string') throw new Error(after);

    const bottom = after.groups.find((group) => group.region === DockRegion.Bottom);
    expect(bottom?.panels.map((panel) => panel.id)).toEqual(['inspector']);
    expect(bottom?.proportion).toBe(0.2);
  });

  it('gives a floating panel somewhere to float', () => {
    const after = withPanelMoved(layout(), 'inspector', DockRegion.Floating);
    if (typeof after === 'string') throw new Error(after);

    const floating = after.groups.find((group) => group.region === DockRegion.Floating);
    expect(floating?.placement).toBeDefined();
  });

  it('leaves no empty group behind', () => {
    const one = withPanelMoved(layout(), 'assets', DockRegion.Centre);
    if (typeof one === 'string') throw new Error(one);
    const both = withPanelMoved(one, 'inspector', DockRegion.Centre);
    if (typeof both === 'string') throw new Error(both);

    expect(both.groups.map((group) => group.region)).toEqual([DockRegion.Centre]);
    expect(panelsIn(both)).toHaveLength(4);
  });

  it('refuses to move a panel that is not open', () => {
    expect(withPanelMoved(layout(), 'no-such-panel', DockRegion.Left)).toBe(
      'That panel is not open.',
    );
  });

  it('refuses a move that would change nothing, and says where it already is', () => {
    const alone = withPanelMoved(layout(), 'inspector', DockRegion.Bottom);
    if (typeof alone === 'string') throw new Error(alone);

    expect(withPanelMoved(alone, 'inspector', DockRegion.Bottom)).toBe(
      'That panel is already along the bottom.',
    );
  });

  it('refuses to float the last docked panel, which would leave nothing to float over', () => {
    // Floating every panel in turn used to be allowed. With no docked group
    // left, the floating placements were measured against nothing, read back
    // as the whole screen and stored that way.
    let current = layout();
    const floated: string[] = [];
    for (const id of ['editor-a', 'editor-b', 'assets', 'inspector']) {
      const next = withPanelMoved(current, id, DockRegion.Floating);
      if (typeof next === 'string') {
        expect(next).toBe(
          'That is the last docked panel, and floating it would leave nothing for the others to float over.',
        );
        break;
      }
      floated.push(id);
      current = next;
    }

    expect(floated).toEqual(['editor-a', 'editor-b', 'assets']);
    expect(current.groups.some((group) => group.region !== DockRegion.Floating)).toBe(true);
  });

  it('refuses to float the only panel left, which would leave nothing docked either', () => {
    // Asked of the groups with the panel taken out, the only panel's move met
    // an empty list, which the rule reads as nothing to leave undocked.
    let current = layout();
    for (const id of ['editor-b', 'assets', 'inspector']) current = withoutPanel(current, id);
    expect(panelsIn(current).map((panel) => panel.id)).toEqual(['editor-a']);

    expect(movingProblem(current, 'editor-a', DockRegion.Floating)).toBe(
      'That is the last docked panel, and floating it would leave nothing for the others to float over.',
    );
    expect(withPanelMoved(current, 'editor-a', DockRegion.Floating)).toBeTypeOf('string');
  });
});

describe('movingProblem', () => {
  it('gives the answer the move itself gives, so a menu entry can say it first', () => {
    const cases: readonly [string, DockRegion][] = [
      ['editor-a', DockRegion.Left],
      ['no-such-panel', DockRegion.Left],
      ['inspector', DockRegion.Floating],
    ];
    for (const [id, region] of cases) {
      const moved = withPanelMoved(layout(), id, region);
      expect(movingProblem(layout(), id, region)).toBe(
        typeof moved === 'string' ? moved : undefined,
      );
    }
  });
});

describe('closing the last docked panel', () => {
  it('is refused while a floating panel would be left over nothing', () => {
    // The rule was the move's alone, so closing the last docked panel beside a
    // floating one reached the state the move refuses.
    const floated = withPanelMoved(layout(), 'inspector', DockRegion.Floating);
    if (typeof floated === 'string') throw new Error(floated);
    let current = floated;
    for (const id of ['editor-a', 'editor-b', 'assets']) {
      if (closureProblem(current, id) === undefined) current = withoutPanel(current, id);
    }

    expect(panelsIn(current).map((panel) => panel.id)).toEqual(['assets', 'inspector']);
    expect(closureProblem(current, 'assets')).toBe(
      'That is the last docked panel, and closing it would leave nothing for the floating panels to float over.',
    );
  });
});

describe('withGroupResized', () => {
  /** The layout with a right-hand group beside the centre and the left. */
  function threeAcross(): WorkspaceLayout {
    const base = layout();
    return {
      ...base,
      groups: [
        ...base.groups,
        {
          region: DockRegion.Right,
          proportion: 0.2,
          panels: [{ id: 'transport', kind: PanelKinds.Transport }],
          activePanelId: 'transport',
        },
      ],
    };
  }

  it('grows the centre by giving it what its neighbours give up, not a share of its own', () => {
    // The adapter sizes the centre by what the others leave it, so a command
    // that changed the centre's own share stored a smaller number and moved
    // nothing on screen.
    const after = withGroupResized(threeAcross(), 'editor-a', 1);
    if (typeof after === 'string') throw new Error(after);

    expect(after.groups[0]?.proportion).toBe(0.7);
    expect(after.groups[1]?.proportion).toBeCloseTo(0.25, 10);
    expect(after.groups[2]?.proportion).toBeCloseTo(0.15, 10);
  });

  it('never gives a side more than the share at which it would read back as the centre', () => {
    let current = layout();
    for (let press = 0; press < 20; press += 1) {
      const next = withGroupResized(current, 'assets', 1);
      if (typeof next === 'string') break;
      current = next;
    }

    expect(current.groups[1]?.proportion).toBeCloseTo(0.55, 10);
    expect(resizingProblem(current, 'assets', 1)).toBe('That panel is as large as it goes.');
  });

  it('keeps the sides together below the share that leaves the centre room', () => {
    let current = threeAcross();
    for (let press = 0; press < 20; press += 1) {
      const next = withGroupResized(current, 'editor-a', -1);
      if (typeof next === 'string') break;
      current = next;
    }

    const sides = (current.groups[1]?.proportion ?? 0) + (current.groups[2]?.proportion ?? 0);
    expect(sides).toBeLessThanOrEqual(0.8 + 1e-9);
    expect(resizingProblem(current, 'editor-a', -1)).toBe('That panel is as small as it goes.');
  });

  it('grows the group the panel is in, and leaves the others alone', () => {
    const after = withGroupResized(layout(), 'assets', 1);
    if (typeof after === 'string') throw new Error(after);

    expect(after.groups[1]?.proportion).toBeCloseTo(0.35, 10);
    expect(after.groups[0]?.proportion).toBe(0.7);
  });

  it('shrinks it, down to a share it is still usable at', () => {
    let current = layout();
    for (let press = 0; press < 20; press += 1) {
      const next = withGroupResized(current, 'assets', -1);
      if (typeof next === 'string') break;
      current = next;
    }

    expect(current.groups[1]?.proportion).toBeCloseTo(0.1, 10);
    expect(withGroupResized(current, 'assets', -1)).toBe('That panel is as small as it goes.');
  });

  it('grows a floating panel about its centre, rather than asking for a drag', () => {
    // The refusal told a keyboard user to drag the panel's edges, which is the
    // gesture these commands exist to replace.
    const floating = withPanelMoved(layout(), 'inspector', DockRegion.Floating);
    if (typeof floating === 'string') throw new Error(floating);
    const before = floating.groups.find((group) => group.region === DockRegion.Floating);

    const after = withGroupResized(floating, 'inspector', 1);
    if (typeof after === 'string') throw new Error(after);
    const grown = after.groups.find((group) => group.region === DockRegion.Floating)?.placement;

    expect(before?.placement).toEqual({ x: 0.3, y: 0.2, width: 0.4, height: 0.5 });
    expect(grown?.width).toBeCloseTo(0.45, 10);
    expect(grown?.height).toBeCloseTo(0.55, 10);
    expect(grown?.x).toBeCloseTo(0.275, 10);
    expect(grown?.y).toBeCloseTo(0.175, 10);
  });

  it('keeps a floating panel inside the workspace, and stops at the size of it', () => {
    let current = withPanelMoved(layout(), 'inspector', DockRegion.Floating);
    if (typeof current === 'string') throw new Error(current);
    for (let press = 0; press < 30; press += 1) {
      const next = withGroupResized(current, 'inspector', 1);
      if (typeof next === 'string') break;
      current = next;
    }

    const placement = current.groups.find(
      (group) => group.region === DockRegion.Floating,
    )?.placement;
    expect(placement).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(withGroupResized(current, 'inspector', 1)).toBe('That panel is as large as it goes.');
  });

  it('gives the answer the resize itself gives, so a menu entry can say it first', () => {
    const one = withPanelMoved(layout(), 'assets', DockRegion.Centre);
    if (typeof one === 'string') throw new Error(one);
    const single = withPanelMoved(one, 'inspector', DockRegion.Centre);
    if (typeof single === 'string') throw new Error(single);

    expect(resizingProblem(single, 'assets', 1)).toBe(
      'There is nothing beside it to take the room.',
    );
    expect(resizingProblem(layout(), 'assets', 1)).toBeUndefined();
    expect(resizingProblem(layout(), 'no-such-panel', 1)).toBe('That panel is not open.');

    const cases: readonly [WorkspaceLayout, string][] = [
      [single, 'assets'],
      [layout(), 'assets'],
      [layout(), 'no-such-panel'],
    ];
    for (const [current, id] of cases) {
      const resized = withGroupResized(current, id, 1);
      expect(resizingProblem(current, id, 1)).toBe(
        typeof resized === 'string' ? resized : undefined,
      );
    }
  });

  it('refuses when there is nothing beside it to take the room', () => {
    const one = withPanelMoved(layout(), 'assets', DockRegion.Centre);
    if (typeof one === 'string') throw new Error(one);
    const both = withPanelMoved(one, 'inspector', DockRegion.Centre);
    if (typeof both === 'string') throw new Error(both);

    expect(withGroupResized(both, 'assets', 1)).toBe(
      'There is nothing beside it to take the room.',
    );
  });
});
