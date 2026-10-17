/**
 * What a processor's card in the rack shows of it at a glance: a level it
 * sets alone as a fader, its first two numbers as knobs, or, for a type with
 * a curve, the curve drawn from its settings. Each control is the one its
 * full controls show, setting the parameter by the same command, so a card
 * can be adjusted without being selected; its value reads only, since the
 * field a number is typed into is the full controls'.
 */

import { useState, type ReactNode } from 'react';

import { Badge, BadgeTone, Fader, type FaderMark } from '@audiogubbins/design-system';
import type { NumericParameterDescriptor, ProcessorDescriptor } from '@audiogubbins/domain';
import { EQUALISER_BANDS } from '@audiogubbins/processors';
import { counted } from '@audiogubbins/text';

import { numericText } from '../../commands/rack-words.js';
import { ParameterKnob, scaleOf, setParameter, type ControlParts } from './parameter-knob.js';
import { EqualiserThumbnail } from './presentations/equaliser-controls.js';

/** The marks a console prints down a level fader, in decibels, those a short one keeps first. */
const FADER_MARKS: readonly (readonly [value: number, minor: boolean])[] = [
  [10, false],
  [5, true],
  [0, false],
  [-5, true],
  [-10, false],
  [-20, false],
  [-30, true],
  [-40, false],
  [-60, true],
];

/** The marks of `parameter`'s range, unity emphasised. */
function marksOf(parameter: NumericParameterDescriptor): readonly FaderMark[] {
  return FADER_MARKS.filter(
    ([value]) => value >= parameter.minimum && value <= parameter.maximum,
  ).map(([value, minor]) => ({
    value,
    // The typographic minus, as every value of the rack is written.
    label: String(value).replace('-', '−'),
    ...(value === 0 ? { emphasised: true } : {}),
    ...(minor ? { minor: true } : {}),
  }));
}

/** A level the processor sets alone, as a console's fader. */
function LevelFader({
  parameter,
  value,
  parts,
}: {
  readonly parameter: NumericParameterDescriptor;
  readonly value: number;
  readonly parts: ControlParts;
}): ReactNode {
  const [moving, setMoving] = useState<number | undefined>(undefined);
  const shown = moving ?? value;
  return (
    <Fader
      label={parameter.label}
      value={shown}
      minimum={parameter.minimum}
      maximum={parameter.maximum}
      scale={scaleOf(parameter)}
      marks={marksOf(parameter)}
      bypassed={!parts.processor.enabled}
      onValueChange={setMoving}
      onValueCommit={(settled) => {
        setMoving(undefined);
        setParameter(parts, parameter, settled);
      }}
      describeValue={(one) => numericText(parameter, one)}
      displayValue={numericText(parameter, shown)}
    />
  );
}

/** What a card is given to show a processor with. */
interface SummaryProps {
  readonly descriptor: ProcessorDescriptor;
  readonly parts: ControlParts;
  readonly sampleRate: number;
}

/** The equaliser at a glance: its response, and how many of its bands are on. */
function EqualiserSummary({ parts, sampleRate }: SummaryProps): ReactNode {
  const { values } = parts.processor;
  const on = EQUALISER_BANDS.filter((band) => values.get(band.on.id) === true).length;
  return (
    <>
      <EqualiserThumbnail values={values} sampleRate={sampleRate} />
      <Badge tone={on === 0 ? BadgeTone.Neutral : BadgeTone.Accent}>
        {on === 0 ? 'No bands on' : counted(on, 'band', 'bands')}
      </Badge>
    </>
  );
}

/**
 * The types a card shows in a way of their own, by type key, each drawing its
 * own component, so a card is drawn by the same component on every render.
 */
const SUMMARIES: ReadonlyMap<string, (props: SummaryProps) => ReactNode> = new Map([
  ['parametric-equaliser', (props: SummaryProps) => <EqualiserSummary {...props} />],
]);

/** Any other processor at a glance: a level it sets alone as a fader, else its first two numbers. */
function NumbersSummary({ descriptor, parts }: SummaryProps): ReactNode {
  const { values } = parts.processor;
  const numbers = descriptor.parameters.flatMap((parameter) => {
    const value = values.get(parameter.id);
    return parameter.kind === 'numeric' && typeof value === 'number' ? [{ parameter, value }] : [];
  });
  const [only, ...rest] = numbers;
  if (only !== undefined && rest.length === 0 && only.parameter.unit === 'dB') {
    return (
      <div className="ag-rack-slot-fader">
        <LevelFader parameter={only.parameter} value={only.value} parts={parts} />
      </div>
    );
  }
  if (numbers.length === 0) return null;
  return (
    <div className="ag-rack-slot-knobs">
      {numbers.slice(0, 2).map(({ parameter, value }) => (
        <ParameterKnob
          key={parameter.id}
          parameter={parameter}
          value={value}
          parts={parts}
          typed={false}
        />
      ))}
    </div>
  );
}

/** What the card of a processor shows of it (see the module comment). */
export function ProcessorSummary(props: SummaryProps): ReactNode {
  const summary = SUMMARIES.get(props.descriptor.typeKey);
  return summary === undefined ? <NumbersSummary {...props} /> : summary(props);
}
