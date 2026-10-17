/**
 * What a knob is drawn as: the tick scale printed on the panel with the value
 * ring lit along it, then the skirt, the grip and the cap, each holding the
 * part of it that turns, its pointer, ribs or index line. What turns reads the
 * turn its dial sets, so the face is drawn from the value's fraction alone.
 */

import type { ReactNode } from 'react';

import {
  KNOB_GRID,
  KNOB_RING_STROKE,
  KNOB_TICK_STROKE,
  KNOB_TICKS,
  KNOB_TRACK,
  knobValueArc,
} from './knob-geometry.js';

/** A knob's face, its value ring lit to `fraction` of its sweep. */
export function KnobFace({ fraction }: { readonly fraction: number }): ReactNode {
  const valueArc = knobValueArc(fraction);
  return (
    <>
      <svg
        className="ag-knob-scale"
        viewBox={`0 0 ${String(KNOB_GRID)} ${String(KNOB_GRID)}`}
        strokeLinecap="round"
        fill="none"
      >
        {KNOB_TICKS.map((tick) => (
          <line
            key={`${String(tick.x1)},${String(tick.y1)}`}
            className={tick.major ? 'ag-knob-tick' : 'ag-knob-tick ag-knob-tick-minor'}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            strokeWidth={KNOB_TICK_STROKE}
          />
        ))}
        <path className="ag-knob-track" d={KNOB_TRACK} strokeWidth={KNOB_RING_STROKE} />
        {valueArc !== undefined && (
          <path className="ag-knob-value-ring" d={valueArc} strokeWidth={KNOB_RING_STROKE} />
        )}
      </svg>
      <span className="ag-knob-skirt">
        <span className="ag-knob-turned">
          <span className="ag-knob-pointer" />
        </span>
      </span>
      <span className="ag-knob-grip">
        <span className="ag-knob-turned ag-knob-ribs" />
      </span>
      <span className="ag-knob-cap">
        <span className="ag-knob-turned ag-knob-index" />
      </span>
    </>
  );
}
