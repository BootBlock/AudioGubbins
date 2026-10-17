import type { Locator, Page } from '@playwright/test';

/**
 * Everything the browser suite knows about the docking engine's own DOM.
 *
 * The engine draws the groups, the tabs, the splitters and the floating
 * windows itself, so a test that asks where a panel is has to name the classes
 * it draws them with. Those names are the engine's private business and change
 * when it does.
 *
 * Here rather than in each spec. Spread over the specs, the names
 * would leave the architecture rule that keeps the engine behind one module
 * true of the production code and the claim it carries — "replacing it is a
 * change to one directory and one stylesheet" — false. With them here, the
 * engine is known in four places: the adapter, the stylesheet that reaches the
 * engine's own by `@import`, the adapter's own test, and this file. A rule in
 * `dependency-rules.test.ts` holds that list.
 *
 * A test should ask for a panel by its heading or its tab's accessible name
 * wherever it can, and reach for one of these only where the thing being
 * asserted is the engine's own furniture.
 */

/** The engine's class names, as it writes them. */
const ENGINE = {
  dock: 'dv-dockview',
  group: 'dv-groupview',
  groupInUse: 'dv-active-group',
  groupNotInUse: 'dv-inactive-group',
  tab: 'dv-tab',
  tabShown: 'dv-active-tab',
  tabHidden: 'dv-inactive-tab',
  splitter: 'dv-sash',
  panelBody: 'dv-content-container',
  floating: 'dv-resize-container',
  landingArea: 'dv-drop-target-selection',
  dropTarget: 'dv-drop-target',
  dropTargets: 'dv-drop-target-container',
  tabShifting: 'dv-tab--shifting',
  shell: 'dv-shell',
} as const;

/** AudioGubbins' own element around the dock, which exists before the engine mounts. */
const DOCK_HOST = 'ag-dock-host';

/** The engine's own root element. */
export function dock(page: Page): Locator {
  return page.locator(`.${ENGINE.dock}`);
}

/** Whatever is holding the workspace: AudioGubbins' element around it, or the engine's root. */
export function workspaceSurface(page: Page): Locator {
  return page.locator(`.${DOCK_HOST}, .${ENGINE.dock}`).first();
}

/** The group showing a panel, found by the panel's heading. */
export function groupShowing(page: Page, heading: string): Locator {
  return page.locator(`.${ENGINE.group}`, {
    has: page.getByRole('heading', { name: heading, exact: true }),
  });
}

/** The group a tab belongs to, found by the tab's name. */
export function groupWithTab(page: Page, tab: string): Locator {
  return page.locator(`.${ENGINE.group}`, {
    has: page.getByRole('tab', { name: tab, exact: true }),
  });
}

/** The group the user is working in. */
export function groupInUse(page: Page): Locator {
  return page.locator(`.${ENGINE.group}.${ENGINE.groupInUse}`);
}

/** Every group the user is not working in. */
export function groupsNotInUse(page: Page): Locator {
  return page.locator(`.${ENGINE.group}.${ENGINE.groupNotInUse}`);
}

/** Every tab in the dock. */
export function dockTabs(page: Page): Locator {
  return page.locator(`.${ENGINE.tab}`);
}

/** Every tab whose panel its group is showing. */
export function tabsShown(page: Page): Locator {
  return page.locator(`.${ENGINE.tab}.${ENGINE.tabShown}`);
}

/** Every tab whose panel its group is not showing. */
export function tabsHidden(page: Page): Locator {
  return page.locator(`.${ENGINE.tab}.${ENGINE.tabHidden}`);
}

/** A tab of a group, by the text on it. */
export function tabWithin(group: Locator, text: string): Locator {
  return group.locator(`.${ENGINE.tab}`, { hasText: text });
}

/** Where a group draws its panel's contents. */
export function panelBody(group: Locator): Locator {
  return group.locator(`.${ENGINE.panelBody}`);
}

/** Every splitter between groups. */
export function splitters(page: Page): Locator {
  return page.locator(`.${ENGINE.splitter}`);
}

/** A floating window, found by the heading of the panel in it. */
export function floatingPanel(page: Page, heading: string): Locator {
  return page.locator(`.${ENGINE.floating}`, {
    has: page.getByRole('heading', { name: heading, exact: true }),
  });
}

/** Every floating window, whatever it holds. */
export function floatingPanels(page: Page): Locator {
  return page.locator(`.${ENGINE.floating}`);
}

/** Where a dragged panel would land, while a drag is over a group's contents. */
export function landingAreas(page: Page): Locator {
  return page.locator(`.${ENGINE.landingArea}`);
}

/** The motion the engine is given, as the workspace stylesheet sets it at the level in force. */
export interface EngineMotion {
  /** How long the engine's drop target takes to follow the pointer between targets. */
  readonly dropTarget: string;

  /** How long its anchored drop overlay takes to move. */
  readonly dropTargets: string;

  /** A shifting tab's transition: what it moves, over how long, on what easing. */
  readonly tabShift: {
    readonly property: string;
    readonly duration: string;
    readonly easing: string;
  };

  /** The active splitter's colour change: its duration and its delay. */
  readonly sash: { readonly duration: string; readonly delay: string };
}

/**
 * Reads the motion the engine is given, from elements of the engine's own
 * classes made inside its shell for the reading and taken away again: most of
 * them exist only while a drag is under way.
 */
export async function engineMotion(page: Page): Promise<EngineMotion> {
  return await page.locator(`.${ENGINE.shell}`).evaluate((shell, names) => {
    const make = (className: string): HTMLElement => {
      const element = document.createElement('div');
      element.className = className;
      shell.append(element);
      return element;
    };
    const dropTarget = make(names.dropTarget);
    const dropTargets = make(names.dropTargets);
    const tab = make(`${names.tab} ${names.tabShifting}`);
    try {
      const shellStyle = getComputedStyle(shell);
      const tabStyle = getComputedStyle(tab);
      return {
        dropTarget: getComputedStyle(dropTarget)
          .getPropertyValue('--dv-transition-duration')
          .trim(),
        dropTargets: getComputedStyle(dropTargets)
          .getPropertyValue('--dv-transition-duration')
          .trim(),
        tabShift: {
          property: tabStyle.transitionProperty,
          duration: tabStyle.transitionDuration,
          easing: tabStyle.transitionTimingFunction,
        },
        sash: {
          duration: shellStyle.getPropertyValue('--dv-active-sash-transition-duration').trim(),
          delay: shellStyle.getPropertyValue('--dv-active-sash-transition-delay').trim(),
        },
      };
    } finally {
      dropTarget.remove();
      dropTargets.remove();
      tab.remove();
    }
  }, ENGINE);
}
