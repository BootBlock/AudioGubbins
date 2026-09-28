import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_THEME_PREFERENCES,
  UNKNOWN_SYSTEM_APPEARANCE,
  resolveTheme,
  type Theme,
} from '@audiogubbins/design-system';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';

import { useContrastWarning } from './use-contrast-warning.js';

/** A shipped theme, with the colours named falling short of their target. */
function fallingShort(...tokens: readonly string[]): Theme {
  const theme = resolveTheme(DEFAULT_THEME_PREFERENCES, UNKNOWN_SYSTEM_APPEARANCE);
  return {
    ...theme,
    palette: {
      ...theme.palette,
      contrastShortfalls: tokens.map((token) => ({ token, ratio: 3.9, required: 4.5 })),
    },
  };
}

/** Renders the hook through a sequence of themes, and returns the warnings it wrote. */
function warningsAcross(themes: readonly Theme[]): readonly string[] {
  const logs = createLogStore();
  const logger = createDiagnosticCentre(logs, { now: () => 0 }).loggerFor('shell');
  const [first, ...rest] = themes;
  if (first === undefined) return [];

  const { rerender } = renderHook(
    ({ theme }) => {
      useContrastWarning(theme, logger);
    },
    { initialProps: { theme: first } },
  );
  for (const theme of rest) rerender({ theme });

  return logs.snapshot().map((record) => String(record.fields['colours']));
}

describe('the contrast warning', () => {
  it('warns once for each set of colours that falls short, however often it comes back', () => {
    // Compared with the last set alone, a brightness drag between two settings
    // that each fell short wrote the warning again at every step.
    const a = fallingShort('text');
    const b = fallingShort('text', 'accent');

    expect(warningsAcross([a, b, fallingShort('text'), b, a])).toEqual(['text', 'text, accent']);
  });

  it('writes nothing for a palette that meets every target', () => {
    const shipped = resolveTheme(DEFAULT_THEME_PREFERENCES, UNKNOWN_SYSTEM_APPEARANCE);

    expect(warningsAcross([shipped, fallingShort(), shipped])).toEqual([]);
  });
});
