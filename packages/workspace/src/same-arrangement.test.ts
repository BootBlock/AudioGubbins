import { describe, expect, it } from 'vitest';

import {
  DockRegion,
  type OpenPanel,
  type PanelGroup,
  type WorkspaceArrangement,
  type WorkspaceLayout,
} from './panel.js';
import { sameArrangement, sameLayout } from './same-arrangement.js';

const LEFT: PanelGroup = {
  region: DockRegion.Left,
  proportion: 0.2,
  panels: [{ id: 'assets', kind: 'asset-browser' }],
  activePanelId: 'assets',
};

const FIRST: OpenPanel = { id: 'first', kind: 'editor', parameters: { asset: 'a1', zoom: 2 } };
const SECOND: OpenPanel = { id: 'second', kind: 'editor' };

const CENTRE: PanelGroup = {
  region: DockRegion.Centre,
  proportion: 1,
  panels: [FIRST, SECOND],
  activePanelId: 'first',
};

/** A preset's arrangement, its fields in the order a preset writes them. */
const SHIPPED: WorkspaceArrangement = { groups: [LEFT, CENTRE], activePanelId: 'first' };

describe('sameLayout', () => {
  it('reads the layouts, not the order their fields were written in', () => {
    // Both sides are read back from storage, so the field order follows
    // however each text was written. Compared as text, a copy written by an
    // earlier build looked like a different version of every entry it shared,
    // and a whole collection was set aside for nothing.
    const one = JSON.parse(
      '{"schemaVersion":1,"id":"w","displayName":"Mine","builtIn":false,"groups":[{"region":"main","proportion":1,"activePanelId":"p","panels":[{"id":"p","kind":"editor"}]}]}',
    ) as WorkspaceLayout;
    const other = JSON.parse(
      '{"groups":[{"panels":[{"kind":"editor","id":"p"}],"activePanelId":"p","proportion":1,"region":"main"}],"builtIn":false,"displayName":"Mine","id":"w","schemaVersion":1}',
    ) as WorkspaceLayout;

    expect(JSON.stringify(one)).not.toBe(JSON.stringify(other));
    expect(sameLayout(one, other)).toBe(true);

    // A rename is a different version, which the arrangement alone cannot see.
    expect(sameLayout(one, { ...other, displayName: 'Renamed' })).toBe(false);
  });
});

describe('sameArrangement', () => {
  it('matches an arrangement written in another order, as the dock writes one', () => {
    // The dock lists the centre first, and writes a group's fields in another
    // order: compared as text, a workspace as it ships differed from itself.
    const reported: WorkspaceArrangement = {
      activePanelId: 'first',
      groups: [
        {
          region: DockRegion.Centre,
          panels: [
            { kind: 'editor', parameters: { zoom: 2, asset: 'a1' }, id: 'first' },
            { kind: 'editor', id: 'second' },
          ],
          activePanelId: 'first',
          proportion: 1,
        },
        {
          activePanelId: 'assets',
          panels: [{ kind: 'asset-browser', id: 'assets' }],
          region: DockRegion.Left,
          proportion: 0.2,
        },
      ],
    };

    expect(sameArrangement(reported, SHIPPED)).toBe(true);
  });

  it('takes a field that is absent as the same as one left undefined', () => {
    // As a value built from what the dock reported can hold one, and as storing
    // it would drop it.
    const withUndefined: unknown = {
      groups: [{ ...LEFT, placement: undefined }, CENTRE],
      activePanelId: 'first',
    };
    expect(sameArrangement(withUndefined as WorkspaceArrangement, SHIPPED)).toBe(true);
  });

  it('tells apart every difference a user can see', () => {
    const changed: readonly WorkspaceArrangement[] = [
      { ...SHIPPED, activePanelId: 'second' },
      { groups: [{ ...LEFT, proportion: 0.25 }, CENTRE], activePanelId: 'first' },
      { groups: [{ ...LEFT, region: DockRegion.Right }, CENTRE], activePanelId: 'first' },
      { groups: [LEFT, { ...CENTRE, activePanelId: 'second' }], activePanelId: 'first' },
      {
        groups: [LEFT, { ...CENTRE, panels: [...CENTRE.panels].reverse() }],
        activePanelId: 'first',
      },
      {
        groups: [LEFT, { ...CENTRE, panels: [FIRST, { ...SECOND, title: 'take.wav' }] }],
        activePanelId: 'first',
      },
      {
        groups: [
          LEFT,
          { ...CENTRE, panels: [{ ...FIRST, parameters: { asset: 'a2', zoom: 2 } }, SECOND] },
        ],
        activePanelId: 'first',
      },
      { groups: [LEFT], activePanelId: 'first' },
    ];

    for (const one of changed) expect(sameArrangement(one, SHIPPED)).toBe(false);
  });

  it('keeps the order of the groups in one region, which is where each is drawn', () => {
    const above: PanelGroup = {
      ...LEFT,
      panels: [{ id: 'inspector', kind: 'inspector' }],
      activePanelId: 'inspector',
    };
    const one: WorkspaceArrangement = { groups: [LEFT, above, CENTRE] };
    const other: WorkspaceArrangement = { groups: [above, LEFT, CENTRE] };

    expect(sameArrangement(one, other)).toBe(false);
    expect(sameArrangement(one, { groups: [CENTRE, LEFT, above] })).toBe(true);
  });
});
