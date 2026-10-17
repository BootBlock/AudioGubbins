import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Icon, IconSize } from './icon.js';
import { ICON_GLYPHS, type IconName } from './vocabulary.js';

function isIconName(name: string): name is IconName {
  return Object.hasOwn(ICON_GLYPHS, name);
}

function drawn(name: IconName, size?: IconSize): SVGSVGElement {
  const { container } = render(
    size === undefined ? <Icon name={name} /> : <Icon name={name} size={size} />,
  );
  const svg = container.querySelector('svg');
  if (svg === null) throw new Error(`<Icon name="${name}"> drew no svg.`);
  return svg;
}

describe('Icon', () => {
  it('is decoration by default, hidden from assistive technology and out of the tab order', () => {
    const svg = drawn('close');

    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(svg).not.toHaveAttribute('role');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('names itself as an image when it is given a label', () => {
    render(<Icon name="warning" label="Warning" />);

    const image = screen.getByRole('img', { name: 'Warning' });
    expect(image).not.toHaveAttribute('aria-hidden');
  });

  it("fills only the transport's play and pause, and strokes every glyph", () => {
    const filledNames = Object.keys(ICON_GLYPHS)
      .filter(isIconName)
      .filter((name) => drawn(name).getAttribute('fill') === 'currentColor');

    expect(filledNames.toSorted()).toEqual(['pause', 'play']);
    expect(drawn('audition')).toHaveAttribute('fill', 'none');
    expect(drawn('play')).toHaveAttribute('stroke', 'currentColor');
    expect(drawn('close')).toHaveAttribute('stroke', 'currentColor');
  });

  it("fills a drop target's taken part alone, leaving the group's outline a stroke", () => {
    const svg = drawn('dock-left');
    const [outline, part] = [...svg.querySelectorAll('g > rect')];

    expect(svg).toHaveAttribute('fill', 'none');
    expect(outline).not.toHaveAttribute('fill');
    expect(part).toHaveAttribute('fill', 'currentColor');
    expect(part).toHaveAttribute('stroke', 'none');
  });

  it('draws with round caps and joins, and leaves the stroke width to the stylesheet', () => {
    const svg = drawn('close');

    expect(svg).toHaveAttribute('stroke-linecap', 'round');
    expect(svg).toHaveAttribute('stroke-linejoin', 'round');
    expect(svg).not.toHaveAttribute('stroke-width');
    expect(svg).not.toHaveAttribute('width');
    expect(svg).not.toHaveAttribute('style');
  });

  it('carries its size as a class, the control size by default', () => {
    expect(drawn('close')).toHaveClass('ag-icon', 'ag-icon-control');
    for (const size of Object.values(IconSize)) {
      expect(drawn('close', size)).toHaveClass('ag-icon', `ag-icon-${size}`);
    }
  });

  it('keeps a class it is given beside its own', () => {
    const { container } = render(<Icon name="close" className="tab-close" />);

    expect(container.querySelector('svg')).toHaveClass('ag-icon', 'ag-icon-control', 'tab-close');
  });

  it("draws the glyph's own shapes, without Lucide's keys among their attributes", () => {
    const shapes = [...drawn('information').querySelectorAll('g > *')];

    expect(shapes.map((shape) => shape.tagName)).toEqual(['circle', 'path', 'path']);
    for (const shape of shapes) expect(shape).not.toHaveAttribute('key');
  });

  it('draws the glyphs AudioGubbins drew itself', () => {
    const paths = [...drawn('fade-in').querySelectorAll('path')].map((path) =>
      path.getAttribute('d'),
    );

    expect(paths).toEqual(['M3 19h18', 'M21 5v14', 'M3 19c7 0 12-4 18-14']);
  });
});
