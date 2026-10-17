/**
 * Renders a component as the application does: inside a theme, the tooltip
 * provider and the notices. A dialogue shows a notice raised while it is open,
 * so it needs the notices.
 */

import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';

import { NoticeProvider } from '../primitives/announcement.js';
import { HintProvider } from '../primitives/overlays/tooltips.js';
import { ThemeProvider, fixedSystemAppearance } from '../theme/theme-provider.js';
import { DEFAULT_THEME_PREFERENCES, UNKNOWN_SYSTEM_APPEARANCE } from '../tokens/preferences.js';

/** `ui`, rendered inside the theme and the providers every surface has. */
export function renderThemed(ui: ReactNode): RenderResult {
  return render(
    <ThemeProvider
      preferences={DEFAULT_THEME_PREFERENCES}
      system={fixedSystemAppearance(UNKNOWN_SYSTEM_APPEARANCE)}
    >
      <HintProvider>
        <NoticeProvider notice={undefined}>{ui}</NoticeProvider>
      </HintProvider>
    </ThemeProvider>,
  );
}
