/**
 * The power switch's drawing: a backlit push button (design language,
 * section 10, "Power switch").
 *
 * Drawn in layers on a 32-unit grid: the cutout in the panel, a chamfered
 * metal bezel lit from the top leading corner, a recessed domed cap with its
 * gloss, and the power glyph as an LED diffused through frosted plastic, lit
 * when on and an unlit moulding when off. The glyph is the vocabulary's own,
 * placed by its ink so the ink's box is centred in the button, and scaled
 * about that centre.
 *
 * The lit and unlit layers are both drawn and the stylesheet fades between
 * them; the bezel, the cap's shade and the gloss never change, because the
 * light they show is the page's, not the switch's.
 */

import { createElement, type ReactNode } from 'react';

import { ICON_GLYPHS } from '../../icons/vocabulary.js';
import { useSvgIds } from './svg-id.js';

/** The centre of the switch's 32-unit grid, where the glyph's ink is centred. */
const POWER_GRID_CENTRE = 16;

/** The glyph's scale on the cap, from its 24-unit grid. */
const POWER_GLYPH_SCALE = 0.62;

/** The centre of the glyph's own grid. */
const GLYPH_GRID_CENTRE = 12;

const GLYPH = ICON_GLYPHS.power;

/**
 * The LED's layers, as stroke widths in the glyph's own grid: a wide halo, a
 * tinted body and a hot core, lit; the moulding and its catch light, unlit.
 */
const HALO_WIDTH = 6;
const BODY_WIDTH = 3;
const CORE_WIDTH = 1.2;
const MOULDING_WIDTH = 3;

/**
 * The glyph's placement: its ink moved to its grid's centre, then that centre
 * scaled about and set on the switch's.
 */
const PLACEMENT = (() => {
  const shift = (offset: number): number =>
    POWER_GRID_CENTRE + POWER_GLYPH_SCALE * (offset - GLYPH_GRID_CENTRE);
  return `translate(${String(shift(GLYPH.offset.x))} ${String(shift(GLYPH.offset.y))}) scale(${String(POWER_GLYPH_SCALE)})`;
})();

/**
 * The glyph's shapes, each stroked `width` units of its own grid wide and
 * coloured by `className`.
 */
function glyph(className: string, width: number, filter?: string): ReactNode {
  return (
    <g
      className={className}
      fill="none"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(filter === undefined ? {} : { filter })}
    >
      {GLYPH.elements.map(([tag, { key, ...attributes }], index) =>
        createElement(tag, { ...attributes, key: key ?? index }),
      )}
    </g>
  );
}

/** The gradients and filters the switch's layers are painted with, named for this switch alone. */
function PowerSwitchPaints({ id }: { readonly id: (part: string) => string }): ReactNode {
  return (
    <defs>
      <linearGradient id={id('bezel')} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" className="ag-power-bezel-light" />
        <stop offset="45%" className="ag-power-bezel-mid" />
        <stop offset="100%" className="ag-power-bezel-shade" />
      </linearGradient>
      <linearGradient id={id('chamfer')} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" className="ag-power-chamfer-dark" />
        <stop offset="100%" className="ag-power-chamfer-light" />
      </linearGradient>
      <radialGradient id={id('cap-lit')} cx="50%" cy="40%" r="65%">
        <stop offset="0%" className="ag-power-cap-lit" />
        <stop offset="70%" className="ag-power-cap-lit-edge" />
      </radialGradient>
      <radialGradient id={id('cap-unlit')} cx="50%" cy="40%" r="65%">
        <stop offset="0%" className="ag-power-cap-unlit" />
        <stop offset="80%" className="ag-power-cap-unlit-edge" />
      </radialGradient>
      <radialGradient id={id('gloss')} cx="40%" cy="20%" r="60%">
        <stop offset="0%" className="ag-power-gloss-light" />
        <stop offset="100%" className="ag-power-gloss-clear" />
      </radialGradient>
      <filter id={id('halo')} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.6" />
      </filter>
      <filter id={id('diffuse')} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="0.35" />
      </filter>
      <filter id={id('spill')} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="0.6" />
      </filter>
    </defs>
  );
}

/** The power switch's drawing, on or off. */
export function PowerSwitchDrawing({ on }: { readonly on: boolean }): ReactNode {
  const id = useSvgIds('ag-power');
  return (
    <svg
      className="ag-power-drawing"
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      data-ag-lit={on ? '' : undefined}
    >
      <PowerSwitchPaints id={id} />
      <circle className="ag-power-cutout" cx="16" cy="16" r="15.5" />
      <circle cx="16" cy="16" r="14.5" fill={`url(#${id('bezel')})`} />
      <circle cx="16" cy="16" r="12" fill={`url(#${id('chamfer')})`} />
      <circle
        className="ag-power-spill ag-hardware-lit"
        cx="16"
        cy="16"
        r="11.6"
        fill="none"
        strokeWidth="1.2"
        filter={`url(#${id('spill')})`}
      />
      <circle cx="16" cy="16" r="11" fill={`url(#${id('cap-unlit')})`} />
      <circle className="ag-hardware-lit" cx="16" cy="16" r="11" fill={`url(#${id('cap-lit')})`} />
      <circle className="ag-power-cap-shade" cx="16" cy="16" r="11" fill="none" strokeWidth="1.4" />
      <g className="ag-power-glyph" transform={PLACEMENT}>
        <g className="ag-hardware-unlit">
          <g transform="translate(0 0.9)">{glyph('ag-power-led-catch', MOULDING_WIDTH)}</g>
          {glyph('ag-power-led-off', MOULDING_WIDTH)}
        </g>
        <g className="ag-hardware-lit">
          {glyph('ag-power-led-halo', HALO_WIDTH, `url(#${id('halo')})`)}
          {glyph('ag-power-led-body', BODY_WIDTH, `url(#${id('diffuse')})`)}
          {glyph('ag-power-led-core', CORE_WIDTH)}
        </g>
      </g>
      <circle className="ag-hardware-hover" cx="16" cy="16" r="11" />
      <circle className="ag-hardware-press" cx="16" cy="16" r="11" />
      <ellipse cx="14" cy="10.5" rx="7" ry="4.2" fill={`url(#${id('gloss')})`} />
    </svg>
  );
}
