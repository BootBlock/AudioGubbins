/**
 * The parametric equaliser's controls: its response drawn from its settings
 * (`equaliser-curve.ts`), a tab for each of its eight bands with its colour,
 * type and whether it is on, and the chosen band's controls, its switch, its
 * type, and its frequency, gain and Q as knobs. Which band is chosen is the
 * panel's own view of the processor and is kept here; every setting is the
 * processor's, set by its command.
 */

import { useCallback, useState, type CSSProperties, type ReactNode } from 'react';

import { Button } from '@audiogubbins/design-system';
import type { ParameterValues } from '@audiogubbins/domain';
import { EQUALISER_BANDS } from '@audiogubbins/processors';

import { ChoiceControl, ToggleControl, type PresentationProps } from '../parameter-controls.js';
import { ParameterKnob, type ControlParts } from '../parameter-knob.js';
import { CurveCanvas, type CurveDrawing } from './curve-canvas.js';
import { BAND_COLOURS, drawEqualiser } from './equaliser-curve.js';

/** A band's colour, for its stylesheet to light its tab's dot with. */
function colourStyle(band: number): CSSProperties & { readonly '--ag-band-colour': string } {
  return { '--ag-band-colour': `var(--ag-category-${BAND_COLOURS[band] ?? 'teal'})` };
}

/** The label of a band's type, as its choice names it. */
function typeLabel(values: ParameterValues, band: (typeof EQUALISER_BANDS)[number]): string {
  const held = values.get(band.type.id);
  const key = typeof held === 'string' ? held : band.type.defaultKey;
  return band.type.options.find((option) => option.key === key)?.label ?? key;
}

/** The band to show first: the first that is on, or the first. */
function firstOn(values: ParameterValues): number {
  return Math.max(
    0,
    EQUALISER_BANDS.findIndex((band) => values.get(band.on.id) === true),
  );
}

/** The chosen band's switch, type and knobs. */
function BandControls({
  band,
  parts,
}: {
  readonly band: number;
  readonly parts: ControlParts;
}): ReactNode {
  const parameters = EQUALISER_BANDS[band];
  if (parameters === undefined) return null;
  const name = `Band ${String(band + 1)}`;
  const { values } = parts.processor;
  const knob = (parameter: typeof parameters.frequency, caption: string): ReactNode => {
    const value = values.get(parameter.id);
    return (
      <ParameterKnob
        parameter={parameter}
        value={typeof value === 'number' ? value : parameter.defaultValue}
        parts={parts}
        caption={caption}
      />
    );
  };
  return (
    <div className="ag-eq-band" role="group" aria-label={name}>
      <div className="ag-eq-band-choices">
        <ToggleControl parameter={parameters.on} parts={parts} caption={name} />
        <ChoiceControl parameter={parameters.type} parts={parts} caption="Type" />
      </div>
      <div className="ag-processor-knobs">
        {knob(parameters.frequency, 'Frequency')}
        {knob(parameters.gain, 'Gain')}
        {knob(parameters.q, 'Q')}
      </div>
    </div>
  );
}

/** A tab for each band: its colour, its number, its type, and whether it is on. */
function BandTabs({
  values,
  chosen,
  onChoose,
}: {
  readonly values: ParameterValues;
  readonly chosen: number;
  readonly onChoose: (band: number) => void;
}): ReactNode {
  return (
    <div className="ag-eq-bands" role="group" aria-label="Bands">
      {EQUALISER_BANDS.map((band, index) => {
        const on = values.get(band.on.id) === true;
        const type = typeLabel(values, band);
        return (
          <Button
            key={band.on.id}
            compact
            tone="quiet"
            aria-pressed={index === chosen}
            label={`Band ${String(index + 1)}, ${type}, ${on ? 'on' : 'off'}`}
            onClick={() => {
              onChoose(index);
            }}
          >
            <span
              className="ag-eq-band-tab"
              data-ag-off={on ? undefined : ''}
              style={colourStyle(index)}
            >
              <span className="ag-eq-band-dot" aria-hidden="true" />
              <span className="ag-eq-band-number">{index + 1}</span>
              <span className="ag-eq-band-type">{type}</span>
            </span>
          </Button>
        );
      })}
    </div>
  );
}

/** The equaliser's controls (see the module comment). */
export function EqualiserControls({ parts, sampleRate }: PresentationProps): ReactNode {
  const { values } = parts.processor;
  const [chosen, setChosen] = useState(() => firstOn(values));
  const draw = useCallback(
    (drawing: CurveDrawing) => {
      drawEqualiser(drawing, values, sampleRate, { band: chosen });
    },
    [values, sampleRate, chosen],
  );
  return (
    <>
      <div className="ag-processor-display">
        <CurveCanvas
          className="ag-processor-curve"
          label="The equaliser’s response, drawn from its bands"
          draw={draw}
        />
      </div>
      <BandTabs values={values} chosen={chosen} onChoose={setChosen} />
      <BandControls band={chosen} parts={parts} />
    </>
  );
}

/** The equaliser's response alone, small, as a card in the rack shows it. */
export function EqualiserThumbnail({
  values,
  sampleRate,
}: {
  readonly values: ParameterValues;
  readonly sampleRate: number;
}): ReactNode {
  const draw = useCallback(
    (drawing: CurveDrawing) => {
      drawEqualiser(drawing, values, sampleRate);
    },
    [values, sampleRate],
  );
  return (
    <CurveCanvas
      className="ag-rack-eq-thumbnail"
      label="The equaliser’s response, drawn from its bands"
      draw={draw}
    />
  );
}
