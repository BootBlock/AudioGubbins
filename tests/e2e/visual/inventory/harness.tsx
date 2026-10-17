/// <reference types="vite/client" />

/**
 * The inventory harness page: every specimen of every specimens file, drawn by
 * the design system inside its own theme provider, in the theme, density and
 * motion level the address states (`inventory-settings.ts`), every component
 * or the one it names.
 *
 * The design system is loaded as the application loads it: its stylesheets by
 * the package's exported paths, in the application's order, which
 * `tests/architecture/inventory-stylesheets.test.ts` holds equal to the
 * application's, and its faces through `tokens.css`, which is where the font
 * packages are reached from. Nothing of the application itself is loaded: the
 * inventory shows the shared components, not a panel.
 *
 * The operating system's appearance is fixed, so a capture on a machine set to
 * the light theme, to reduced motion or to more contrast draws what the address
 * asks for and nothing else.
 */

import '@audiogubbins/design-system/styles/tokens.css';
import '@audiogubbins/design-system/styles/components.css';
import './inventory.css';

import {
  DEFAULT_THEME_PREFERENCES,
  Density,
  MotionLevel,
  ThemeMode,
  ThemeProvider,
  UNKNOWN_SYSTEM_APPEARANCE,
  fixedSystemAppearance,
  type ThemePreferences,
} from '@audiogubbins/design-system';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { InventoryPage } from './inventory-page.js';
import {
  DEFAULT_INVENTORY_SETTINGS,
  readInventoryComponent,
  readInventorySettings,
  type InventoryDensity,
  type InventoryMotion,
  type InventorySettings,
  type InventoryTheme,
} from './inventory-settings.js';
import { narrowCatalogue, readCatalogue } from './specimen-catalogue.js';

const THEME_MODES: Readonly<Record<InventoryTheme, ThemeMode>> = {
  dark: ThemeMode.Dark,
  light: ThemeMode.Light,
};

const DENSITIES: Readonly<Record<InventoryDensity, Density>> = {
  comfortable: Density.Comfortable,
  compact: Density.Compact,
};

const MOTION_LEVELS: Readonly<Record<InventoryMotion, MotionLevel>> = {
  full: MotionLevel.Full,
  reduced: MotionLevel.Reduced,
  off: MotionLevel.Minimal,
};

/** The design system's preferences for one appearance of the inventory. */
function preferencesFor(settings: InventorySettings): ThemePreferences {
  return {
    ...DEFAULT_THEME_PREFERENCES,
    mode: THEME_MODES[settings.theme],
    density: DENSITIES[settings.density],
    motion: MOTION_LEVELS[settings.motion],
  };
}

const SYSTEM = fixedSystemAppearance(UNKNOWN_SYSTEM_APPEARANCE);

const reading = readInventorySettings(window.location.search);
const settings = reading.ok ? reading.settings : DEFAULT_INVENTORY_SETTINGS;
const catalogue = narrowCatalogue(
  readCatalogue(import.meta.glob('./specimens/*.specimens.tsx', { eager: true })),
  readInventoryComponent(window.location.search),
);

const mount = document.getElementById('inventory');
if (mount === null) throw new Error('The inventory page has no #inventory element to draw into.');

createRoot(mount).render(
  <StrictMode>
    <ThemeProvider preferences={preferencesFor(settings)} system={SYSTEM}>
      <InventoryPage catalogue={catalogue} settingsProblems={reading.ok ? [] : reading.problems} />
    </ThemeProvider>
  </StrictMode>,
);
