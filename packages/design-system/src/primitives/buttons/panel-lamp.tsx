/**
 * A panel lamp: the drawing of a radio choice (design language, section 10,
 * "Radio: a panel lamp").
 *
 * Drawn in layers as a real lamp is built, on a 20-unit grid: the cutout in
 * the panel, a brushed bezel lit from the top leading corner, a recessed
 * socket, and a domed lens. Unlit, the lens is tinted glass; lit, the LED
 * behind it glows through the diffuser to a hot core and its light spills onto
 * the socket, inside the lens and never round the control. The gloss sits on
 * top, where the page's light falls, lit or not.
 *
 * Both the lit and the unlit layers are always drawn, and the stylesheet fades
 * between them, so the lamp lights at the pace of the motion level. Every
 * colour is the stylesheet's, from the tokens.
 */

import type { ReactNode } from 'react';

import { useSvgIds } from './svg-id.js';

/** The gradients and filters the lamp's layers are painted with, named for this lamp alone. */
function PanelLampPaints({ id }: { readonly id: (part: string) => string }): ReactNode {
  return (
    <defs>
      <linearGradient id={id('bezel')} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" className="ag-lamp-bezel-light" />
        <stop offset="50%" className="ag-lamp-bezel-mid" />
        <stop offset="100%" className="ag-lamp-bezel-shade" />
      </linearGradient>
      <linearGradient id={id('socket')} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" className="ag-lamp-socket-deep" />
        <stop offset="100%" className="ag-lamp-socket-lip" />
      </linearGradient>
      <radialGradient id={id('lens-unlit')} cx="50%" cy="50%" r="50%">
        <stop offset="0%" className="ag-lamp-glass" />
        <stop offset="100%" className="ag-lamp-glass-edge" />
      </radialGradient>
      <radialGradient id={id('lens-lit')} cx="50%" cy="50%" r="50%">
        <stop offset="0%" className="ag-lamp-led-core" />
        <stop offset="30%" className="ag-lamp-led-inner" />
        <stop offset="68%" className="ag-lamp-led-outer" />
        <stop offset="100%" className="ag-lamp-led-rim" />
      </radialGradient>
      <radialGradient id={id('gloss')} cx="38%" cy="28%" r="55%">
        <stop offset="0%" className="ag-lamp-gloss-light" />
        <stop offset="100%" className="ag-lamp-gloss-clear" />
      </radialGradient>
      <filter id={id('bloom')} x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="0.9" />
      </filter>
      <filter id={id('spill')} x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="0.7" />
      </filter>
    </defs>
  );
}

/** A panel lamp, lit or not. */
export function PanelLamp({ lit }: { readonly lit: boolean }): ReactNode {
  const id = useSvgIds('ag-lamp');
  return (
    <svg
      className="ag-lamp"
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
      data-ag-lit={lit ? '' : undefined}
    >
      <PanelLampPaints id={id} />
      <circle className="ag-lamp-cutout" cx="10" cy="10" r="9.5" />
      <circle cx="10" cy="10" r="9" fill={`url(#${id('bezel')})`} />
      <circle cx="10" cy="10" r="7.4" fill={`url(#${id('socket')})`} />
      <circle
        className="ag-lamp-spill ag-hardware-lit"
        cx="10"
        cy="10"
        r="7.2"
        filter={`url(#${id('spill')})`}
      />
      <circle cx="10" cy="10" r="6.4" fill={`url(#${id('lens-unlit')})`} />
      <circle
        className="ag-hardware-lit"
        cx="10"
        cy="10"
        r="6.4"
        fill={`url(#${id('lens-lit')})`}
      />
      <circle className="ag-lamp-lens-ring" cx="10" cy="10" r="6.4" fill="none" strokeWidth="0.8" />
      <circle
        className="ag-lamp-bloom ag-hardware-lit"
        cx="10"
        cy="10"
        r="4.2"
        filter={`url(#${id('bloom')})`}
      />
      <circle
        className="ag-lamp-core-ring ag-hardware-lit"
        cx="10"
        cy="10"
        r="5.6"
        fill="none"
        strokeWidth="1.4"
        filter={`url(#${id('bloom')})`}
      />
      <circle className="ag-hardware-hover" cx="10" cy="10" r="6.4" />
      <ellipse
        className="ag-lamp-gloss"
        cx="8.6"
        cy="7.4"
        rx="3.6"
        ry="2.4"
        fill={`url(#${id('gloss')})`}
      />
    </svg>
  );
}
