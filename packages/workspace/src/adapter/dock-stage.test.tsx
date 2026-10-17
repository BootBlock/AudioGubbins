import { act, render } from '@testing-library/react';
import { useContext, useLayoutEffect, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { DockRegion, type WorkspaceLayout } from '../panel.js';
import { DockMotionLevel, type DockMotion } from './dock-motion.js';
import { DockStage, DockStageContext, type StagedArrangement } from './dock-stage.js';

/**
 * The stage the dock is built on: what it draws while a view transition waits
 * to capture the old dock, and what it does to the old dock first.
 *
 * The browser's transition is replaced with one a test runs step by step: it
 * holds the update until the test says the old dock has been captured, as the
 * browser holds it until the next frame.
 */

const FULL: DockMotion = {
  level: DockMotionLevel.Full,
  move: { duration: 240, easing: 'ease-in-out' },
  enter: { duration: 240, easing: 'ease-out' },
  enterScale: 0.98,
};

/** A layout of one group holding the given panel. */
function layout(id: string, panel: string): WorkspaceLayout {
  return {
    schemaVersion: SCHEMA_VERSIONS.workspaceLayout,
    id,
    displayName: id,
    builtIn: false,
    groups: [
      {
        region: DockRegion.Centre,
        proportion: 1,
        panels: [{ id: panel, kind: panel }],
        activePanelId: panel,
      },
    ],
  };
}

/** What a dock built on the stage did, by the key it was built under. */
const built = {
  drawn: [] as string[],
  halted: [] as string[],
  elements: new Map<string, HTMLElement>(),
};

/**
 * A dock as the adapter is to the stage: it draws one group holding its
 * layout's panel, and attaches to the stage as it is built.
 */
function FakeDock({ shown }: { readonly shown: StagedArrangement }): ReactNode {
  const attach = useContext(DockStageContext);
  useLayoutEffect(() => {
    const element = document.createElement('div');
    built.elements.set(shown.key, element);
    const panel = shown.layout.groups[0]?.panels[0]?.id ?? '';
    return attach?.({
      groups: () => [{ element, panels: [panel], activePanel: panel }],
      halt: () => {
        built.halted.push(shown.key);
      },
    });
  }, [attach, shown]);
  built.drawn.push(shown.key);
  return <span data-testid="dock">{shown.key}</span>;
}

function stage(arrangement: StagedArrangement, motion: DockMotion = FULL): ReactNode {
  return (
    <DockStage arrangement={arrangement} motion={motion}>
      {(shown) => <FakeDock key={shown.key} shown={shown} />}
    </DockStage>
  );
}

/** A view transition the test steps through. */
interface HeldTransition {
  readonly update: () => Promise<void>;
  readonly finish: () => void;
  readonly namedWhenStarted: string;
}

/** Replaces the browser's view transitions with ones the test holds. */
function holdTransitions(): HeldTransition[] {
  const held: HeldTransition[] = [];
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: (update: () => Promise<void>) => {
      let finish = (): void => undefined;
      const finished = new Promise<undefined>((resolve) => {
        finish = () => {
          resolve(undefined);
        };
      });
      held.push({
        update,
        finish,
        namedWhenStarted: [...built.elements.values()]
          .map((element) => element.style.viewTransitionName)
          .join(','),
      });
      return { finished, ready: Promise.resolve(), updateCallbackDone: Promise.resolve() };
    },
  });
  return held;
}

afterEach(() => {
  Reflect.deleteProperty(document, 'startViewTransition');
  document.documentElement.removeAttribute('data-ag-dock-transition');
  built.drawn = [];
  built.halted = [];
  built.elements.clear();
  vi.restoreAllMocks();
});

describe('the dock stage', () => {
  it('builds the dock again at once where the browser has no view transitions', () => {
    const { rerender, getByTestId } = render(stage({ key: 'a', layout: layout('w', 'editor') }));

    rerender(stage({ key: 'b', layout: layout('w', 'inspector') }));

    expect(getByTestId('dock').textContent).toBe('b');
  });

  it('builds the dock again at once when the motion level is off', () => {
    const held = holdTransitions();
    const off = { ...FULL, level: DockMotionLevel.Off };
    const { rerender, getByTestId } = render(
      stage({ key: 'a', layout: layout('w', 'editor') }, off),
    );

    rerender(stage({ key: 'b', layout: layout('w', 'inspector') }, off));

    expect(getByTestId('dock').textContent).toBe('b');
    expect(held).toEqual([]);
  });

  it('keeps the old dock drawn, silenced and named, until the transition captures it', async () => {
    // Drawn at once, the old dock would never be captured; left reporting, an
    // arrangement it owed would be stored over the one replacing it.
    const held = holdTransitions();
    const { rerender, getByTestId } = render(stage({ key: 'a', layout: layout('w', 'editor') }));

    rerender(stage({ key: 'b', layout: layout('w', 'inspector') }));

    expect(getByTestId('dock').textContent).toBe('a');
    expect(built.halted).toEqual(['a']);
    expect(held.map((transition) => transition.namedWhenStarted)).toEqual(['ag-dock-group-0']);
    expect(document.documentElement.getAttribute('data-ag-dock-transition')).toBe('arrangement');

    await act(async () => {
      await held[0]?.update();
    });
    expect(getByTestId('dock').textContent).toBe('b');

    await act(async () => {
      held[0]?.finish();
      await Promise.resolve();
    });
    expect(document.documentElement.hasAttribute('data-ag-dock-transition')).toBe(false);
    expect(built.elements.get('b')?.style.viewTransitionName).toBe('');
  });

  it('calls a change to another workspace a workspace switch', () => {
    holdTransitions();
    const { rerender } = render(stage({ key: 'a', layout: layout('editing', 'editor') }));

    rerender(stage({ key: 'b', layout: layout('mastering', 'rack') }));

    expect(document.documentElement.getAttribute('data-ag-dock-transition')).toBe('workspace');
  });

  it('draws a change that arrived during a transition once that transition has finished', async () => {
    const held = holdTransitions();
    const { rerender, getByTestId } = render(stage({ key: 'a', layout: layout('w', 'editor') }));
    rerender(stage({ key: 'b', layout: layout('w', 'inspector') }));
    await act(async () => {
      await held[0]?.update();
    });

    rerender(stage({ key: 'c', layout: layout('w', 'history') }));
    expect(held).toHaveLength(1);

    await act(async () => {
      held[0]?.finish();
      await Promise.resolve();
    });
    expect(held).toHaveLength(2);
    await act(async () => {
      await held[1]?.update();
    });
    expect(getByTestId('dock').textContent).toBe('c');
  });
});
