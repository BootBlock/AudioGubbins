/**
 * Supplying the theme to the component tree.
 *
 * The provider owns the resolved theme, and follows the operating system's own
 * appearance settings through the source it is given. It does not read them
 * from the browser itself: asking the browser what it can do is the capability
 * package's work, and a design system that probed `matchMedia` for itself would
 * be a second home for a question REQ-EXEC-216 wants asked in one place. A
 * change to the preferences or to the system still produces one new theme
 * rather than two components separately noticing that the system went dark.
 *
 * It writes the theme onto its own root element and onto the document element.
 * Both are needed: a surface portalled into the document body is no descendant
 * of the provider's root, so with the root alone themed every custom property
 * it read would be undefined and every dialogue, menu and tooltip would be
 * drawn with no surface at all. The provider takes the element it writes to
 * rather than reaching for the document, so a test can theme a fragment.
 */

import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { oklchToHex } from '../tokens/colour.js';

import type { SystemAppearance, ThemePreferences } from '../tokens/preferences.js';
import { applyTheme, resolveTheme, type Theme } from '../tokens/theme.js';

/**
 * Where the operating system's appearance settings come from.
 *
 * `read` returns the same object until a setting changes, and `subscribe`
 * returns the function that stops listening, which is the contract
 * `useSyncExternalStore` needs. The application passes the browser's; a test
 * or a preview passes a fixed one.
 */
export interface SystemAppearanceSource {
  readonly read: () => SystemAppearance;
  readonly subscribe: (listener: () => void) => () => void;
}

/**
 * A source whose settings never change.
 *
 * For a test, and for a preview of one theme that has to stay that theme on a
 * machine set to the other.
 */
export function fixedSystemAppearance(appearance: SystemAppearance): SystemAppearanceSource {
  return { read: () => appearance, subscribe: () => () => undefined };
}

const ThemeContext = createContext<Theme | undefined>(undefined);

/** What the provider needs. */
export interface ThemeProviderProps {
  /** The user's stored choices. Owned by the shell, not by this component. */
  readonly preferences: ThemePreferences;

  readonly children: ReactNode;

  /**
   * The operating system's appearance settings, followed while mounted.
   *
   * A user changing their system theme mid-session sees AudioGubbins follow,
   * which is what `system` mode means.
   */
  readonly system: SystemAppearanceSource;
}

/** Supplies the resolved theme to everything below it. */
export function ThemeProvider({ preferences, children, system }: ThemeProviderProps): ReactNode {
  const appearance = useSyncExternalStore(system.subscribe, system.read);

  // Building a palette runs a binary search per computed token, so it is done
  // once per preference change rather than on every render.
  const theme = useMemo(() => resolveTheme(preferences, appearance), [preferences, appearance]);

  const root = useRef<HTMLDivElement>(null);

  // Before the browser paints, so no frame is drawn with a token unset. That is
  // what lets the stylesheets carry no fallback colours: there is no instant
  // after the application mounts and before the theme exists.
  useLayoutEffect(() => {
    const element = root.current;
    if (element !== null) applyTheme(element, theme);

    /*
     * The document element is themed as well.
     *
     * A dialogue, a menu, a tooltip, a popover and a select are portalled into
     * the document body so that no ancestor's overflow or stacking context can
     * clip them. Custom properties inherit down the tree and nowhere else, so a
     * theme written only onto an element inside the application would never
     * reach them: the settings dialogue would be drawn transparent, with no
     * padding, no corner and no focus ring, and an accessibility audit could
     * still pass it, because its text happens to contrast with the page's
     * pre-paint colour.
     *
     * Portalling into a container inside the theme instead would make the
     * pointer path unreliable in WebKit, where a menu opened by a click is
     * sometimes not found at all. Theming the document is what the browser's
     * own inheritance model wants, and it is also the only way to reach the
     * surfaces the user agent paints: the canvas, the scrollbars and the
     * overscroll area all read `color-scheme` from the root.
     */
    if (element?.ownerDocument.documentElement != null) {
      applyTheme(element.ownerDocument.documentElement, theme);

      // The colour the browser paints its own interface in on a phone or an
      // installed application. The page ships the dark theme's; it follows the
      // theme from here, or a light theme would sit under a dark title bar.
      element.ownerDocument
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', oklchToHex(theme.palette.chrome.surfaceBase));
    }
  }, [theme]);

  return (
    <ThemeContext.Provider value={theme}>
      <div ref={root} className="ag-theme-root">
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

/**
 * The current theme.
 *
 * Throws outside a provider rather than returning a default. A component
 * silently rendering with a fallback theme looks almost right, which is harder
 * to notice than a component that does not render at all.
 */
export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (theme === undefined) {
    throw new Error('useTheme was called outside a ThemeProvider.');
  }
  return theme;
}
