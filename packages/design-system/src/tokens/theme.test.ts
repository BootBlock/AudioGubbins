import { describe, expect, it } from 'vitest';

import { ContrastRequirement, contrastRatio } from './colour.js';
import { buildPalette, type Palette } from './palette.js';
import {
  ACCENT_HUES,
  BRIGHTNESS_RANGE,
  ContrastLevel,
  DEFAULT_THEME_PREFERENCES,
  Density,
  MotionLevel,
  ThemeMode,
  UNKNOWN_SYSTEM_APPEARANCE,
  clampBrightness,
  resolveContrast,
  resolveDarkness,
  resolveMotion,
  type AccentName,
  type SystemAppearance,
  type ThemePreferences,
} from './preferences.js';
import { applyTheme, resolveTheme, themeCustomProperties, themeDataAttributes } from './theme.js';

const ACCENTS = Object.keys(ACCENT_HUES) as readonly AccentName[];

/** Every brightness a user can select, at the resolution the control offers. */
const BRIGHTNESS_STEPS = Array.from(
  { length: 21 },
  (_unused, index) =>
    BRIGHTNESS_RANGE.minimum + (index * (BRIGHTNESS_RANGE.maximum - BRIGHTNESS_RANGE.minimum)) / 20,
);

function preferences(overrides: Partial<ThemePreferences> = {}): ThemePreferences {
  return { ...DEFAULT_THEME_PREFERENCES, ...overrides };
}

function system(overrides: Partial<SystemAppearance> = {}): SystemAppearance {
  return { ...UNKNOWN_SYSTEM_APPEARANCE, ...overrides };
}

describe('default preferences', () => {
  it('starts dark, as REQ-UX-070 requires', () => {
    expect(DEFAULT_THEME_PREFERENCES.mode).toBe(ThemeMode.Dark);
    expect(resolveTheme(DEFAULT_THEME_PREFERENCES, system()).dark).toBe(true);
  });

  it('starts at the designed brightness, neither raised nor lowered', () => {
    expect(DEFAULT_THEME_PREFERENCES.brightness).toBe(0);
  });

  it('makes no motion choice, so the system decides until the user does', () => {
    expect(DEFAULT_THEME_PREFERENCES.motion).toBeUndefined();
  });
});

describe('resolveDarkness', () => {
  it('honours an explicit dark choice whatever the system says', () => {
    expect(
      resolveDarkness(preferences({ mode: ThemeMode.Dark }), system({ prefersDark: false })),
    ).toBe(true);
  });

  it('honours an explicit light choice whatever the system says', () => {
    expect(
      resolveDarkness(preferences({ mode: ThemeMode.Light }), system({ prefersDark: true })),
    ).toBe(false);
  });

  it('follows the system in system mode', () => {
    const inSystemMode = preferences({ mode: ThemeMode.System });
    expect(resolveDarkness(inSystemMode, system({ prefersDark: true }))).toBe(true);
    expect(resolveDarkness(inSystemMode, system({ prefersDark: false }))).toBe(false);
  });
});

describe('resolveMotion', () => {
  it('follows the system when the user has made no choice', () => {
    expect(resolveMotion(preferences(), system({ prefersReducedMotion: true }))).toBe(
      MotionLevel.Reduced,
    );
    expect(resolveMotion(preferences(), system({ prefersReducedMotion: false }))).toBe(
      MotionLevel.Full,
    );
  });

  it('lets the user override the system and ask for the full experience', () => {
    // REQ-UX-069 permits this override. A person who has deliberately chosen
    // Full has answered the question the system preference was guessing at.
    expect(
      resolveMotion(
        preferences({ motion: MotionLevel.Full }),
        system({ prefersReducedMotion: true }),
      ),
    ).toBe(MotionLevel.Full);
  });

  it('lets the user ask for less motion than the system does', () => {
    expect(
      resolveMotion(
        preferences({ motion: MotionLevel.Minimal }),
        system({ prefersReducedMotion: false }),
      ),
    ).toBe(MotionLevel.Minimal);
  });

  it('keeps reduced motion visible rather than removing it', () => {
    // A transition is what tells the user where a panel went. Reduced shortens
    // it; Minimal is the level for removing it.
    const reduced = resolveTheme(preferences({ motion: MotionLevel.Reduced }), system());
    expect(reduced.motion.moderate).toBeGreaterThan(0);

    const minimal = resolveTheme(preferences({ motion: MotionLevel.Minimal }), system());
    expect(minimal.motion.moderate).toBe(0);
  });

  it('makes every reduced duration shorter than its full counterpart', () => {
    const full = resolveTheme(preferences({ motion: MotionLevel.Full }), system()).motion;
    const reduced = resolveTheme(preferences({ motion: MotionLevel.Reduced }), system()).motion;

    for (const key of ['instant', 'quick', 'moderate', 'deliberate'] as const) {
      expect(reduced[key]).toBeLessThan(full[key]);
    }
  });

  it('removes the overshoot from reduced motion, which is what people react to', () => {
    const reduced = resolveTheme(preferences({ motion: MotionLevel.Reduced }), system()).motion;
    expect(reduced.easeOut).toBe('linear');
  });
});

describe('resolveContrast', () => {
  it('raises contrast when the system asks for it', () => {
    expect(resolveContrast(preferences(), system({ prefersMoreContrast: true }))).toBe(
      ContrastLevel.High,
    );
  });

  it('keeps the user choice of high contrast when the system asks for nothing', () => {
    expect(resolveContrast(preferences({ contrast: ContrastLevel.High }), system())).toBe(
      ContrastLevel.High,
    );
  });

  it('keeps the user choice of high contrast when the system asks for less', () => {
    expect(
      resolveContrast(
        preferences({ contrast: ContrastLevel.High }),
        system({ prefersMoreContrast: false }),
      ),
    ).toBe(ContrastLevel.High);
  });

  it('keeps the user choice of standard contrast when the system asks for more', () => {
    // The system used to override it, so a user whose system asked for more
    // contrast could not turn high contrast off, and the switch said it was
    // off.
    expect(
      resolveContrast(
        preferences({ contrast: ContrastLevel.Standard }),
        system({ prefersMoreContrast: true }),
      ),
    ).toBe(ContrastLevel.Standard);
  });

  it('follows the system until the user chooses', () => {
    const { contrast: _none, ...unchosen } = preferences();
    expect(resolveContrast(unchosen, system({ prefersMoreContrast: false }))).toBe(
      ContrastLevel.Standard,
    );
    expect(resolveContrast(unchosen, system({ prefersMoreContrast: true }))).toBe(
      ContrastLevel.High,
    );
  });
});

describe('clampBrightness', () => {
  it('accepts the whole offered range', () => {
    expect(clampBrightness(BRIGHTNESS_RANGE.minimum)).toBe(BRIGHTNESS_RANGE.minimum);
    expect(clampBrightness(BRIGHTNESS_RANGE.maximum)).toBe(BRIGHTNESS_RANGE.maximum);
  });

  it('constrains a value from outside the range', () => {
    expect(clampBrightness(5)).toBe(BRIGHTNESS_RANGE.maximum);
    expect(clampBrightness(-5)).toBe(BRIGHTNESS_RANGE.minimum);
  });

  it('treats a value that is not a number as the designed brightness', () => {
    expect(clampBrightness(Number.NaN)).toBe(0);
  });
});

/**
 * The contrast guarantee.
 *
 * REQ-UX-070 requires theme brightness to keep contrast, accessibility,
 * readability and component hierarchy correct across the whole range. That is a
 * claim about every combination of theme, accent and brightness, so it is
 * checked against every combination rather than against the one that was looked
 * at while the palette was designed.
 */
describe('contrast across every theme, accent and brightness', () => {
  const combinations = [true, false].flatMap((dark) =>
    ACCENTS.flatMap((accent) =>
      BRIGHTNESS_STEPS.map((brightness) => ({ dark, accent, brightness })),
    ),
  );

  /**
   * Each combination's palette at a contrast level, built the first time a test
   * asks for it.
   *
   * The tests below read every combination at one level or at both: built for
   * each, some four thousand seven hundred builds of six hundred and
   * seventy-two palettes. A palette is a value of its options, and one read
   * here is read only: every field of it is `readonly`, so a test that wrote
   * to one would not compile.
   */
  const SURFACES = [
    'surfaceBase',
    'surfaceRaised',
    'surfaceOverlay',
    'surfaceSunken',
    'surfaceHover',
    'surfaceActive',
  ] as const;

  const built = new Map<string, Palette>();
  const paletteFor = (
    combination: (typeof combinations)[number],
    contrast: ContrastLevel,
  ): Palette => {
    const key = `${String(combination.dark)}/${combination.accent}/${String(combination.brightness)}/${contrast}`;
    const known = built.get(key);
    if (known !== undefined) return known;
    const palette = buildPalette({ ...combination, contrast });
    built.set(key, palette);
    return palette;
  };

  it('covers a meaningful number of combinations', () => {
    // Two themes, eight accents and twenty-one brightness steps, written as a
    // number. Computed from the same lists the combinations are built from, the
    // count would make an empty accent list 0 = 0, and every contrast test
    // below would pass having checked nothing.
    expect(combinations.length).toBe(336);
  });

  it.each([ContrastLevel.Standard, ContrastLevel.High])(
    'keeps body text readable on every surface at %s contrast',
    (contrast) => {
      const failures: string[] = [];

      for (const combination of combinations) {
        const { chrome } = paletteFor(combination, contrast);

        for (const surfaceName of [
          'surfaceBase',
          'surfaceRaised',
          'surfaceOverlay',
          'surfaceSunken',
          'surfaceHover',
          'surfaceActive',
        ] as const) {
          const ratio = contrastRatio(chrome.textPrimary, chrome[surfaceName]);
          if (ratio < ContrastRequirement.BodyText) {
            failures.push(
              `${combination.dark ? 'dark' : 'light'}/${combination.accent}/` +
                `${combination.brightness.toFixed(1)}: textPrimary on ${surfaceName} is ${ratio.toFixed(2)}`,
            );
          }
        }
      }

      expect(failures).toEqual([]);
    },
  );

  it.each([ContrastLevel.Standard, ContrastLevel.High])(
    'keeps the focus ring visible on every surface it is drawn on at %s contrast',
    (contrast) => {
      // The ring marks where the keyboard is, on a control on the raised
      // surface, in a dialogue and a menu on the overlay surface, and on the
      // entry a menu, a select list or the palette has the keyboard on, which
      // is the hover surface. Solved against the raised surface alone, it was
      // under three to one on the others, and there the entry was told apart
      // by a background a twentieth of a step away.
      const failures: string[] = [];

      for (const combination of combinations) {
        const { chrome } = paletteFor(combination, contrast);

        for (const surfaceName of [
          'surfaceBase',
          'surfaceRaised',
          'surfaceOverlay',
          'surfaceSunken',
          'surfaceHover',
          'surfaceActive',
        ] as const) {
          const ratio = contrastRatio(chrome.borderFocus, chrome[surfaceName]);
          if (ratio < ContrastRequirement.LargeText) {
            failures.push(
              `${combination.dark ? 'dark' : 'light'}/${combination.accent}/` +
                `${combination.brightness.toFixed(1)}: borderFocus on ${surfaceName} is ${ratio.toFixed(2)}`,
            );
          }
        }
      }

      expect(failures).toEqual([]);
    },
  );

  it.each([ContrastLevel.Standard, ContrastLevel.High])(
    'keeps supporting text and every status colour readable on every surface at %s contrast',
    (contrast) => {
      // Supporting text was read on three surfaces of six and the status
      // colours on none, while both were solved against a hand-picked surface
      // that was the second-hardest in the light theme. An assertion that is
      // not made is how a wrong answer survives a suite this size.
      const failures: string[] = [];

      for (const combination of combinations) {
        const { chrome } = paletteFor(combination, contrast);

        for (const token of [
          'textSecondary',
          'statusSuccess',
          'statusWarning',
          'statusError',
          'statusInfo',
        ] as const) {
          for (const surfaceName of [
            'surfaceBase',
            'surfaceRaised',
            'surfaceOverlay',
            'surfaceSunken',
            'surfaceHover',
            'surfaceActive',
          ] as const) {
            // The level's own requirement, not the standard one at both
            // levels: supporting text must reach 7:1 at High contrast, and
            // asked for 4.5 there the assertion could not see a colour solved
            // against the wrong surface.
            //
            // A status colour is held to 4.5 at both levels, because it is
            // written as small text: it draws the settings notes as well as
            // naming a state in the status bar. It was held to 3 at standard,
            // which is the ratio for something large or drawn. It does not
            // rise to 7 in high contrast: measured over every combination
            // here, the solver reaches about 6.9 at best for these hues.
            const needed =
              token === 'textSecondary'
                ? contrast === ContrastLevel.High
                  ? ContrastRequirement.Enhanced
                  : ContrastRequirement.BodyText
                : ContrastRequirement.BodyText;
            const ratio = contrastRatio(chrome[token], chrome[surfaceName]);
            if (ratio < needed) {
              failures.push(
                `${combination.dark ? 'dark' : 'light'}/${combination.accent}/` +
                  `${combination.brightness.toFixed(1)}: ${token} on ${surfaceName} is ${ratio.toFixed(2)}`,
              );
            }
          }
        }
      }

      expect(failures).toEqual([]);
    },
  );

  it('keeps text on the accent readable, on both stops of the call to action', () => {
    // The call to action is a gradient from the accent's hover to its partner,
    // the accent mixed with rose; text solved against the accent alone was
    // never checked against the partner it is also written on.
    const failures: string[] = [];

    for (const combination of combinations) {
      const { chrome } = paletteFor(combination, ContrastLevel.Standard);

      for (const accentName of [
        'accent',
        'accentHover',
        'accentActive',
        'accentPartner',
      ] as const) {
        const ratio = contrastRatio(chrome.textOnAccent, chrome[accentName]);
        if (ratio < ContrastRequirement.LargeText) {
          failures.push(
            `${combination.dark ? 'dark' : 'light'}/${combination.accent}/` +
              `${combination.brightness.toFixed(1)}: textOnAccent on ${accentName} is ${ratio.toFixed(2)}`,
          );
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it.each([ContrastLevel.Standard, ContrastLevel.High])(
    'keeps the accent written as small text readable on every surface at %s contrast',
    (contrast) => {
      // The accent is solved to 3 to 1, for something drawn; a tag, a template
      // token and a palette match are small text, held to 4.5 to 1.
      const failures: string[] = [];
      for (const combination of combinations) {
        const { chrome } = paletteFor(combination, contrast);
        for (const surfaceName of SURFACES) {
          const ratio = contrastRatio(chrome.accentText, chrome[surfaceName]);
          if (ratio < ContrastRequirement.BodyText) {
            failures.push(
              `${combination.dark ? 'dark' : 'light'}/${combination.accent}/` +
                `${combination.brightness.toFixed(1)}: accentText on ${surfaceName} is ${ratio.toFixed(2)}`,
            );
          }
        }
      }
      expect(failures).toEqual([]);
    },
  );

  it.each([ContrastLevel.Standard, ContrastLevel.High])(
    'keeps the recording lamp as visible as the accent on every surface at %s contrast',
    (contrast) => {
      // The record lamp and the recording status item are drawn, not written,
      // so they are held to what the accent is held to at each level, and keep
      // the recording red whatever the accent is.
      const needed =
        contrast === ContrastLevel.High
          ? ContrastRequirement.BodyText
          : ContrastRequirement.LargeText;
      const failures: string[] = [];
      for (const combination of combinations) {
        const { chrome } = paletteFor(combination, contrast);
        expect(chrome.statusRecording.hue).toBeCloseTo(25, 5);
        for (const surfaceName of SURFACES) {
          const ratio = contrastRatio(chrome.statusRecording, chrome[surfaceName]);
          if (ratio < needed) {
            failures.push(
              `${combination.dark ? 'dark' : 'light'}/${combination.accent}/` +
                `${combination.brightness.toFixed(1)}: statusRecording on ${surfaceName} is ${ratio.toFixed(2)}`,
            );
          }
        }
      }
      expect(failures).toEqual([]);
    },
  );

  it('draws every fill and edge as a token colour at a translucency, never solid', () => {
    // Owner's finding, 2026-10-17: a fill takes up the backdrop behind it.
    for (const combination of combinations) {
      for (const contrast of [ContrastLevel.Standard, ContrastLevel.High]) {
        const { chrome, elevation } = paletteFor(combination, contrast);
        const translucent = {
          fillQuiet: chrome.fillQuiet,
          fillHover: chrome.fillHover,
          fillPress: chrome.fillPress,
          fillWell: chrome.fillWell,
          fillAccent: chrome.fillAccent,
          edgeQuiet: chrome.edgeQuiet,
          edgeAccent: chrome.edgeAccent,
          scrim: chrome.scrim,
          ...elevation,
        };
        for (const [token, colour] of Object.entries(translucent)) {
          expect(colour.alpha, token).toBeGreaterThan(0);
          expect(colour.alpha, token).toBeLessThan(1);
        }
        expect(chrome.fillQuiet.lightness).toBe(chrome.textPrimary.lightness);
        expect(chrome.fillAccent.lightness).toBe(chrome.accent.lightness);
        expect(chrome.scrim.lightness).toBe(chrome.surfaceSunken.lightness);
      }
    }
  });

  it('reaches enhanced contrast for body text in high-contrast mode', () => {
    const failures: string[] = [];

    for (const combination of combinations) {
      const { chrome } = paletteFor(combination, ContrastLevel.High);
      const ratio = contrastRatio(chrome.textPrimary, chrome.surfaceBase);

      if (ratio < ContrastRequirement.Enhanced) {
        failures.push(
          `${combination.dark ? 'dark' : 'light'}/${combination.accent}/` +
            `${combination.brightness.toFixed(1)}: ${ratio.toFixed(2)}`,
        );
      }
    }

    expect(failures).toEqual([]);
  });

  it('keeps the surface hierarchy ordered at every brightness', () => {
    // The point of a perceptual brightness control rather than a filter: a
    // raised panel stays distinguishable from the window behind it.
    for (const combination of combinations) {
      const { chrome } = paletteFor(combination, ContrastLevel.Standard);

      // The same order in both themes, strictly. The light branch used to allow
      // the base and raised surfaces to be equal and did not compare the raised
      // and overlay surfaces at all, which is how the light theme came to give
      // a menu exactly the lightness of the panel under it.
      expect(chrome.surfaceSunken.lightness).toBeLessThan(chrome.surfaceBase.lightness);
      expect(chrome.surfaceBase.lightness).toBeLessThan(chrome.surfaceRaised.lightness);
      expect(chrome.surfaceRaised.lightness).toBeLessThan(chrome.surfaceOverlay.lightness);
    }
  });

  it('never lets two surfaces collapse onto one lightness', () => {
    const collapsed: string[] = [];
    for (const combination of combinations) {
      for (const contrast of [ContrastLevel.Standard, ContrastLevel.High]) {
        const { chrome } = paletteFor(combination, contrast);
        const surfaces = [
          chrome.surfaceSunken,
          chrome.surfaceBase,
          chrome.surfaceRaised,
          chrome.surfaceOverlay,
          chrome.surfaceHover,
          chrome.surfaceActive,
        ].map((surface) => surface.lightness.toFixed(4));

        if (new Set(surfaces).size !== surfaces.length) {
          collapsed.push(
            `${combination.dark ? 'dark' : 'light'} ${combination.brightness.toFixed(1)}`,
          );
        }
      }
    }
    expect(collapsed).toEqual([]);
  });

  it.each([ContrastLevel.Standard, ContrastLevel.High])(
    'keeps the text written on the waveform display readable on each of its surfaces at %s contrast',
    (contrast) => {
      // The display is dark in both themes. Its names were once the chrome's
      // text, dark in the light theme, and measured 1.04 to 1 on its background
      // there; high contrast, which darkens both, made them worse.
      const needed =
        contrast === ContrastLevel.High
          ? ContrastRequirement.Enhanced
          : ContrastRequirement.BodyText;
      const failures: string[] = [];
      for (const combination of combinations) {
        const { waveform, spectrogram } = paletteFor(combination, contrast);
        const surfaces = {
          background: waveform.background,
          pending: waveform.pending,
          spectrogramFloor: spectrogram[0],
        };
        for (const token of ['label', 'labelSecondary'] as const) {
          for (const [surfaceName, surface] of Object.entries(surfaces)) {
            const ratio = contrastRatio(waveform[token], surface);
            if (ratio < needed) {
              failures.push(
                `${combination.dark ? 'dark' : 'light'}/${combination.accent}/` +
                  `${combination.brightness.toFixed(1)}: ${token} on ${surfaceName} is ${ratio.toFixed(2)}`,
              );
            }
          }
        }
      }
      expect(failures).toEqual([]);
    },
  );

  it('meets every contrast requirement it solves for, so no palette falls short', () => {
    // A requirement the solver cannot meet is recorded rather than handed out
    // as a readable colour. Every palette AudioGubbins ships must record none,
    // at every brightness, accent and contrast level.
    const shortfalls: string[] = [];
    for (const combination of combinations) {
      for (const contrast of [ContrastLevel.Standard, ContrastLevel.High]) {
        const palette = paletteFor(combination, contrast);
        for (const shortfall of palette.contrastShortfalls) {
          shortfalls.push(`${shortfall.token} ${shortfall.ratio.toFixed(2)}`);
        }
      }
    }
    expect(shortfalls).toEqual([]);
  });
});

describe('the editing palettes', () => {
  it('moves the selection wash with brightness and high contrast, as every token does', () => {
    // The wash was the one token built without brightness and contrast, so it
    // stayed the same whatever the user chose.
    const base = { dark: true, accent: 'teal' as const, contrast: ContrastLevel.Standard };
    const designed = buildPalette({ ...base, brightness: 0 }).selection.fill;
    const brighter = buildPalette({ ...base, brightness: 1 }).selection.fill;
    const high = buildPalette({ ...base, brightness: 0, contrast: ContrastLevel.High }).selection
      .fill;

    expect(brighter.lightness).toBeGreaterThan(designed.lightness);
    expect(high.chroma).toBeLessThan(designed.chroma);
    // Still a wash: the material under a selection has to stay readable.
    expect(brighter.alpha).toBe(designed.alpha);
    expect(designed.alpha).toBeLessThan(1);
  });

  it('keeps clipping red whatever the accent', () => {
    // A user scanning for clipping should not have to remember which accent
    // they chose, and the accent can itself be red.
    for (const accent of ACCENTS) {
      const { waveform } = buildPalette({
        dark: true,
        accent,
        brightness: 0,
        contrast: ContrastLevel.Standard,
      });
      expect(waveform.clipped.hue).toBeGreaterThan(0);
      expect(waveform.clipped.hue).toBeLessThan(50);
    }
  });

  it('keeps the waveform and the selection handles legible against the display, on both displays', () => {
    // Asked of the dark display alone, this could not see the paper-white one,
    // where the designed peak is under 3 to 1 at the shipped brightness.
    const failures: string[] = [];
    for (const dark of [true, false]) {
      for (const contrast of [ContrastLevel.Standard, ContrastLevel.High]) {
        for (const accent of ACCENTS) {
          for (const brightness of BRIGHTNESS_STEPS) {
            const { waveform, selection } = buildPalette({ dark, accent, brightness, contrast });
            for (const [token, colour] of [
              ['peak', waveform.peak],
              ['handle', selection.handle],
            ] as const) {
              const ratio = contrastRatio(colour, waveform.background);
              if (ratio < ContrastRequirement.LargeText) {
                failures.push(
                  `${dark ? 'dark' : 'light'}/${contrast}/${accent}/${brightness.toFixed(1)}: ` +
                    `${token} is ${ratio.toFixed(2)}`,
                );
              }
            }
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it.each([
    { dark: true, direction: 1 },
    { dark: false, direction: -1 },
  ])(
    'moves monotonically away from silence through the spectrogram ramp (dark: $dark)',
    ({ dark, direction }) => {
      // A ramp that doubles back makes two different magnitudes look identical.
      // It rises in lightness on the dark display and falls on the paper-white
      // one, so in both the loudest energy is the strongest contrast against
      // silence.
      const { spectrogram } = buildPalette({
        dark,
        accent: 'teal',
        brightness: 0,
        contrast: ContrastLevel.Standard,
      });
      const [silence] = spectrogram;

      for (let index = 1; index < spectrogram.length; index += 1) {
        const step = spectrogram[index];
        const before = spectrogram[index - 1];
        if (step === undefined || before === undefined) throw new Error('A stop is missing.');
        expect(Math.sign(step.lightness - before.lightness)).toBe(direction);
        expect(contrastRatio(step, silence)).toBeGreaterThan(contrastRatio(before, silence));
      }
    },
  );

  it('keeps the selection translucent, so the material under it stays readable', () => {
    const { selection } = buildPalette({
      dark: true,
      accent: 'teal',
      brightness: 0,
      contrast: ContrastLevel.Standard,
    });
    expect(selection.fill.alpha).toBeLessThan(0.5);
    expect(selection.fill.alpha).toBeGreaterThan(0);
  });

  it('gives every category colour a distinct hue', () => {
    const { category } = buildPalette({
      dark: true,
      accent: 'teal',
      brightness: 0,
      contrast: ContrastLevel.Standard,
    });
    const hues = Object.values(category).map((colour) => Math.round(colour.hue));
    expect(new Set(hues).size).toBe(hues.length);
  });

  it('gives each theme a display of its own, not the chrome surface behind it', () => {
    // REQ-UX-070 keeps the editing palettes independent of the chrome, and the
    // owner's decision of 2026-10-16 gives the light theme a light display of
    // its own: paper white, not the chrome's grey and not the dark display.
    const dark = buildPalette({
      dark: true,
      accent: 'teal',
      brightness: 0,
      contrast: ContrastLevel.Standard,
    });
    const light = buildPalette({
      dark: false,
      accent: 'teal',
      brightness: 0,
      contrast: ContrastLevel.Standard,
    });

    expect(dark.waveform.background.lightness).toBeCloseTo(0.13, 5);
    expect(light.waveform.background.lightness).toBeCloseTo(0.98, 5);
    for (const surface of Object.values(light.chrome)) {
      expect(light.waveform.background).not.toEqual(surface);
    }
    // The body inside the envelope is the stronger mark on both displays:
    // lighter than the peak on the dark one, darker on the light one.
    expect(dark.waveform.rms.lightness).toBeGreaterThan(dark.waveform.peak.lightness);
    expect(light.waveform.rms.lightness).toBeLessThan(light.waveform.peak.lightness);
    expect(light.meter.background.lightness).toBeGreaterThan(0.8);
  });

  it('keeps the display surfaces apart at every brightness, on both displays', () => {
    // The wash where peaks are not yet known and the zero line are steps from
    // the background, so a brightness that carries the paper-white background
    // to white cannot carry them onto it. Stated as lightnesses of their own,
    // they reached white with it at the top of the control.
    const collapsed: string[] = [];
    for (const dark of [true, false]) {
      for (const contrast of [ContrastLevel.Standard, ContrastLevel.High]) {
        for (const brightness of BRIGHTNESS_STEPS) {
          const { waveform } = buildPalette({ dark, accent: 'teal', brightness, contrast });
          const lightnesses = [waveform.background, waveform.pending, waveform.centreLine].map(
            (colour) => colour.lightness.toFixed(3),
          );
          if (new Set(lightnesses).size !== lightnesses.length) {
            collapsed.push(`${dark ? 'dark' : 'light'} ${contrast} ${brightness.toFixed(1)}`);
          }
        }
      }
    }
    expect(collapsed).toEqual([]);
  });
});

describe('custom properties', () => {
  const theme = resolveTheme(DEFAULT_THEME_PREFERENCES, system());
  const properties = themeCustomProperties(theme);

  it('namespaces every property, so nothing collides with Dockview or Radix', () => {
    for (const name of Object.keys(properties)) {
      expect(name.startsWith('--ag-')).toBe(true);
    }
  });

  it('emits every chrome colour', () => {
    // Every token the chrome palette holds, and nothing it does not: three
    // named properties said nothing of the rest.
    const expected = Object.keys(theme.palette.chrome).map(
      (token) => `--ag-chrome-${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
    );
    const emitted = Object.keys(properties).filter((name) => name.startsWith('--ag-chrome-'));

    expect(emitted.sort()).toEqual(expected.sort());
    expect(expected).toContain('--ag-chrome-surface-base');
    expect(expected).toContain('--ag-chrome-text-primary');
    expect(expected).toContain('--ag-chrome-border-focus');
    for (const name of expected) expect(properties[name]).toMatch(/^oklch\(/);
  });

  it('emits the editing palettes separately from the chrome', () => {
    expect(properties['--ag-waveform-peak']).toBeDefined();
    expect(properties['--ag-selection-fill']).toBeDefined();
    expect(properties['--ag-meter-clip']).toBeDefined();
  });

  it('emits the spectrogram ramp with its length, so a renderer can interpolate', () => {
    expect(properties['--ag-spectrogram-0']).toBeDefined();
    expect(properties['--ag-spectrogram-stops']).toBe(String(theme.palette.spectrogram.length));
  });

  it('emits colours as oklch(), so the browser interpolates perceptually', () => {
    expect(properties['--ag-chrome-accent']).toMatch(/^oklch\(/);
  });

  it('emits sizes with a unit', () => {
    expect(properties['--ag-space-medium']).toMatch(/px$/);
    expect(properties['--ag-motion-quick']).toMatch(/ms$/);
  });

  it('emits line heights and weights without a unit, because each is a multiple or a number', () => {
    for (const role of ['body', 'tight', 'heading', 'readout']) {
      expect(properties[`--ag-text-line-height-${role}`]).toMatch(/^\d+(\.\d+)?$/);
    }
    expect(properties['--ag-text-weight-control']).toBe('550');
  });

  it('changes value, not name, when the theme changes', () => {
    // This is what lets a runtime theme change avoid rebuilding stylesheets
    // (REQ-UX-155): the property names are a fixed contract.
    const light = themeCustomProperties(
      resolveTheme(preferences({ mode: ThemeMode.Light }), system()),
    );
    expect(Object.keys(light).sort()).toEqual(Object.keys(properties).sort());
    expect(light['--ag-chrome-surface-base']).not.toBe(properties['--ag-chrome-surface-base']);
  });

  it('changes size values when the density changes', () => {
    const compact = themeCustomProperties(
      resolveTheme(preferences({ density: Density.Compact }), system()),
    );
    expect(compact['--ag-space-medium']).not.toBe(properties['--ag-space-medium']);
  });

  it('keeps the touch target the same in both densities', () => {
    const compact = themeCustomProperties(
      resolveTheme(preferences({ density: Density.Compact }), system()),
    );
    expect(compact['--ag-control-minimum-touch-target']).toBe(
      properties['--ag-control-minimum-touch-target'],
    );
  });
});

describe('data attributes', () => {
  it('describes the resolved theme, not the preference', () => {
    const attributes = themeDataAttributes(
      resolveTheme(preferences({ mode: ThemeMode.System }), system({ prefersDark: true })),
    );
    expect(attributes['data-ag-theme']).toBe('dark');
  });

  it('describes density, motion and contrast', () => {
    const attributes = themeDataAttributes(
      resolveTheme(
        preferences({ density: Density.Compact, motion: MotionLevel.Minimal }),
        system({ prefersMoreContrast: true }),
      ),
    );
    expect(attributes).toEqual({
      'data-ag-theme': 'dark',
      'data-ag-density': 'compact',
      'data-ag-motion': 'minimal',
      'data-ag-contrast': 'high',
    });
  });
});

describe('applyTheme', () => {
  it('writes every property onto the element it was given', () => {
    const element = document.createElement('div');
    applyTheme(element, resolveTheme(DEFAULT_THEME_PREFERENCES, system()));

    expect(element.style.getPropertyValue('--ag-chrome-surface-base')).toMatch(/^oklch\(/);
    expect(element.getAttribute('data-ag-theme')).toBe('dark');
  });

  it('touches nothing outside that element', () => {
    const element = document.createElement('div');
    applyTheme(element, resolveTheme(DEFAULT_THEME_PREFERENCES, system()));

    expect(document.documentElement.style.getPropertyValue('--ag-chrome-surface-base')).toBe('');
  });

  it('replaces the previous values when the theme changes', () => {
    const element = document.createElement('div');
    applyTheme(element, resolveTheme(DEFAULT_THEME_PREFERENCES, system()));
    const dark = element.style.getPropertyValue('--ag-chrome-surface-base');

    applyTheme(element, resolveTheme(preferences({ mode: ThemeMode.Light }), system()));

    expect(element.style.getPropertyValue('--ag-chrome-surface-base')).not.toBe(dark);
    expect(element.getAttribute('data-ag-theme')).toBe('light');
  });
});
