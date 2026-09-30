import { render } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { DockRegion, type PanelDescriptor, type WorkspaceLayout } from '../panel.js';
import { createDockMemory } from './dock-memory.js';
import { DockHost } from './dockview-adapter.js';

/**
 * The adapter's own wiring to the engine: what it subscribes to, and what it
 * stops when it goes.
 *
 * The coalescer is tested on its own; these hold the adapter, where a pending
 * frame could outlive a remount and report a disposed engine's reading into the
 * next workspace, and a hidden page could owe its last report to a frame that
 * never comes. Neither the coalescer's tests nor the browser suite can see
 * either: the first needs the adapter, and the second a frame that does not
 * run.
 *
 * The engine is replaced with one that mounts as the real one does, calling
 * `onReady` once from an effect, and lets a test say when its layout changed.
 * It disposes nothing of its own when it unmounts: what the adapter stops, it
 * stops itself, which is what these tests hold.
 */

/** One panel the adapter asked the engine to add. */
interface AddedPanel {
  readonly id: string;
  readonly minimumWidth?: number;
  readonly minimumHeight?: number;
}

/** What the replacement engine exposes to a test. */
const engine = {
  changed: undefined as (() => void) | undefined,
  disposed: 0,
  groups: [] as unknown[],
  added: [] as AddedPanel[],
};

vi.mock('dockview-react', () => ({
  DockviewReact: ({ onReady }: { onReady: (event: { api: unknown }) => void }): ReactNode => {
    useEffect(() => {
      onReady({
        api: {
          width: 800,
          height: 600,
          get groups() {
            return engine.groups;
          },
          activePanel: undefined,
          addPanel: (options: AddedPanel) => {
            engine.added.push(options);
            return { id: options.id };
          },
          getPanel: () => undefined,
          onDidLayoutChange: (listener: () => void) => {
            engine.changed = listener;
            return {
              dispose: () => {
                engine.disposed += 1;
                engine.changed = undefined;
              },
            };
          },
        },
      });
    }, [onReady]);
    return null;
  },
}));

/** Frames that run only when a test says a frame has passed. */
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;

function runFrames(): void {
  const due = [...frames.values()];
  frames.clear();
  for (const callback of due) callback(0);
}

beforeEach(() => {
  engine.changed = undefined;
  engine.disposed = 0;
  engine.groups = [];
  engine.added = [];
  frames.clear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    nextFrame += 1;
    frames.set(nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
    frames.delete(handle);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const EMPTY: WorkspaceLayout = {
  schemaVersion: SCHEMA_VERSIONS.workspaceLayout,
  id: 'empty',
  displayName: 'Empty',
  builtIn: false,
  groups: [],
};

function mountDock(
  onArrangementChange = vi.fn(),
  descriptors: ReadonlyMap<string, PanelDescriptor> = new Map(),
  layout: WorkspaceLayout = EMPTY,
) {
  const mounted = render(
    <DockHost
      layout={layout}
      descriptors={descriptors}
      renderPanel={() => null}
      onArrangementChange={onArrangementChange}
      dark
      memory={createDockMemory()}
    />,
  );
  return { ...mounted, onArrangementChange };
}

describe('DockHost', () => {
  it('reports nothing once it has gone, and leaves no frame or subscription behind', () => {
    const { unmount, onArrangementChange } = mountDock();

    engine.changed?.();
    engine.changed?.();
    expect(onArrangementChange).toHaveBeenCalledTimes(1);

    unmount();
    runFrames();

    expect(onArrangementChange).toHaveBeenCalledTimes(1);
    expect(engine.disposed).toBe(1);
    expect(frames.size).toBe(0);
  });

  it("asks the engine for both of a panel kind's declared minimum sizes", () => {
    // The minimum is declared so that a splitter drag cannot crush a panel
    // below it. The browser suite drags an upright splitter and reads the
    // width, and asserts the height nowhere, so without this the height could
    // be dropped, misspelled or swapped with the width with every suite still
    // green.
    const layout: WorkspaceLayout = {
      ...EMPTY,
      groups: [
        {
          region: DockRegion.Centre,
          proportion: 1,
          panels: [{ id: 'editor', kind: 'editor' }],
          activePanelId: 'editor',
        },
      ],
    };
    const descriptors = new Map<string, PanelDescriptor>([
      [
        'editor',
        {
          kind: 'editor',
          title: 'Editor',
          defaultRegion: DockRegion.Centre,
          allowsMultiple: false,
          closable: true,
          minimumSize: { width: 200, height: 120 },
        },
      ],
    ]);

    mountDock(vi.fn(), descriptors, layout);

    expect(engine.added).toEqual([
      expect.objectContaining({ id: 'editor', minimumWidth: 200, minimumHeight: 120 }),
    ]);
  });

  it('asks for no minimum where the panel kind declares none', () => {
    // Both numbers are the descriptor's, so a default invented here would be a
    // size nobody wrote down.
    const layout: WorkspaceLayout = {
      ...EMPTY,
      groups: [
        {
          region: DockRegion.Centre,
          proportion: 1,
          panels: [{ id: 'editor', kind: 'editor' }],
          activePanelId: 'editor',
        },
      ],
    };
    const descriptors = new Map<string, PanelDescriptor>([
      [
        'editor',
        {
          kind: 'editor',
          title: 'Editor',
          defaultRegion: DockRegion.Centre,
          allowsMultiple: false,
          closable: true,
        },
      ],
    ]);

    mountDock(vi.fn(), descriptors, layout);

    expect(engine.added).toHaveLength(1);
    expect(engine.added[0]).not.toHaveProperty('minimumWidth');
    expect(engine.added[0]).not.toHaveProperty('minimumHeight');
  });

  it('reports what it owes when the page is left, without waiting for a frame', () => {
    const { onArrangementChange } = mountDock();

    engine.changed?.();
    engine.changed?.();
    window.dispatchEvent(new Event('pagehide'));

    expect(onArrangementChange).toHaveBeenCalledTimes(2);
  });

  it('reports what it owes when the page is hidden, where no frame will come', () => {
    const { onArrangementChange } = mountDock();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

    engine.changed?.();
    engine.changed?.();
    document.dispatchEvent(new Event('visibilitychange'));
    visibility.mockRestore();

    expect(onArrangementChange).toHaveBeenCalledTimes(2);
  });

  it('stops listening to the page when it goes', () => {
    // Asked of the listeners themselves. A report after unmounting cannot tell
    // a listener left behind from one removed, because a stopped coalescer
    // owes nothing either way.
    const added = vi.spyOn(window, 'addEventListener');
    const addedToDocument = vi.spyOn(document, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const removedFromDocument = vi.spyOn(document, 'removeEventListener');

    const { unmount } = mountDock();
    const pagehide = added.mock.calls.find(([type]) => type === 'pagehide')?.[1];
    const visibility = addedToDocument.mock.calls.find(
      ([type]) => type === 'visibilitychange',
    )?.[1];
    unmount();

    expect(pagehide).toBeDefined();
    expect(visibility).toBeDefined();
    expect(removed).toHaveBeenCalledWith('pagehide', pagehide);
    expect(removedFromDocument).toHaveBeenCalledWith('visibilitychange', visibility);
  });

  it('stops watching the dock for a new size when it goes, with nothing owed to a frame', () => {
    // Mounted with nothing docked, the dock would watch nothing, and no test
    // would see a watch left running after the mount went, or a pairing owed to
    // a frame that would then read a disposed engine.
    const watches: { observed: Element[]; disconnected: boolean; resized: () => void }[] = [];
    // Assigned rather than stubbed: the suite's own stand-in is written as a
    // property that can be replaced but not redefined.
    const standIn = window.ResizeObserver;
    window.ResizeObserver = class {
      private readonly watch: (typeof watches)[number];
      constructor(resized: ResizeObserverCallback) {
        this.watch = {
          observed: [],
          disconnected: false,
          resized: () => {
            resized([], this);
          },
        };
        watches.push(this.watch);
      }
      observe(target: Element): void {
        this.watch.observed.push(target);
      }
      unobserve(): void {
        return undefined;
      }
      disconnect(): void {
        this.watch.disconnected = true;
      }
    };
    onTestFinished(() => {
      window.ResizeObserver = standIn;
    });
    const shell = document.createElement('div');
    shell.className = 'dv-shell';
    const grid = document.createElement('div');
    grid.className = 'dv-dockview';
    const element = document.createElement('div');
    grid.append(element);
    shell.append(grid);
    document.body.append(shell);
    engine.groups = [
      {
        panels: [{ id: 'one', title: 'Editor', params: { kind: 'editor' } }],
        activePanel: { id: 'one' },
        element,
        api: { location: { type: 'grid' } },
      },
    ];

    const { unmount } = mountDock();
    const watch = watches.find((one) => one.observed.includes(grid));
    expect(watch).toBeDefined();
    watch?.resized();
    expect(frames.size).toBe(1);

    unmount();

    expect(watch?.disconnected).toBe(true);
    expect(frames.size).toBe(0);
    shell.remove();
  });

  it('reads a panel back as it is stored: a title only where it overrides, and its parameters', () => {
    // Every panel came back with the title the engine showed and without the
    // parameters it was mounted with, so a workspace nobody had changed
    // differed from the one it was drawn from, and a panel lost which thing it
    // showed.
    const editor: PanelDescriptor = {
      kind: 'editor',
      title: 'Editor',
      defaultRegion: DockRegion.Centre,
      allowsMultiple: true,
      closable: true,
    };
    engine.groups = [
      {
        panels: [
          { id: 'one', title: 'Editor', params: { kind: 'editor' } },
          { id: 'two', title: 'take.wav', params: { kind: 'editor', asset: 'a1', zoom: 2 } },
        ],
        activePanel: { id: 'one' },
        element: document.createElement('div'),
        api: { location: { type: 'grid' } },
      },
    ];
    const { onArrangementChange } = mountDock(vi.fn(), new Map([['editor', editor]]));

    engine.changed?.();

    expect(onArrangementChange).toHaveBeenLastCalledWith({
      groups: [
        {
          region: DockRegion.Centre,
          panels: [
            { id: 'one', kind: 'editor' },
            { id: 'two', kind: 'editor', title: 'take.wav', parameters: { asset: 'a1', zoom: 2 } },
          ],
          activePanelId: 'one',
          proportion: 1,
        },
      ],
      activePanelId: 'one',
    });
  });
});
