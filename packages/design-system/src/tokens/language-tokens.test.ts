/**
 * The design language's tokens, as the theme emits them.
 *
 * `docs/design/design-language.md` names every value by the custom property
 * that carries it, in a New tokens or a Changed tokens table per section. These
 * hold the emitted properties to those tables, for both themes, both densities,
 * every motion level and both contrast levels, so a value that drifts from the
 * language, or a token one combination forgets, fails here rather than on a
 * screen nobody looked at.
 */

import { describe, expect, it } from 'vitest';

import {
  ACCENT_NAMES,
  ContrastLevel,
  DEFAULT_THEME_PREFERENCES,
  Density,
  MotionLevel,
  ThemeMode,
  UNKNOWN_SYSTEM_APPEARANCE,
  type ThemePreferences,
} from './preferences.js';
import { motionFor } from './motion.js';
import { metricsFor } from './scale.js';
import { resolveTheme, themeCustomProperties } from './theme.js';

function emitted(overrides: Partial<ThemePreferences> = {}): Readonly<Record<string, string>> {
  return themeCustomProperties(
    resolveTheme({ ...DEFAULT_THEME_PREFERENCES, ...overrides }, UNKNOWN_SYSTEM_APPEARANCE),
  );
}

/** Every combination of the settings that change which values are emitted. */
const COMBINATIONS = [ThemeMode.Dark, ThemeMode.Light].flatMap((mode) =>
  [Density.Comfortable, Density.Compact].flatMap((density) =>
    [MotionLevel.Full, MotionLevel.Reduced, MotionLevel.Minimal].flatMap((motion) =>
      [ContrastLevel.Standard, ContrastLevel.High].map((contrast) => ({
        mode,
        density,
        motion,
        contrast,
      })),
    ),
  ),
);

/**
 * The language's new tokens, section by section, as their properties. A token
 * that is the whole of a gradient or a lamp is emitted as its stops, indexed,
 * and a swatch as one bead per accent the settings offer; those are listed by
 * the first of their properties here and in full below.
 */
const NEW_TOKENS = {
  layout: [
    '--ag-grid-unit',
    '--ag-space-inset',
    '--ag-space-gutter',
    '--ag-space-inset-leading',
    '--ag-space-inset-wide',
    '--ag-space-inset-feature',
    '--ag-shell-top-bar-block-size',
    '--ag-shell-transport-block-size',
    '--ag-control-row-height',
    '--ag-control-minimum-touch-text',
  ],
  type: [
    '--ag-font-ui',
    '--ag-font-numeric',
    '--ag-font-features',
    '--ag-text-display',
    '--ag-text-label',
    '--ag-text-caption',
    '--ag-text-readout',
    '--ag-text-scale',
    '--ag-text-ruler',
    '--ag-text-numeric-ratio',
    '--ag-text-weight-regular',
    '--ag-text-weight-quiet',
    '--ag-text-weight-medium',
    '--ag-text-weight-control',
    '--ag-text-weight-strong',
    '--ag-text-weight-heading',
    '--ag-text-weight-bold',
    '--ag-text-line-height-body',
    '--ag-text-line-height-tight',
    '--ag-text-line-height-heading',
    '--ag-text-line-height-readout',
    '--ag-text-tracking-tight',
    '--ag-text-tracking-readout',
    '--ag-text-tracking-caps',
    '--ag-effect-readout-glow',
  ],
  spacing: [
    '--ag-space-hair',
    '--ag-space-micro',
    '--ag-radius-hairline',
    '--ag-radius-control',
    '--ag-radius-container',
    '--ag-radius-frame',
  ],
  icons: [
    '--ag-icon-stroke',
    '--ag-icon-size-small',
    '--ag-icon-size-inline',
    '--ag-icon-size-feature',
    '--ag-icon-size-mark',
  ],
  colour: [
    '--ag-chrome-accent-text',
    '--ag-chrome-accent-partner',
    '--ag-chrome-fill-quiet',
    '--ag-chrome-fill-hover',
    '--ag-chrome-fill-press',
    '--ag-chrome-fill-well',
    '--ag-chrome-fill-accent',
    '--ag-chrome-edge-quiet',
    '--ag-chrome-edge-accent',
    '--ag-chrome-status-recording',
    '--ag-effect-cta-fill',
    '--ag-effect-danger-fill',
    '--ag-effect-cta-gloss',
    '--ag-effect-cta-edge',
    '--ag-effect-glow-cta',
    '--ag-effect-backdrop',
  ],
  elevation: [
    '--ag-elevation-panel-fill',
    '--ag-elevation-panel-edge',
    '--ag-elevation-panel-backdrop',
    '--ag-elevation-panel-shadow',
    '--ag-elevation-strip-fill',
    '--ag-elevation-card-fill',
    '--ag-elevation-overlay-fill',
    '--ag-elevation-overlay-edge',
    '--ag-elevation-overlay-backdrop',
    '--ag-elevation-overlay-shadow',
    '--ag-elevation-tooltip-fill',
    '--ag-elevation-tooltip-shadow',
    '--ag-elevation-floating-fill',
    '--ag-elevation-floating-shadow',
    '--ag-elevation-note-shadow',
    '--ag-elevation-drag-shadow',
    '--ag-elevation-scrim-backdrop',
  ],
  focus: [
    '--ag-focus-halo',
    '--ag-effect-lit-wash',
    '--ag-effect-lit-edge',
    '--ag-effect-lit-glow',
    '--ag-effect-glow',
    '--ag-effect-segment-wash',
  ],
  audio: [
    '--ag-waveform-grid',
    '--ag-waveform-ruler-height',
    '--ag-waveform-region-lane-height',
    '--ag-waveform-overview-height',
    '--ag-marker-default',
    '--ag-analysis-curve',
    '--ag-analysis-area',
    '--ag-analysis-threshold',
    '--ag-analysis-signal',
  ],
  states: [
    '--ag-state-mark-size',
    '--ag-effect-skeleton',
    '--ag-effect-progress-track',
    '--ag-effect-progress-sheen',
  ],
  controls: [
    '--ag-hardware-light',
    '--ag-hardware-shade',
    '--ag-hardware-metal-highlight',
    '--ag-hardware-metal-mid',
    '--ag-hardware-metal-shade',
    '--ag-hardware-chamfer-dark',
    '--ag-hardware-chamfer-light',
    '--ag-hardware-cutout',
    '--ag-hardware-cap-unlit-0',
    '--ag-hardware-led-off',
    '--ag-hardware-gloss',
    '--ag-hardware-drop-shadow',
    '--ag-hardware-deep-shadow',
    '--ag-hardware-record-shadow',
    '--ag-hardware-power-lit-cap',
    '--ag-hardware-record-lit-0',
    '--ag-hardware-record-unlit-0',
    '--ag-hardware-knob-size',
    '--ag-hardware-switch-width',
    '--ag-hardware-switch-height',
    '--ag-hardware-meter-segment',
    '--ag-hardware-meter-gap',
    '--ag-effect-token-wash',
  ],
  richness: ['--ag-effect-swatch-teal'],
  motion: [
    '--ag-motion-ease-spring',
    '--ag-motion-loop-focus',
    '--ag-motion-loop-float',
    '--ag-motion-loop-splitter',
    '--ag-motion-loop-landing',
    '--ag-motion-loop-recording',
    '--ag-motion-loop-shimmer',
    '--ag-motion-loop-spinner',
    '--ag-motion-loop-indeterminate',
    '--ag-motion-distance-small',
    '--ag-motion-distance-medium',
    '--ag-motion-distance-large',
    '--ag-motion-scale-overlay',
    '--ag-motion-scale-dialogue',
    '--ag-motion-scale-spring',
  ],
  ballistics: [
    '--ag-ballistics-fall-rate',
    '--ag-ballistics-peak-hold',
    '--ag-ballistics-peak-fall-rate',
    '--ag-ballistics-clip-hold',
    '--ag-ballistics-correlation-time',
  ],
} as const;

/** The tokens the language retires, which nothing may emit or read any more. */
const RETIRED = [
  '--ag-control-compact-height',
  '--ag-text-small',
  '--ag-text-tiny',
  '--ag-text-large',
  '--ag-text-monospace-body',
  '--ag-text-line-height',
  '--ag-radius-medium',
  '--ag-radius-large',
];

describe('the tokens the design language adds', () => {
  it('lists the 142 tokens of the language’s summary', () => {
    // Written as a number: counted from the lists above, an emptied list would
    // still agree with itself, and every assertion below would pass having
    // checked nothing.
    expect(Object.values(NEW_TOKENS).flat()).toHaveLength(142);
  });

  it.each(COMBINATIONS)(
    'emits every one of them, and no retired token, at $mode/$density/$motion/$contrast',
    (combination) => {
      const properties = emitted(combination);
      const missing = Object.values(NEW_TOKENS)
        .flat()
        .filter((name) => properties[name] === undefined || properties[name] === '');
      expect(missing).toEqual([]);
      expect(RETIRED.filter((name) => name in properties)).toEqual([]);
    },
  );

  it('emits the same names in every combination, so a theme change rewrites values only', () => {
    // REQ-UX-155: a runtime theme change rebuilds no stylesheet, because the
    // property names are a fixed contract. A token one combination forgot
    // would be left at the value of the theme before it.
    const names = Object.keys(emitted()).sort();
    for (const combination of COMBINATIONS) {
      expect(Object.keys(emitted(combination)).sort()).toEqual(names);
    }
    for (const accent of ACCENT_NAMES) {
      expect(Object.keys(emitted({ accent })).sort()).toEqual(names);
    }
  });

  it('emits the lamp and cap gradients stop by stop, and a swatch for every accent offered', () => {
    const properties = emitted();
    for (const index of [0, 1, 2, 3, 4]) {
      expect(properties[`--ag-hardware-record-lit-${String(index)}`]).toMatch(/^oklch\(/);
    }
    for (const index of [0, 1, 2]) {
      expect(properties[`--ag-hardware-record-unlit-${String(index)}`]).toMatch(/^oklch\(/);
    }
    for (const index of [0, 1]) {
      expect(properties[`--ag-hardware-cap-unlit-${String(index)}`]).toMatch(/^oklch\(/);
    }
    expect(properties['--ag-hardware-record-lit-5']).toBeUndefined();
    for (const accent of ACCENT_NAMES) {
      expect(properties[`--ag-effect-swatch-${accent}`]).toMatch(/gradient/);
      expect(properties[`--ag-effect-swatch-${accent}-edge`]).toMatch(/inset/);
    }
    expect(properties['--ag-effect-segment-edge']).toMatch(/^inset /);
  });
});

/**
 * The language's sizes, `comfortable / compact`, each as its table states it.
 * Every new size token and every changed one.
 */
const SIZES: Readonly<Record<string, readonly [string, string]>> = {
  '--ag-grid-unit': ['2px', '2px'],
  '--ag-space-none': ['0px', '0px'],
  '--ag-space-hair': ['1px', '1px'],
  '--ag-space-micro': ['2px', '2px'],
  '--ag-space-tiny': ['4px', '2px'],
  '--ag-space-small': ['6px', '6px'],
  '--ag-space-medium': ['10px', '8px'],
  '--ag-space-large': ['14px', '14px'],
  '--ag-space-huge': ['28px', '22px'],
  '--ag-space-inset': ['8px', '6px'],
  '--ag-space-gutter': ['8px', '6px'],
  '--ag-space-inset-leading': ['12px', '10px'],
  '--ag-space-inset-wide': ['16px', '12px'],
  '--ag-space-inset-feature': ['24px', '18px'],
  '--ag-radius-none': ['0px', '0px'],
  '--ag-radius-hairline': ['2px', '2px'],
  '--ag-radius-small': ['4px', '4px'],
  '--ag-radius-control': ['8px', '6px'],
  '--ag-radius-container': ['16px', '12px'],
  '--ag-radius-frame': ['24px', '18px'],
  '--ag-radius-full': ['9999px', '9999px'],
  '--ag-control-height': ['28px', '24px'],
  '--ag-control-row-height': ['44px', '36px'],
  '--ag-control-icon-size': ['16px', '14px'],
  '--ag-control-minimum-touch-target': ['44px', '44px'],
  '--ag-control-minimum-touch-text': ['16px', '16px'],
  '--ag-shell-top-bar-block-size': ['44px', '36px'],
  '--ag-shell-transport-block-size': ['56px', '46px'],
  '--ag-status-bar-block-size': ['34px', '30px'],
  '--ag-text-display': ['20px', '20px'],
  '--ag-text-heading': ['15px', '13px'],
  '--ag-text-body': ['13px', '12px'],
  '--ag-text-label': ['12px', '11px'],
  '--ag-text-caption': ['11px', '10px'],
  '--ag-text-readout': ['26px', '20px'],
  '--ag-text-scale': ['9px', '9px'],
  '--ag-text-ruler': ['10px', '9px'],
  '--ag-icon-size-small': ['12px', '12px'],
  '--ag-icon-size-inline': ['14px', '14px'],
  '--ag-icon-size-feature': ['20px', '20px'],
  '--ag-icon-size-mark': ['24px', '24px'],
  '--ag-icon-stroke': ['1.75', '1.75'],
  '--ag-focus-ring-width': ['2px', '2px'],
  '--ag-focus-ring-offset': ['2px', '2px'],
  '--ag-focus-ring-reach': ['4px', '4px'],
  '--ag-hardware-knob-size': ['52px', '44px'],
  '--ag-hardware-switch-width': ['38px', '32px'],
  '--ag-hardware-switch-height': ['22px', '20px'],
  '--ag-hardware-meter-segment': ['4px', '4px'],
  '--ag-hardware-meter-gap': ['1px', '1px'],
  '--ag-waveform-ruler-height': ['26px', '22px'],
  '--ag-waveform-region-lane-height': ['20px', '16px'],
  '--ag-waveform-overview-height': ['22px', '22px'],
  '--ag-state-mark-size': ['52px', '52px'],
};

describe('the sizes, at each density', () => {
  it.each([
    [Density.Comfortable, 0],
    [Density.Compact, 1],
  ] as const)('emits the language’s value of every size at %s density', (density, column) => {
    for (const mode of [ThemeMode.Dark, ThemeMode.Light]) {
      const properties = emitted({ density, mode });
      const wrong = Object.entries(SIZES)
        .filter(([name, values]) => properties[name] !== values[column])
        .map(([name, values]) => `${name}: ${String(properties[name])}, not ${values[column]}`);
      expect(wrong).toEqual([]);
    }
  });

  it('keeps every box on the 2-pixel grid, but a hairline and the full radius', () => {
    // Section 1: every control height, inset, gutter, radius, icon size and
    // panel dimension is a multiple of the unit. A hairline is exempt, and the
    // full radius is a number large enough to round any corner, not a box.
    // Text sizes are not boxes either: a line is centred by its control.
    const exempt = new Set(['hair', 'meterGap', 'full']);
    for (const density of [Density.Comfortable, Density.Compact]) {
      const metrics = metricsFor(density);
      const { stroke: _stroke, ...iconSizes } = metrics.icon;
      const boxes = {
        ...metrics.space,
        ...metrics.radius,
        ...metrics.control,
        ...iconSizes,
        ...metrics.shell,
        ...metrics.statusBar,
        ...metrics.focus,
        ...metrics.hardware,
        ...metrics.display,
        ...metrics.state,
      };
      const off = Object.entries(boxes).filter(
        ([token, value]) => !exempt.has(token) && value % metrics.grid.unit !== 0,
      );
      expect(off).toEqual([]);
    }
  });

  it('nests the corners: a container is its control plus its inset, a frame a container plus the gutter', () => {
    for (const density of [Density.Comfortable, Density.Compact]) {
      const { radius, space, control, shell } = metricsFor(density);
      expect(radius.container).toBe(radius.control + space.inset);
      expect(radius.frame).toBe(radius.container + space.gutter);
      expect(shell.topBarBlockSize).toBe(control.height + 2 * space.inset);
    }
  });
});

describe('the faces', () => {
  it('names each self-hosted face first, and a fallback of the same metrics class after it', () => {
    // ADR-0108: a face that fails to load falls back to a stack of the same
    // class, so the layout holds; the generic family last, so nothing falls
    // through to the browser's serif default.
    const properties = emitted();
    expect(properties['--ag-font-ui']).toBe("'Inter Variable', system-ui, sans-serif");
    expect(properties['--ag-font-numeric']).toBe(
      "'JetBrains Mono Variable', ui-monospace, monospace",
    );
    expect(properties['--ag-font-features']).toBe("'cv11', 'ss01'");
  });

  it('sets the weights, line heights and tracking the type scale states', () => {
    const properties = emitted({ density: Density.Compact });
    expect(
      ['regular', 'quiet', 'medium', 'control', 'strong', 'heading', 'bold'].map(
        (weight) => properties[`--ag-text-weight-${weight}`],
      ),
    ).toEqual(['400', '450', '500', '550', '600', '650', '700']);
    expect(properties['--ag-text-line-height-body']).toBe('1.45');
    expect(properties['--ag-text-line-height-tight']).toBe('1.35');
    expect(properties['--ag-text-line-height-heading']).toBe('1.25');
    expect(properties['--ag-text-line-height-readout']).toBe('1.05');
    expect(properties['--ag-text-tracking-tight']).toBe('-0.01em');
    expect(properties['--ag-text-tracking-readout']).toBe('-0.02em');
    expect(properties['--ag-text-tracking-caps']).toBe('0.06em');
    expect(properties['--ag-text-numeric-ratio']).toBe('0.95');
  });
});

describe('the motion levels', () => {
  /** MotionSpec's values, full / reduced / off, as the theme emits them. */
  const LEVELS: Readonly<Record<string, readonly [string, string, string]>> = {
    '--ag-motion-instant': ['90ms', '60ms', '0ms'],
    '--ag-motion-quick': ['160ms', '90ms', '0ms'],
    '--ag-motion-moderate': ['240ms', '120ms', '0ms'],
    '--ag-motion-deliberate': ['360ms', '150ms', '0ms'],
    '--ag-motion-ease-out': ['cubic-bezier(0.16, 1, 0.3, 1)', 'linear', 'linear'],
    '--ag-motion-ease-in': ['cubic-bezier(0.7, 0, 0.84, 0)', 'linear', 'linear'],
    '--ag-motion-ease-in-out': ['cubic-bezier(0.65, 0, 0.35, 1)', 'linear', 'linear'],
    '--ag-motion-loop-focus': ['1800ms', '1800ms', '1800ms'],
    '--ag-motion-loop-float': ['3200ms', '3200ms', '3200ms'],
    '--ag-motion-loop-splitter': ['2200ms', '2200ms', '2200ms'],
    '--ag-motion-loop-landing': ['2500ms', '2500ms', '2500ms'],
    '--ag-motion-loop-recording': ['1600ms', '1600ms', '1600ms'],
    '--ag-motion-loop-shimmer': ['1600ms', '1600ms', '1600ms'],
    '--ag-motion-loop-spinner': ['800ms', '800ms', '800ms'],
    '--ag-motion-loop-indeterminate': ['1400ms', '1400ms', '1400ms'],
    '--ag-motion-distance-small': ['4px', '0px', '0px'],
    '--ag-motion-distance-medium': ['8px', '0px', '0px'],
    '--ag-motion-distance-large': ['16px', '0px', '0px'],
    '--ag-motion-scale-overlay': ['0.96', '1', '1'],
    '--ag-motion-scale-dialogue': ['0.98', '1', '1'],
    '--ag-motion-scale-spring': ['0.82', '1', '1'],
    '--ag-ballistics-fall-rate': ['20', '20', '20'],
    '--ag-ballistics-peak-hold': ['1200ms', '1200ms', '1200ms'],
    '--ag-ballistics-peak-fall-rate': ['12', '12', '12'],
    '--ag-ballistics-clip-hold': ['1500ms', '1500ms', '1500ms'],
    '--ag-ballistics-correlation-time': ['170ms', '170ms', '170ms'],
  };

  it.each([
    [MotionLevel.Full, 0],
    [MotionLevel.Reduced, 1],
    [MotionLevel.Minimal, 2],
  ] as const)(
    'emits MotionSpec’s value of every motion token at the %s level',
    (motion, column) => {
      const properties = emitted({ motion });
      const wrong = Object.entries(LEVELS)
        .filter(([name, values]) => properties[name] !== values[column])
        .map(([name, values]) => `${name}: ${String(properties[name])}, not ${values[column]}`);
      expect(wrong).toEqual([]);
    },
  );

  it('springs at the full level alone, overshooting by a fifth at 40 per cent of the way', () => {
    expect(emitted({ motion: MotionLevel.Full })['--ag-motion-ease-spring']).toMatch(
      /^linear\(0, .*1\.204 40%.*, 1\)$/,
    );
    expect(emitted({ motion: MotionLevel.Reduced })['--ag-motion-ease-spring']).toBe('linear');
    expect(emitted({ motion: MotionLevel.Minimal })['--ag-motion-ease-spring']).toBe('linear');
  });

  it('gives a canvas the same values through the typed scale, at every level', () => {
    // The meters and the editor's zoom are canvases: they read the typed scale,
    // so it must say what the stylesheet says.
    for (const level of [MotionLevel.Full, MotionLevel.Reduced, MotionLevel.Minimal]) {
      const motion = motionFor(level);
      const properties = emitted({ motion: level });
      expect(`${String(motion.loop.focus)}ms`).toBe(properties['--ag-motion-loop-focus']);
      expect(`${String(motion.distance.large)}px`).toBe(properties['--ag-motion-distance-large']);
      expect(String(motion.scale.spring)).toBe(properties['--ag-motion-scale-spring']);
      expect(motion.ballistics).toEqual({
        fallRate: 20,
        peakHold: 1200,
        peakFallRate: 12,
        clipHold: 1500,
        correlationTime: 170,
      });
    }
  });
});

describe('the composite values', () => {
  it('writes every gradient, glow and shadow from the theme’s computed colours', () => {
    // ADR-0012: no colour is a literal. A composite value written with a fixed
    // colour would stay put when the accent changes; each that names the
    // accent must move with it.
    const teal = emitted({ accent: 'teal' });
    const red = emitted({ accent: 'red' });
    for (const name of [
      '--ag-effect-cta-fill',
      '--ag-effect-glow-cta',
      '--ag-effect-backdrop',
      '--ag-effect-lit-wash',
      '--ag-effect-lit-edge',
      '--ag-effect-glow',
      '--ag-effect-segment-wash',
      '--ag-effect-token-wash',
      '--ag-focus-halo',
      '--ag-effect-readout-glow',
    ]) {
      expect(teal[name], name).not.toBe(red[name]);
    }
    for (const [name, value] of Object.entries(teal)) {
      expect(value, name).not.toMatch(
        /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\b(white|black|transparent)\b/i,
      );
    }
  });

  it('keeps the light theme’s shadows softer by the shadow token, not by a second geometry', () => {
    const dark = emitted({ mode: ThemeMode.Dark });
    const light = emitted({ mode: ThemeMode.Light });
    const geometry = (value: string | undefined): string =>
      (value ?? '').replace(/oklch\([^)]*\)/g, 'colour');
    expect(geometry(light['--ag-elevation-panel-shadow'])).toBe(
      geometry(dark['--ag-elevation-panel-shadow']),
    );
    expect(light['--ag-elevation-panel-shadow']).not.toBe(dark['--ag-elevation-panel-shadow']);
  });
});
