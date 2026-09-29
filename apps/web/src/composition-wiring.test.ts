import { afterEach, describe, expect, it, vi } from 'vitest';

import { LogSeverity } from '@audiogubbins/diagnostics';
import { PanelKinds } from '@audiogubbins/workspace';

import { createApplication, type Application } from './application.js';
import { PersistedPart } from './state/state-storage.js';
import { PROMPTLY, everythingQueued } from './testing/waiting.js';

/**
 * What the composition root joins together, driven through the application it
 * builds.
 *
 * Each store beneath these is tested on its own, and each statement that joins
 * two of them is held here: deleted, it would leave every other suite green and
 * bring back the defect it is written for. A panel's filter outliving the
 * panel, and a layout map read once and never again, are each one statement in
 * `application.ts`: the first in `createApplication`, and the second in
 * `startKeyboardLayout`, which it calls.
 */

/** The application this test built, taken down after it. */
let application: Application | undefined;

/**
 * An application whose browser answers a layout map, with the maps it has not
 * given out yet.
 *
 * Two maps, because what these are about is the second one: read once, the
 * layout would stand and become a mixture of the first map and the keys typed
 * since.
 */
function builtWithLayoutMaps(): {
  readonly built: Application;
  readonly maps: Map<string, string>[];
} {
  const maps = [new Map([['KeyK', 't']]), new Map([['KeyK', 'k']])];
  Object.defineProperty(window.navigator, 'keyboard', {
    configurable: true,
    value: {
      getLayoutMap: async () => await Promise.resolve(maps.shift() ?? new Map()),
    },
  });

  return { built: createApplication(), maps };
}

/** Looks at the tab again, which is the one occasion to ask for the map. */
function returnToTheTab(): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  application?.dispose();
  application = undefined;
  window.localStorage.clear();
  Reflect.deleteProperty(window.navigator, 'keyboard');
  Reflect.deleteProperty(document, 'visibilityState');
  vi.restoreAllMocks();
});

describe('what the composition root drives from the workspace', () => {
  it('forgets what a closed panel was filtered to, so its identifier comes back clean', () => {
    application = createApplication();
    const { workspace, logViews } = application.context;

    const opened = workspace.openPanel(PanelKinds.Diagnostics);
    expect(opened).toBeUndefined();

    const panel = workspace
      .get()
      .layout.groups.flatMap((group) => group.panels)
      .find((one) => one.kind === PanelKinds.Diagnostics);
    expect(panel).toBeDefined();
    if (panel === undefined) return;

    logViews.choose(panel.id, { threshold: LogSeverity.Error });
    expect(logViews.viewOf(panel.id).threshold).toBe(LogSeverity.Error);

    // Closed through the workspace, which is what knows. The store's own
    // `forgetClosed` is driven from here and from nowhere else, so the panel
    // closing is the whole of the behaviour.
    expect(workspace.closePanel(panel.id)).toBeUndefined();

    expect(logViews.viewOf(panel.id).threshold).toBe(LogSeverity.Trace);
  });

  it('reads the keyboard layout map again when the user comes back to the tab', async () => {
    // A user can change layout while AudioGubbins is running and no browser
    // offers an event for it, so the moment the page is looked at again is the
    // one occasion to ask. Read once, the map stood and the layout became a
    // mixture of the old map and the keys typed since.
    const { built } = builtWithLayoutMaps();
    application = built;
    await vi.waitFor(() => {
      expect(built.context.keyboardLayout.get().characterAt('KeyK')).toBe('t');
    }, PROMPTLY);

    returnToTheTab();

    await vi.waitFor(() => {
      expect(built.context.keyboardLayout.get().characterAt('KeyK')).toBe('k');
    }, PROMPTLY);
  });

  it('takes its watch off the page when it is disposed of', async () => {
    // `adoptLayoutMapOnReturn` answers the function that removes its listeners
    // and the composition root threw that answer away, so every application
    // built in a process left a pair of page listeners behind, each holding a
    // keyboard layout store and a storage — while `mount`'s own doc says it
    // answers what takes the application down "so that a test that mounts it
    // leaves no application listening to the page for the next".
    const { built, maps } = builtWithLayoutMaps();
    application = built;
    await vi.waitFor(() => {
      expect(built.context.keyboardLayout.get().characterAt('KeyK')).toBe('t');
    }, PROMPTLY);

    built.dispose();

    returnToTheTab();
    await everythingQueued();

    // Nothing asked again, so the second map is still waiting.
    expect(built.context.keyboardLayout.get().characterAt('KeyK')).toBe('t');
    expect(maps.length).toBe(1);
  });

  it('says so urgently when the browser refuses to keep what the user changed', async () => {
    // The one channel that tells a user their change will not survive a reload.
    // The urgency is a `true` in the composition root: turned to `false`, the
    // sentence would go to the polite region, which a screen reader reads when
    // it next has nothing else to say, and the user would carry on believing
    // their settings are kept. Nothing in the types would change with it, and
    // the storage's own suite passes a spy of its own, so it holds the
    // behaviour and not the wiring.
    application = createApplication();
    const { interaction } = application.context;

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });

    application.storage.save(PersistedPart.Preferences, { 'audiogubbins.preferences': '{}' });

    await vi.waitFor(() => {
      expect(interaction.get().announcement).toMatchObject({
        text: "Your appearance settings could not be saved, so your changes will not survive a reload. The browser's storage for this site is full. Deleting workspaces or shortcut profiles you no longer need makes room, as does exporting and then discarding any text that could not be read, in the Workspaces and Shortcuts settings. AudioGubbins tries again with your next change.",
        urgent: true,
      });
    }, PROMPTLY);
  });
});
