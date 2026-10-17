import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { sampledBoxOf } from '../testing/shape-sampler.js';
import { Icon, IconSize } from './icon.js';
import { ICON_GLYPHS, type IconName } from './vocabulary.js';

/** Each size's drawn width in pixels, as the design language's icon scale sets it. */
const PIXELS: Readonly<Record<IconSize, number>> = {
  small: 12,
  inline: 14,
  control: 16,
  feature: 20,
  mark: 24,
};

/** The design language's tolerance for every icon, and the tighter one for the power glyph. */
const TOLERANCE_PIXELS = 0.25;
const POWER_TOLERANCE_PIXELS = 0.02;

function isIconName(name: string): name is IconName {
  return Object.hasOwn(ICON_GLYPHS, name);
}

const NAMES = Object.keys(ICON_GLYPHS).filter(isIconName);

/**
 * How far the drawn ink's centre lies from the grid's, in pixels at the size
 * drawn, on each axis: the shapes and the translation read back from the DOM,
 * and the box found by sampling, not by the icon's own measurement.
 */
function inkMiss(name: IconName, size: IconSize): { x: number; y: number } {
  const { container, unmount } = render(<Icon name={name} size={size} />);
  const svg = container.querySelector('svg');
  const group = svg?.querySelector('g');
  const translation = /^translate\((-?[\d.e-]+) (-?[\d.e-]+)\)$/.exec(
    group?.getAttribute('transform') ?? '',
  );
  expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
  expect(translation, `the translation of ${name}`).not.toBeNull();

  const box = sampledBoxOf(group?.children ?? []);
  const dx = Number(translation?.[1]);
  const dy = Number(translation?.[2]);
  unmount();

  const pixelsPerUnit = PIXELS[size] / 24;
  return {
    x: ((box.left + box.right) / 2 + dx - 12) * pixelsPerUnit,
    y: ((box.top + box.bottom) / 2 + dy - 12) * pixelsPerUnit,
  };
}

describe('every icon is centred by its ink', () => {
  it('draws a vocabulary to measure', () => {
    expect(NAMES.length).toBeGreaterThan(100);
  });

  for (const size of Object.values(IconSize)) {
    it(`centres every glyph to within ${String(TOLERANCE_PIXELS)} px at ${size} size`, () => {
      const misses = NAMES.flatMap((name) => {
        const miss = inkMiss(name, size);
        const off = Math.max(Math.abs(miss.x), Math.abs(miss.y));
        return off > TOLERANCE_PIXELS
          ? [`${name}: ${miss.x.toFixed(3)}, ${miss.y.toFixed(3)}`]
          : [];
      });
      expect(misses).toEqual([]);
    });

    it(`centres the power glyph to within ${String(POWER_TOLERANCE_PIXELS)} px at ${size} size`, () => {
      const miss = inkMiss('power', size);
      expect(Math.abs(miss.x)).toBeLessThanOrEqual(POWER_TOLERANCE_PIXELS);
      expect(Math.abs(miss.y)).toBeLessThanOrEqual(POWER_TOLERANCE_PIXELS);
    });
  }
});
