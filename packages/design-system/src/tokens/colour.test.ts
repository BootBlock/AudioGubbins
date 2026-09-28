import { describe, expect, it } from 'vitest';

import {
  ContrastRequirement,
  contrastSolver,
  solveContrast,
  contrastRatio,
  meetsContrast,
  oklch,
  oklchToCss,
  oklchToHex,
  oklchToSrgb,
  relativeLuminance,
  scaleChroma,
  shiftLightness,
  srgbToOklch,
  type Srgb,
} from './colour.js';

function srgb(red: number, green: number, blue: number, alpha = 1): Srgb {
  return { red, green, blue, alpha };
}

describe('OKLCH and sRGB conversion', () => {
  // The reference values below come from the Oklab definition: white is L=1,
  // chroma 0, and the primaries have published Oklab coordinates. A conversion
  // that disagrees here is wrong before any palette is built on it.
  it('places white at the top of the lightness range with no chroma', () => {
    const white = srgbToOklch(srgb(1, 1, 1));
    expect(white.lightness).toBeCloseTo(1, 3);
    expect(white.chroma).toBeCloseTo(0, 3);
  });

  it('places black at the bottom of the lightness range with no chroma', () => {
    const black = srgbToOklch(srgb(0, 0, 0));
    expect(black.lightness).toBeCloseTo(0, 3);
    expect(black.chroma).toBeCloseTo(0, 3);
  });

  it('converts sRGB red to its published Oklab coordinates', () => {
    const red = srgbToOklch(srgb(1, 0, 0));
    expect(red.lightness).toBeCloseTo(0.6279, 3);
    expect(red.chroma).toBeCloseTo(0.2577, 3);
    expect(red.hue).toBeCloseTo(29.23, 1);
  });

  it('converts sRGB green to its published Oklab coordinates', () => {
    const green = srgbToOklch(srgb(0, 1, 0));
    expect(green.lightness).toBeCloseTo(0.8664, 3);
    expect(green.chroma).toBeCloseTo(0.2948, 3);
    expect(green.hue).toBeCloseTo(142.5, 1);
  });

  it('converts sRGB blue to its published Oklab coordinates', () => {
    const blue = srgbToOklch(srgb(0, 0, 1));
    expect(blue.lightness).toBeCloseTo(0.452, 3);
    expect(blue.chroma).toBeCloseTo(0.3132, 3);
    expect(blue.hue).toBeCloseTo(264.05, 1);
  });

  it('round-trips an arbitrary colour', () => {
    const original = srgb(0.2, 0.55, 0.85);
    const returned = oklchToSrgb(srgbToOklch(original));

    expect(returned.red).toBeCloseTo(original.red, 5);
    expect(returned.green).toBeCloseTo(original.green, 5);
    expect(returned.blue).toBeCloseTo(original.blue, 5);
  });

  it('round-trips every grey, where chroma is zero and hue is meaningless', () => {
    for (const level of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const returned = oklchToSrgb(srgbToOklch(srgb(level, level, level)));
      expect(returned.red).toBeCloseTo(level, 5);
      expect(returned.green).toBeCloseTo(level, 5);
      expect(returned.blue).toBeCloseTo(level, 5);
    }
  });

  it('preserves alpha through a round trip', () => {
    expect(oklchToSrgb(srgbToOklch(srgb(0.5, 0.5, 0.5, 0.42))).alpha).toBeCloseTo(0.42, 5);
  });

  it('clamps a colour outside the sRGB gamut rather than producing a negative channel', () => {
    // Chroma far beyond anything a display can show at this lightness.
    const impossible = oklchToSrgb(oklch(0.5, 0.9, 150));
    for (const channel of [impossible.red, impossible.green, impossible.blue]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(1);
    }
  });
});

describe('relativeLuminance', () => {
  it('gives white a luminance of one', () => {
    expect(relativeLuminance(srgbToOklch(srgb(1, 1, 1)))).toBeCloseTo(1, 3);
  });

  it('gives black a luminance of zero', () => {
    expect(relativeLuminance(srgbToOklch(srgb(0, 0, 0)))).toBeCloseTo(0, 3);
  });

  it('weights green far above blue, as the human eye does', () => {
    const green = relativeLuminance(srgbToOklch(srgb(0, 1, 0)));
    const blue = relativeLuminance(srgbToOklch(srgb(0, 0, 1)));
    expect(green).toBeGreaterThan(blue * 5);
  });
});

describe('contrastRatio', () => {
  it('gives black on white the maximum ratio of 21', () => {
    const black = srgbToOklch(srgb(0, 0, 0));
    const white = srgbToOklch(srgb(1, 1, 1));
    expect(contrastRatio(black, white)).toBeCloseTo(21, 1);
  });

  it('gives a colour against itself the minimum ratio of 1', () => {
    const colour = srgbToOklch(srgb(0.3, 0.6, 0.9));
    expect(contrastRatio(colour, colour)).toBeCloseTo(1, 5);
  });

  it('is symmetric, because contrast has no direction', () => {
    const light = srgbToOklch(srgb(0.9, 0.9, 0.9));
    const dark = srgbToOklch(srgb(0.1, 0.1, 0.1));
    expect(contrastRatio(light, dark)).toBeCloseTo(contrastRatio(dark, light), 10);
  });

  it('agrees with a published ratio for a known pair', () => {
    // #767676 on #ffffff is the canonical WCAG AA boundary for body text: it is
    // the darkest grey that still passes 4.5 to 1.
    const grey = srgbToOklch(srgb(0x76 / 255, 0x76 / 255, 0x76 / 255));
    const white = srgbToOklch(srgb(1, 1, 1));
    expect(contrastRatio(grey, white)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(grey, white)).toBeLessThan(4.7);
  });
});

describe('meetsContrast', () => {
  const black = srgbToOklch(srgb(0, 0, 0));
  const white = srgbToOklch(srgb(1, 1, 1));
  const midGrey = srgbToOklch(srgb(0.5, 0.5, 0.5));

  it('accepts black on white at every level', () => {
    expect(meetsContrast(black, white, ContrastRequirement.BodyText)).toBe(true);
    expect(meetsContrast(black, white, ContrastRequirement.Enhanced)).toBe(true);
  });

  it('rejects mid grey on white for body text', () => {
    expect(meetsContrast(midGrey, white, ContrastRequirement.BodyText)).toBe(false);
  });

  it('accepts mid grey on white for large text, which needs less', () => {
    expect(meetsContrast(midGrey, white, ContrastRequirement.LargeText)).toBe(true);
  });
});

describe('shiftLightness', () => {
  it('moves lightness without disturbing hue or chroma', () => {
    const original = oklch(0.5, 0.15, 250);
    const brighter = shiftLightness(original, 0.1);

    expect(brighter.lightness).toBeCloseTo(0.6, 10);
    expect(brighter.chroma).toBe(original.chroma);
    expect(brighter.hue).toBe(original.hue);
  });

  it('stops at white rather than passing it', () => {
    expect(shiftLightness(oklch(0.95, 0.1, 250), 0.5).lightness).toBe(1);
  });

  it('stops at black rather than passing it', () => {
    expect(shiftLightness(oklch(0.05, 0.1, 250), -0.5).lightness).toBe(0);
  });

  it('preserves the ordering of a palette when applied to all of it', () => {
    // This is what makes a brightness control something other than a filter:
    // every token moves by the same perceived amount, so a surface stays
    // distinguishable from the surface above it (REQ-UX-070).
    const surfaces = [oklch(0.15, 0.02, 250), oklch(0.2, 0.02, 250), oklch(0.26, 0.02, 250)];
    const brightened = surfaces.map((surface) => shiftLightness(surface, 0.08));

    for (let index = 1; index < brightened.length; index += 1) {
      const current = brightened[index];
      const previous = brightened[index - 1];
      expect(current?.lightness).toBeGreaterThan(previous?.lightness ?? 0);
    }
  });
});

describe('scaleChroma', () => {
  it('removes all colour at a factor of zero', () => {
    expect(scaleChroma(oklch(0.5, 0.2, 250), 0).chroma).toBe(0);
  });

  it('never produces a negative chroma', () => {
    expect(scaleChroma(oklch(0.5, 0.2, 250), -1).chroma).toBe(0);
  });

  it('leaves lightness and hue alone', () => {
    const scaled = scaleChroma(oklch(0.5, 0.2, 250), 0.5);
    expect(scaled.lightness).toBeCloseTo(0.5, 10);
    expect(scaled.hue).toBeCloseTo(250, 10);
  });
});

describe('oklch', () => {
  it('normalises a hue past a full turn', () => {
    expect(oklch(0.5, 0.1, 400).hue).toBeCloseTo(40, 10);
  });

  it('normalises a negative hue', () => {
    expect(oklch(0.5, 0.1, -30).hue).toBeCloseTo(330, 10);
  });

  it('clamps lightness into range', () => {
    expect(oklch(2, 0.1, 0).lightness).toBe(1);
    expect(oklch(-1, 0.1, 0).lightness).toBe(0);
  });
});

describe('CSS output', () => {
  it('emits an oklch() value, so the browser interpolates perceptually', () => {
    expect(oklchToCss(oklch(0.5, 0.12, 250))).toBe('oklch(50.00% 0.1200 250.00)');
  });

  it('includes alpha only when it is not opaque', () => {
    expect(oklchToCss(oklch(0.5, 0.12, 250, 0.5))).toContain('/ 0.500');
    expect(oklchToCss(oklch(0.5, 0.12, 250, 1))).not.toContain('/');
  });

  it('emits a hexadecimal value for a context that cannot take oklch()', () => {
    expect(oklchToHex(srgbToOklch(srgb(1, 1, 1)))).toBe('#ffffff');
    expect(oklchToHex(srgbToOklch(srgb(0, 0, 0)))).toBe('#000000');
    expect(oklchToHex(srgbToOklch(srgb(1, 0, 0)))).toBe('#ff0000');
  });
});

describe('solveContrast', () => {
  const white = srgbToOklch(srgb(1, 1, 1));
  const black = srgbToOklch(srgb(0, 0, 0));

  it('leaves a colour that already passes untouched', () => {
    const adjusted = solveContrast(black, white, ContrastRequirement.BodyText).colour;
    expect(adjusted).toEqual(black);
  });

  it('darkens a colour that is too light against a light background', () => {
    const tooLight = oklch(0.85, 0.05, 250);
    const adjusted = solveContrast(tooLight, white, ContrastRequirement.BodyText).colour;

    expect(adjusted.lightness).toBeLessThan(tooLight.lightness);
    expect(contrastRatio(adjusted, white)).toBeGreaterThanOrEqual(ContrastRequirement.BodyText);
  });

  it('lightens a colour that is too dark against a dark background', () => {
    const dark = oklch(0.2, 0.05, 250);
    const tooDark = oklch(0.3, 0.05, 250);
    const adjusted = solveContrast(tooDark, dark, ContrastRequirement.BodyText).colour;

    expect(adjusted.lightness).toBeGreaterThan(tooDark.lightness);
    expect(contrastRatio(adjusted, dark)).toBeGreaterThanOrEqual(ContrastRequirement.BodyText);
  });

  it('keeps hue and chroma, moving only lightness', () => {
    const original = oklch(0.75, 0.15, 190);
    const adjusted = solveContrast(original, white, ContrastRequirement.BodyText).colour;

    expect(adjusted.hue).toBeCloseTo(original.hue, 6);
    expect(adjusted.chroma).toBeCloseTo(original.chroma, 6);
  });

  it('moves no further than it has to', () => {
    // Overshooting would make every adjusted token black or white, which would
    // destroy the hierarchy the palette exists to express.
    const adjusted = solveContrast(
      oklch(0.85, 0.05, 250),
      white,
      ContrastRequirement.BodyText,
    ).colour;
    const ratio = contrastRatio(adjusted, white);

    expect(ratio).toBeGreaterThanOrEqual(ContrastRequirement.BodyText);
    expect(ratio).toBeLessThan(ContrastRequirement.BodyText + 0.1);
  });

  it('returns the best the display can do when the requirement is unreachable', () => {
    // Nothing reaches 21 to 1 against mid grey. Returning black is the honest
    // answer, and the theme tests then fail loudly rather than this quietly
    // returning something that does not meet the requirement.
    const midGrey = srgbToOklch(srgb(0.5, 0.5, 0.5));
    const adjusted = solveContrast(oklch(0.4, 0, 0), midGrey, 21).colour;

    expect(adjusted.lightness).toBe(0);
  });

  it('crosses to the other side of a mid-toned background when its own side cannot reach', () => {
    // Against this grey, white reaches under 3:1 and black over 7:1. The
    // solver searched only away from the background on the colour's own side,
    // so it returned white, unreadable, and said nothing.
    const grey = srgbToOklch(srgb(0.6, 0.6, 0.6));
    const solution = solveContrast(oklch(0.9, 0, 0), grey, ContrastRequirement.BodyText);

    expect(solution.met).toBe(true);
    expect(solution.colour.lightness).toBeLessThan(grey.lightness);
    expect(contrastRatio(solution.colour, grey)).toBeGreaterThanOrEqual(
      ContrastRequirement.BodyText,
    );
  });

  it('crosses no further than it has to', () => {
    const grey = srgbToOklch(srgb(0.6, 0.6, 0.6));
    const solution = solveContrast(oklch(0.9, 0, 0), grey, ContrastRequirement.BodyText);

    expect(solution.ratio).toBeLessThan(ContrastRequirement.BodyText + 0.1);
  });

  it('says when the requirement cannot be met, and how close it came', () => {
    const midGrey = srgbToOklch(srgb(0.5, 0.5, 0.5));
    const solution = solveContrast(oklch(0.6, 0, 0), midGrey, 21);

    expect(solution.met).toBe(false);
    // Black contrasts more with mid grey than white does, whichever side the
    // colour started on.
    expect(solution.colour.lightness).toBe(0);
    expect(solution.ratio).toBeCloseTo(contrastRatio(solution.colour, midGrey), 10);
  });

  it('terminates for every requirement it is given', () => {
    for (const requirement of [
      ContrastRequirement.LargeText,
      ContrastRequirement.BodyText,
      ContrastRequirement.Enhanced,
    ]) {
      for (const lightness of [0, 0.25, 0.5, 0.75, 1]) {
        const adjusted = solveContrast(oklch(lightness, 0.1, 200), white, requirement).colour;
        expect(Number.isFinite(adjusted.lightness)).toBe(true);
      }
    }
  });
});

describe('contrastSolver', () => {
  it('remembers every token that fell short, and by how much', () => {
    const solver = contrastSolver();
    const white = oklch(1, 0, 0);

    solver.solve('readable', oklch(0.2, 0, 0), white, ContrastRequirement.BodyText);
    solver.solve('impossible', oklch(0.2, 0, 0), white, 25);

    expect(solver.shortfalls()).toEqual([
      { token: 'impossible', ratio: expect.closeTo(21, 1) as number, required: 25 },
    ]);
  });

  it('remembers nothing when every token is met', () => {
    const solver = contrastSolver();
    solver.solve('text', oklch(0.9, 0, 0), oklch(0.1, 0, 0), ContrastRequirement.BodyText);
    expect(solver.shortfalls()).toEqual([]);
  });
});
