import { act } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  DockRegion,
  type DockHostProps,
  type WorkspaceArrangement,
  type WorkspaceLayout,
} from '@audiogubbins/workspace';
import type * as WorkspacePackage from '@audiogubbins/workspace';

import { LOADING_TIME, loadTheApplication } from './testing/application-modules.js';

/**
 * What the shell does with an arrangement the dock reports, as the shell is
 * wired, with the dock replaced by one that records what it is given.
 *
 * The dock is put back after a refused drag by the shell's own wiring, which a
 * test of the hook alone, with both of its inputs replaced, cannot see: a shell
 * that wired the hook to nothing, or keyed the dock on the layout alone, would
 * pass such a test while the screen kept an arrangement the store had refused.
 */

const dock = vi.hoisted(() => ({
  mounts: 0,
  layout: undefined as WorkspaceLayout | undefined,
  report: undefined as ((arrangement: WorkspaceArrangement) => void) | undefined,
}));

vi.mock('@audiogubbins/workspace', async (importOriginal) => {
  const actual = await importOriginal<typeof WorkspacePackage>();
  const { useEffect } = await import('react');

  function RecordingDock(props: DockHostProps) {
    dock.layout = props.layout;
    dock.report = props.onArrangementChange;
    useEffect(() => {
      dock.mounts += 1;
    }, []);
    return null;
  }

  return { ...actual, DockHost: RecordingDock };
});

beforeAll(loadTheApplication, LOADING_TIME);

/** What takes down the application the test mounted. */
let unmount: (() => void) | undefined;

afterEach(() => {
  act(() => {
    unmount?.();
  });
  unmount = undefined;
  document.body.replaceChildren();
  window.localStorage.clear();
});

/** Mounts the application, and answers the layout the dock was given. */
async function mounted(): Promise<WorkspaceLayout> {
  dock.mounts = 0;
  const { mount } = await import('./app.js');
  const container = document.createElement('div');
  document.body.append(container);
  await act(async () => {
    unmount = mount(container);
    await Promise.resolve();
  });
  if (dock.layout === undefined) throw new Error('the dock was not mounted');
  return dock.layout;
}

/** Reports an arrangement as the dock does after a drag. */
async function reported(arrangement: WorkspaceArrangement): Promise<void> {
  const report = dock.report;
  if (report === undefined) throw new Error('the dock was given nothing to report to');
  await act(async () => {
    report(arrangement);
    await Promise.resolve();
  });
}

describe('an arrangement the dock reports', () => {
  it('mounts the dock again from the layout in use when the arrangement is refused', async () => {
    const layout = await mounted();
    // Counted from here: React's strict mode runs a new component's effects
    // twice, so one mount can count two.
    const first = dock.mounts;

    // Every group floating leaves nothing docked, which the store refuses.
    await reported({
      groups: layout.groups.map((group) => ({
        ...group,
        region: DockRegion.Floating,
        placement: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 },
      })),
      ...(layout.activePanelId === undefined ? {} : { activePanelId: layout.activePanelId }),
    });

    expect(dock.mounts).toBeGreaterThan(first);
    expect(dock.layout).toEqual(layout);
  });

  it('leaves the dock alone when the arrangement is taken, since it drew it already', async () => {
    const layout = await mounted();
    const mounts = dock.mounts;
    const [first, ...rest] = layout.groups;
    if (first === undefined) throw new Error('the layout has no groups');

    await reported({
      groups: [{ ...first, proportion: first.proportion === 0.5 ? 0.4 : 0.5 }, ...rest],
      ...(layout.activePanelId === undefined ? {} : { activePanelId: layout.activePanelId }),
    });

    expect(dock.mounts).toBe(mounts);
  });

  it('leaves the dock alone when the arrangement is the one in use, since nothing changed', async () => {
    // The command answers that it found nothing to do, which is not a refusal:
    // taken for one, every report that moved nothing, a click on a tab already
    // shown, rebuilt the dock and cost each panel its own state.
    const layout = await mounted();
    const mounts = dock.mounts;

    await reported({
      groups: layout.groups,
      ...(layout.activePanelId === undefined ? {} : { activePanelId: layout.activePanelId }),
    });

    expect(dock.mounts).toBe(mounts);
  });
});
