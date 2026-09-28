import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ContrastLevel, DEFAULT_THEME_PREFERENCES, MotionLevel, ThemeMode } from '../index.js';
import { UNKNOWN_SYSTEM_APPEARANCE, type SystemAppearance } from '../tokens/preferences.js';
import { ThemeProvider, useTheme, type SystemAppearanceSource } from './theme-provider.js';

/**
 * The wiring between the system's own settings and the resolved theme.
 *
 * `resolveDarkness`, `resolveContrast` and `resolveMotion` are tested against
 * hand-built values, and reading the browser is the capability package's, whose
 * tests answer each query independently, so that inverting a query fails there.
 * These hold the provider to what it is given, including a change while it is
 * mounted.
 */

/** A source whose settings a test changes, as a user changing their system would. */
function systemSource(initial: Partial<SystemAppearance> = {}): {
  readonly source: SystemAppearanceSource;
  readonly change: (next: Partial<SystemAppearance>) => void;
} {
  let current: SystemAppearance = { ...UNKNOWN_SYSTEM_APPEARANCE, ...initial };
  const listeners = new Set<() => void>();

  return {
    source: {
      read: () => current,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    change: (next) => {
      current = { ...current, ...next };
      act(() => {
        for (const listener of listeners) listener();
      });
    },
  };
}

/** Shows what the theme resolved to, so a test can read it. */
function Probe(): React.ReactNode {
  const theme = useTheme();
  return (
    <output>{`${theme.dark ? 'dark' : 'light'}/${theme.contrast}/${theme.motionLevel}`}</output>
  );
}

/** What the probe currently says. */
function resolved(): string {
  return screen.getByRole('status').textContent;
}

/*
 * A provider themes the document element and leaves it themed when it
 * unmounts, so a test reading the document would read what an earlier test
 * wrote unless it is cleared.
 */
afterEach(() => {
  const root = document.documentElement;
  for (const name of root.getAttributeNames()) {
    if (name.startsWith('data-ag-')) root.removeAttribute(name);
  }
  for (const property of [...root.style]) {
    if (property.startsWith('--ag-')) root.style.removeProperty(property);
  }
});

describe('the theme provider follows the system', () => {
  it('resolves dark in system mode when the system prefers dark', () => {
    const { source } = systemSource({ prefersDark: true });

    render(
      <ThemeProvider
        preferences={{ ...DEFAULT_THEME_PREFERENCES, mode: ThemeMode.System }}
        system={source}
      >
        <Probe />
      </ThemeProvider>,
    );

    expect(resolved()).toBe(`dark/${ContrastLevel.Standard}/${MotionLevel.Full}`);
  });

  it('resolves light in system mode when the system prefers light', () => {
    const { source } = systemSource({ prefersDark: false });

    render(
      <ThemeProvider
        preferences={{ ...DEFAULT_THEME_PREFERENCES, mode: ThemeMode.System }}
        system={source}
      >
        <Probe />
      </ThemeProvider>,
    );

    expect(resolved()).toBe(`light/${ContrastLevel.Standard}/${MotionLevel.Full}`);
  });

  it('keeps an explicit theme choice whatever the system prefers', () => {
    const { source } = systemSource({ prefersDark: true });

    render(
      <ThemeProvider
        preferences={{ ...DEFAULT_THEME_PREFERENCES, mode: ThemeMode.Light }}
        system={source}
      >
        <Probe />
      </ThemeProvider>,
    );

    expect(resolved()).toContain('light');
  });

  it('raises contrast when the system asks for more and the user has chosen nothing', () => {
    // An explicit choice of standard contrast wins over the system, as an
    // explicit motion choice does, so this sets none: were the system to
    // override a choice, the user could not turn high contrast off.
    const { source } = systemSource({ prefersMoreContrast: true });

    render(
      <ThemeProvider preferences={DEFAULT_THEME_PREFERENCES} system={source}>
        <Probe />
      </ThemeProvider>,
    );

    expect(resolved()).toContain(ContrastLevel.High);
  });

  it('reduces motion when the system asks for it and the user has chosen nothing', () => {
    const { source } = systemSource({ prefersReducedMotion: true });

    render(
      <ThemeProvider preferences={DEFAULT_THEME_PREFERENCES} system={source}>
        <Probe />
      </ThemeProvider>,
    );

    expect(resolved()).toContain(MotionLevel.Reduced);
  });

  it('follows the system changing while the application is open', () => {
    const { source, change } = systemSource({ prefersDark: false });

    render(
      <ThemeProvider
        preferences={{ ...DEFAULT_THEME_PREFERENCES, mode: ThemeMode.System }}
        system={source}
      >
        <Probe />
      </ThemeProvider>,
    );
    expect(resolved()).toContain('light');

    change({ prefersDark: true });

    expect(resolved()).toContain('dark');
  });

  it('writes the resolved theme onto the document, where a portalled surface reads it', () => {
    // A dialogue, a menu and a tooltip are rendered into the document
    // body, and a custom property inherits down the tree and nowhere else.
    //
    // Light, which is not the default, on a document the tests leave bare.
    const { source } = systemSource({ prefersDark: false });

    render(
      <ThemeProvider
        preferences={{ ...DEFAULT_THEME_PREFERENCES, mode: ThemeMode.System }}
        system={source}
      >
        <Probe />
      </ThemeProvider>,
    );

    expect(document.documentElement.getAttribute('data-ag-theme')).toBe('light');
  });
});
