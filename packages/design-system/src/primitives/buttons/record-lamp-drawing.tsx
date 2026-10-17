/**
 * The record button's drawing: a backlit red lamp with a Fresnel lens (design
 * language, section 10, "Record button").
 *
 * Drawn in layers on a 48-unit grid: the cutout, a brushed bezel lit from the
 * top leading corner, a chamfer, the recess the cap sits in, and a smooth cap
 * of red plastic. The lens's concentric ridges are moulded on the cap's inner
 * face: lit from behind, each ridge is even all the way round and brighter
 * towards the centre, and its back is shaded; seen through the plastic, they
 * are softened. The room's light reflects once off the smooth front, softly,
 * with one small sharp highlight, and that reflection never moves or changes
 * with the lamp, because it is the page's light and not the lamp's.
 *
 * Lit and unlit are both drawn and the stylesheet fades between them; each
 * ridge carries how near the centre it is, which the stylesheet turns into its
 * brightness.
 */

import type { CSSProperties, ReactNode } from 'react';

import { useSvgIds } from './svg-id.js';

/** The lens's outermost ridge, in grid units from the centre. */
const LENS_RADIUS = 17;

/** The first ridge's radius and the pitch between ridges, in grid units. */
const FIRST_RIDGE = 2.2;
const RIDGE_PITCH = 1.55;

/** How far out from each ridge its shaded back lies, in grid units. */
const RIDGE_BACK = 0.6;

/** The precision a ridge's values are written to, free of floating-point noise. */
const PRECISION = 1e4;

/**
 * Each ridge's radius, and its nearness to the centre squared, which the
 * stylesheet turns into its brightness lit: brighter the nearer the centre.
 */
const RIDGES: readonly {
  readonly radius: number;
  readonly back: number;
  readonly nearness: number;
}[] = (() => {
  const rounded = (value: number): number => Math.round(value * PRECISION) / PRECISION;
  const ridges = [];
  for (let step = 0; FIRST_RIDGE + step * RIDGE_PITCH < LENS_RADIUS; step += 1) {
    const radius = rounded(FIRST_RIDGE + step * RIDGE_PITCH);
    const near = 1 - radius / LENS_RADIUS;
    ridges.push({ radius, back: rounded(radius + RIDGE_BACK), nearness: rounded(near * near) });
  }
  return ridges;
})();

/** A ridge's nearness to the centre, where the stylesheet reads it. */
function nearnessStyle(
  nearness: number,
): CSSProperties & { readonly '--ag-record-ridge-nearness': number } {
  return { '--ag-record-ridge-nearness': nearness };
}

/** The gradients and filters the lamp's layers are painted with, named for this lamp alone. */
function RecordLampPaints({ id }: { readonly id: (part: string) => string }): ReactNode {
  return (
    <defs>
      <radialGradient id={id('bezel')} cx="35%" cy="25%" r="85%">
        <stop offset="0%" className="ag-record-bezel-light" />
        <stop offset="45%" className="ag-record-bezel-mid" />
        <stop offset="100%" className="ag-record-bezel-shade" />
      </radialGradient>
      <linearGradient id={id('chamfer')} x1="0.2" y1="0" x2="0.8" y2="1">
        <stop offset="0%" className="ag-record-chamfer-dark" />
        <stop offset="100%" className="ag-record-chamfer-light" />
      </linearGradient>
      <radialGradient id={id('cap-lit')} cx="50%" cy="54%" r="52%">
        <stop offset="0%" className="ag-record-lit-0" />
        <stop offset="22%" className="ag-record-lit-1" />
        <stop offset="62%" className="ag-record-lit-2" />
        <stop offset="88%" className="ag-record-lit-3" />
        <stop offset="100%" className="ag-record-lit-4" />
      </radialGradient>
      <radialGradient id={id('cap-unlit')} cx="50%" cy="54%" r="52%">
        <stop offset="0%" className="ag-record-unlit-0" />
        <stop offset="80%" className="ag-record-unlit-1" />
        <stop offset="100%" className="ag-record-unlit-2" />
      </radialGradient>
      <radialGradient id={id('shade')} cx="50%" cy="30%" r="75%">
        <stop offset="70%" className="ag-record-shade-clear" />
        <stop offset="100%" className="ag-record-shade-deep" />
      </radialGradient>
      <radialGradient id={id('reflection')} cx="42%" cy="26%" r="58%">
        <stop offset="0%" className="ag-record-reflection-light" />
        <stop offset="100%" className="ag-record-reflection-clear" />
      </radialGradient>
      <filter id={id('blur')} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.3" />
      </filter>
      <filter id={id('through')} x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur stdDeviation="0.18" />
      </filter>
    </defs>
  );
}

/**
 * The lens's ridges, moulded on the cap's inner face: each a ridge and its
 * shaded back, softened by the plastic they are seen through.
 */
function FresnelRidges({ id }: { readonly id: (part: string) => string }): ReactNode {
  return (
    <g className="ag-record-fresnel" filter={`url(#${id('through')})`}>
      {RIDGES.map(({ radius, back, nearness }) => (
        <g key={radius} style={nearnessStyle(nearness)}>
          <circle
            className="ag-record-ridge"
            cx="24"
            cy="24"
            r={radius}
            fill="none"
            strokeWidth="0.55"
          />
          <circle
            className="ag-record-ridge-back"
            cx="24"
            cy="24"
            r={back}
            fill="none"
            strokeWidth="0.7"
          />
        </g>
      ))}
    </g>
  );
}

/** The record lamp's drawing, lit or not. */
export function RecordLampDrawing({ lit }: { readonly lit: boolean }): ReactNode {
  const id = useSvgIds('ag-record');
  return (
    <svg
      className="ag-record-drawing"
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      data-ag-lit={lit ? '' : undefined}
    >
      <RecordLampPaints id={id} />
      <circle className="ag-record-cutout" cx="24" cy="24.5" r="23.4" />
      <circle cx="24" cy="24" r="22.6" fill={`url(#${id('bezel')})`} />
      <circle cx="24" cy="24" r="19.2" fill={`url(#${id('chamfer')})`} />
      <circle
        className="ag-record-rim-glow ag-hardware-lit"
        cx="24"
        cy="24"
        r="18.4"
        fill="none"
        strokeWidth="1.6"
        filter={`url(#${id('blur')})`}
      />
      <circle
        className="ag-record-recess"
        cx="24"
        cy="24.6"
        r="17.6"
        filter={`url(#${id('blur')})`}
      />
      <circle cx="24" cy="24" r="17.2" fill={`url(#${id('cap-unlit')})`} />
      <circle
        className="ag-hardware-lit"
        cx="24"
        cy="24"
        r="17.2"
        fill={`url(#${id('cap-lit')})`}
      />
      <FresnelRidges id={id} />
      <circle cx="24" cy="24" r="17.2" fill={`url(#${id('shade')})`} />
      <circle
        className="ag-record-bloom ag-hardware-lit"
        cx="24"
        cy="26"
        r="6.5"
        filter={`url(#${id('blur')})`}
      />
      <circle className="ag-hardware-hover" cx="24" cy="24" r="17.2" />
      <circle className="ag-hardware-press" cx="24" cy="24" r="17.2" />
      <ellipse cx="21.5" cy="15.2" rx="10.5" ry="6.2" fill={`url(#${id('reflection')})`} />
      <ellipse
        className="ag-record-highlight"
        cx="18.2"
        cy="13.4"
        rx="2.2"
        ry="1.3"
        transform="rotate(-24 18.2 13.4)"
      />
    </svg>
  );
}
