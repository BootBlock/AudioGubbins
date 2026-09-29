import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { commandId } from '@audiogubbins/commands';

import {
  standingRecovery,
  startingRecoveries,
  type Notice,
  type StandingRecovery,
} from '../state/recovery-notices.js';
import { StatusBar, type StatusBarProps } from './status-bar.js';

/**
 * What the status bar says, for each number of missing capabilities.
 *
 * A browser test can assert the wording only on a browser that happens to lack
 * something, behind an `if` with nothing to say which branch ran, and may never
 * meet the singular at all. The bar is drawn from its properties alone, so each
 * case is set here rather than hoped for.
 */

/**
 * A notice whose text is set aside, or one whose text waits for room, whose
 * fact then says what cannot be kept, as each custody words it.
 */
function notice(fact: string, waitsForRoom = false): Notice {
  return {
    fact,
    consequences: waitsForRoom
      ? 'The text that could not be read is left where it is, and there is no room to set it aside.'
      : 'The text that could not be read is kept aside.',
    waitsForRoom,
  };
}

const LAYOUT = notice('The stored workspace could not be read.');
const COLLECTION = notice('The workspaces you saved could not be read.');
const PROFILES = notice('The shortcut profiles you made could not be read.');

/** The notices standing for those each store holds, and whether text waits for room. */
function standing({
  layout,
  collection,
  profiles,
  workspaceWaits = false,
  profilesWait = false,
}: {
  readonly layout?: Notice;
  readonly collection?: Notice;
  readonly profiles?: Notice;
  readonly workspaceWaits?: boolean;
  readonly profilesWait?: boolean;
}): StandingRecovery {
  return standingRecovery(
    { recoveries: startingRecoveries(layout, collection), waitsForRoom: workspaceWaits },
    { recovery: profiles, waitsForRoom: profilesWait },
  );
}

/** The status bar's properties, with nothing to say beyond the workspace's name. */
function propsWith(overrides: Partial<StatusBarProps> = {}): StatusBarProps {
  return {
    workspaceName: 'Editing',
    pendingChord: undefined,
    diagnosticModeActive: false,
    persistence: { unsaved: [], cause: undefined },
    recovery: standing({}),
    missingCapabilities: 0,
    run: vi.fn(),
    ...overrides,
  };
}

function statusBar(overrides: Partial<StatusBarProps> = {}) {
  const run = vi.fn();
  render(<StatusBar {...propsWith({ run, ...overrides })} />);
  return run;
}

/** The text of each notice in the bar, with its button's. */
const noticesShown = (): readonly (string | null)[] =>
  [...document.querySelectorAll('.ag-status-notice')].map((one) => one.textContent);

/** The sizes of the bar that decide whether it scrolls, and either way. */
const MEASURES = ['scrollHeight', 'clientHeight', 'scrollWidth', 'clientWidth'] as const;

/** The bar's sizes, as a test sets them. */
type BarSize = Record<(typeof MEASURES)[number], number>;

/**
 * Gives the bar the sizes returned, which the test changes as it needs, and
 * every other element none: jsdom lays nothing out. It starts with all it
 * holds in sight.
 */
function layOutTheBar(): BarSize {
  const size: BarSize = { scrollHeight: 60, clientHeight: 84, scrollWidth: 320, clientWidth: 320 };
  for (const measure of MEASURES) {
    const own = Object.getOwnPropertyDescriptor(Element.prototype, measure);
    Object.defineProperty(Element.prototype, measure, {
      configurable: true,
      get(this: Element) {
        return this.classList.contains('ag-status-bar') ? size[measure] : 0;
      },
    });
    onTestFinished(() => {
      if (own === undefined) Reflect.deleteProperty(Element.prototype, measure);
      else Object.defineProperty(Element.prototype, measure, own);
    });
  }
  return size;
}

/** What the bar's size observer watches, and a change of size to drive it. */
interface SizeWatch {
  /** Whether any observer watches `element` now. */
  readonly watched: (element: Element) => boolean;

  /** Calls back each observer watching `element`, and no other. */
  readonly resize: (element: Element) => void;
}

/**
 * Puts a `ResizeObserver` in place of the suite's own, which keeps what each
 * observer is given to watch and calls one back only for an element it
 * watches, as the browser does when that element changes size.
 */
function watchSizes(): SizeWatch {
  const observers = new Set<{ readonly targets: Set<Element>; readonly changed: () => void }>();
  // Assigned rather than stubbed: the suite's own stand-in is written as a
  // property that can be replaced but not redefined.
  const standIn = window.ResizeObserver;
  window.ResizeObserver = class {
    readonly #targets = new Set<Element>();

    constructor(callback: ResizeObserverCallback) {
      observers.add({
        targets: this.#targets,
        changed: () => {
          callback([], this);
        },
      });
    }

    observe(target: Element): void {
      this.#targets.add(target);
    }

    unobserve(target: Element): void {
      this.#targets.delete(target);
    }

    disconnect(): void {
      this.#targets.clear();
    }
  };
  onTestFinished(() => {
    window.ResizeObserver = standIn;
  });
  return {
    watched: (element) => [...observers].some((one) => one.targets.has(element)),
    resize: (element) => {
      act(() => {
        for (const one of observers) if (one.targets.has(element)) one.changed();
      });
    },
  };
}

/** Presses Tab with nothing focused, as a reader arriving at the page does. */
async function tabFromTheTop(): Promise<void> {
  act(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await userEvent.tab();
}

describe('StatusBar', () => {
  it('says why the browser refuses to keep a part, and what the user can do, beside the part', () => {
    // It said what was not being saved, and neither why nor what to do.
    render(
      <StatusBar
        {...propsWith({ persistence: { unsaved: ['workspace', 'shortcuts'], cause: 'refused' } })}
      />,
    );

    expect(
      screen.getByText(
        'Not being saved: workspaces, shortcut profiles. The browser refuses this site storage; its settings can allow it. AudioGubbins tries again with your next change.',
      ),
    ).toBeInTheDocument();
  });

  it('says nothing about capabilities on a browser that has them all', () => {
    statusBar({ missingCapabilities: 0 });

    expect(screen.queryByText(/capabilit/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show the Capabilities panel' })).toBeNull();
  });

  it('names one missing capability in the singular, with the panel that explains it', async () => {
    const run = statusBar({ missingCapabilities: 1 });

    expect(screen.getByText('One capability is unavailable')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show the Capabilities panel' }));
    expect(run).toHaveBeenCalledWith(commandId('workspace.show-capabilities'));
  });

  it('names several in the plural', () => {
    statusBar({ missingCapabilities: 3 });

    expect(screen.getByText('3 capabilities are unavailable')).toBeInTheDocument();
  });

  it('offers each recovery notice its own dismissal', async () => {
    const run = statusBar({ recovery: standing({ layout: LAYOUT, collection: COLLECTION }) });

    // Named after its notice: two buttons called "Dismiss notice" could not be
    // told apart by a screen-reader user, and one of them was the one that
    // could cost the unreadable text.
    //
    // Drawn as the start of that name, which fits a narrow bar and is what a
    // voice user reads off the screen to say.
    expect(
      screen.getByRole('button', { name: 'Dismiss the notice about the workspace on screen' }),
    ).toHaveTextContent(/^Dismiss$/);

    // Each button in one element with its own notice, so the two wrap together:
    // as siblings in the bar, a Dismiss could wrap to the next line beside the
    // other notice.
    expect(
      screen
        .getByRole('button', { name: 'Dismiss the notice about the workspace on screen' })
        .closest('.ag-status-notice'),
    ).toHaveTextContent(
      /^The stored workspace could not be read\. The text that could not be read is kept aside\.Dismiss$/,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Dismiss the notice about your saved workspaces' }),
    );
    expect(run).toHaveBeenCalledWith(commandId('workspace.dismiss-notice'), {
      part: 'collection',
    });
  });

  it('keeps focus in the status bar when a notice and its button go', async () => {
    // The pressed button unmounts with its notice, and focus fell to the page.
    const props = propsWith({ recovery: standing({ layout: LAYOUT, collection: COLLECTION }) });
    const { rerender } = render(<StatusBar {...props} />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Dismiss the notice about your saved workspaces' }),
    );
    rerender(<StatusBar {...props} recovery={standing({ layout: LAYOUT })} />);
    expect(
      screen.getByRole('button', { name: 'Dismiss the notice about the workspace on screen' }),
    ).toHaveFocus();

    await userEvent.click(
      screen.getByRole('button', { name: 'Dismiss the notice about the workspace on screen' }),
    );
    rerender(<StatusBar {...props} recovery={standing({})} />);
    expect(screen.getByRole('contentinfo', { name: 'Status' })).toHaveFocus();
  });

  it("shows the shortcut profiles' notice after the workspace's, with a dismissal of its own", async () => {
    const run = statusBar({ recovery: standing({ layout: LAYOUT, profiles: PROFILES }) });

    expect(noticesShown()).toEqual([
      'The stored workspace could not be read. The text that could not be read is kept aside.Dismiss',
      'The shortcut profiles you made could not be read. The text that could not be read is kept aside.Dismiss',
    ]);

    await userEvent.click(
      screen.getByRole('button', { name: 'Dismiss the notice about your shortcut profiles' }),
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(commandId('shortcuts.dismiss-notice'));
  });

  it("keeps focus in the status bar when the shortcut profiles' notice goes", async () => {
    const props = propsWith({ recovery: standing({ profiles: PROFILES }) });
    const { rerender } = render(<StatusBar {...props} />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Dismiss the notice about your shortcut profiles' }),
    );
    rerender(<StatusBar {...props} recovery={standing({})} />);
    expect(screen.getByRole('contentinfo', { name: 'Status' })).toHaveFocus();
  });

  it('says once, as an item of its own with no dismissal, how to make room safely, while any text waits for room', () => {
    // Said in each notice whose text waited, the paragraph was read once for
    // the workspace and again for the profiles.
    const props = propsWith({
      recovery: standing({
        layout: notice(
          'The stored workspace could not be read. The workspace on screen cannot be kept until there is room.',
          true,
        ),
        profiles: notice(
          'The shortcut profiles you made could not be read. Changes to your shortcuts cannot be kept until there is room.',
          true,
        ),
        workspaceWaits: true,
        profilesWait: true,
      }),
    });
    const { rerender } = render(<StatusBar {...props} />);
    const bar = screen.getByRole('contentinfo', { name: 'Status' });
    const advice =
      "To make room without losing anything, export the text that could not be read from the Workspaces or Shortcuts settings, then discard it there. Clearing this site's data in your browser instead would delete every workspace, shortcut profile and setting kept here, the text that could not be read among them, and the data of any other site at the same address.";

    expect(bar.textContent.split('To make room without losing anything')).toHaveLength(2);
    expect(screen.getByText(advice).closest('.ag-status-notice')).toBeNull();
    expect(noticesShown().join(' ')).not.toContain('To make room without losing anything');
    // The only buttons are the two notices' dismissals.
    expect(screen.getAllByRole('button')).toEqual([
      screen.getByRole('button', { name: 'Dismiss the notice about the workspace on screen' }),
      screen.getByRole('button', { name: 'Dismiss the notice about your shortcut profiles' }),
    ]);

    // Stands with every notice dismissed while text still waits, even one
    // store's alone.
    rerender(<StatusBar {...props} recovery={standing({ profilesWait: true })} />);
    expect(screen.getByText(advice)).toBeInTheDocument();
    rerender(<StatusBar {...props} recovery={standing({ workspaceWaits: true })} />);
    expect(screen.getByText(advice)).toBeInTheDocument();

    // And goes once none does.
    rerender(<StatusBar {...props} recovery={standing({})} />);
    expect(screen.queryByText(/To make room without losing anything/)).toBeNull();
  });

  it('is reached by Tab while what it holds reaches past what it shows, and only then', async () => {
    // The advice on making room is text after every button, so once the bar
    // scrolls, only a stop of the Tab order on the bar itself brings it into
    // view. jsdom lays nothing out, so the bar's sizes are given, and its
    // observer is driven by hand, as the browser drives it when something in
    // the bar changes size.
    const size = layOutTheBar();
    const sizes = watchSizes();
    const props = propsWith();
    const { rerender } = render(<StatusBar {...props} />);
    const bar = screen.getByRole('contentinfo', { name: 'Status' });

    // Everything in sight: the bar is no stop of the Tab order.
    await tabFromTheTop();
    expect(bar).not.toHaveFocus();

    // The bar is drawn again with the advice, which it cannot show whole.
    size.scrollHeight = 200;
    await act(async () => {
      rerender(<StatusBar {...props} recovery={standing({ workspaceWaits: true })} />);
      await Promise.resolve();
    });
    await tabFromTheTop();
    expect(bar).toHaveFocus();

    // Its stop in the Tab order is kept in step as what it holds shrinks and
    // grows, with no new drawing.
    size.scrollHeight = 80;
    sizes.resize(bar);
    await tabFromTheTop();
    expect(bar).not.toHaveFocus();
    size.scrollHeight = 200;
    sizes.resize(bar);
    await tabFromTheTop();
    expect(bar).toHaveFocus();
  });

  it('is reached by Tab while what it holds reaches past what it shows sideways', async () => {
    // A word too long for the bar is broken where it must be, but the bar can
    // still scroll sideways, and what lies past its end there is brought into
    // view from the keyboard only as what lies below it is: from the bar.
    const size = layOutTheBar();
    const sizes = watchSizes();
    render(<StatusBar {...propsWith({ workspaceName: 'w'.repeat(120) })} />);
    const bar = screen.getByRole('contentinfo', { name: 'Status' });
    expect(size.scrollHeight).toBeLessThanOrEqual(size.clientHeight);

    // As wide as it shows: no stop.
    await tabFromTheTop();
    expect(bar).not.toHaveFocus();

    // Wider than it shows, and no taller: a stop.
    size.scrollWidth = size.clientWidth * 3;
    sizes.resize(bar);
    await tabFromTheTop();
    expect(bar).toHaveFocus();

    // As wide again: no stop.
    size.scrollWidth = size.clientWidth;
    sizes.resize(bar);
    await tabFromTheTop();
    expect(bar).not.toHaveFocus();
  });

  it('watches the size of the bar and of each item in it, and measures again as one grows', async () => {
    // A bar held at its cap keeps its size while what it holds grows under it,
    // so its own size alone would never say that it has come to scroll: each
    // item's size is watched too, an item added among them.
    const size = layOutTheBar();
    const sizes = watchSizes();
    const props = propsWith();
    const { rerender } = render(<StatusBar {...props} />);
    const bar = screen.getByRole('contentinfo', { name: 'Status' });

    expect(sizes.watched(bar)).toBe(true);
    expect(bar.children.length).toBeGreaterThan(0);
    for (const item of bar.children) expect(sizes.watched(item)).toBe(true);

    await act(async () => {
      rerender(<StatusBar {...props} recovery={standing({ layout: LAYOUT })} />);
      await Promise.resolve();
    });
    const added = [...bar.children].find((item) => item.classList.contains('ag-status-notice'));
    if (added === undefined) throw new Error('The notice is not an item of the bar.');
    expect(sizes.watched(added)).toBe(true);
    expect(sizes.watched(bar)).toBe(true);
    for (const item of bar.children) expect(sizes.watched(item)).toBe(true);

    // The notice grows under the bar, which keeps its size, and says so
    // through the notice alone.
    await tabFromTheTop();
    expect(bar).not.toHaveFocus();
    size.scrollHeight = 200;
    sizes.resize(added);
    await tabFromTheTop();
    expect(bar).toHaveFocus();
  });
});
