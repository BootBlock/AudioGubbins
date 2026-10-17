/**
 * Renders a component inside a theme and the hints, as the application draws
 * every control: the theme writes the tokens and the state attributes the
 * stylesheets select on, and the hints give a hinted control its context.
 */

import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';

import { HintProvider } from '../primitives/overlays.js';
import { ThemeProvider, fixedSystemAppearance } from '../theme/theme-provider.js';
import { DEFAULT_THEME_PREFERENCES, UNKNOWN_SYSTEM_APPEARANCE } from '../tokens/preferences.js';

/** The theme and the hints, around whatever is drawn. */
function Themed({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <ThemeProvider
      preferences={DEFAULT_THEME_PREFERENCES}
      system={fixedSystemAppearance(UNKNOWN_SYSTEM_APPEARANCE)}
    >
      <HintProvider>{children}</HintProvider>
    </ThemeProvider>
  );
}

/**
 * Renders `ui` themed with the shipped preferences. A wrapper rather than a
 * tree of its own, so `rerender` draws the next `ui` inside the same theme and
 * the controls it already drew are updated rather than mounted again.
 */
export function renderThemed(ui: ReactNode): RenderResult {
  return render(ui, { wrapper: Themed });
}
