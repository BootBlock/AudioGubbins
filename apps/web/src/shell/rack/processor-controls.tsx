/**
 * A processor's controls (REQ-AUDIO-017, REQ-EDIT-072): one for each of its
 * parameters, as its descriptor describes it, shared by the Effects rack and
 * the Inspector, so a processor is set one way wherever it is shown.
 *
 * A number is a knob along the parameter's taper, its value a field a number
 * is typed into (`parameter-knob.tsx`); a choice of two or three is a
 * segmented control and a longer one an option select; an on or off is a
 * switch; and every number has its reset, in one menu. A type with a
 * presentation of its own draws it from its settings above its controls, or
 * in their place where it lays its parameters out itself: the equaliser's
 * response and bands, the compressor's transfer curve (`presentations/`).
 * Every change is the command that sets the parameter.
 */

import type { ReactNode } from 'react';

import type { ProcessorDescriptor, ProcessorInstance } from '@audiogubbins/domain';

import type { PanelCommands } from '../command-button.js';
import type { ControlParts } from './parameter-knob.js';
import { ParameterControls, ResetMenu, type PresentationProps } from './parameter-controls.js';
import { CompressorControls } from './presentations/compressor-controls.js';
import { EqualiserControls } from './presentations/equaliser-controls.js';

/**
 * The types with a presentation of their own, by type key, each drawing it.
 * Each draws its own component, so the component a processor is drawn by is
 * the same on every render and keeps its state.
 */
const PRESENTATIONS: ReadonlyMap<string, (props: PresentationProps) => ReactNode> = new Map([
  ['parametric-equaliser', (props: PresentationProps) => <EqualiserControls {...props} />],
  ['compressor', (props: PresentationProps) => <CompressorControls {...props} />],
]);

/** The controls of every parameter of `processor`, in its descriptor's order. */
export function ProcessorControls({
  processor,
  descriptor,
  panel,
  commands,
  sampleRate,
}: {
  readonly processor: ProcessorInstance;
  readonly descriptor: ProcessorDescriptor;
  readonly panel: string;
  readonly commands: PanelCommands;
  /** The rate of the audio the processor runs on, which a response is drawn at. */
  readonly sampleRate: number;
}): ReactNode {
  const parts: ControlParts = { processor, panel, commands };
  if (descriptor.parameters.length === 0) {
    return <p className="ag-panel-note">{`${descriptor.label} has no settings.`}</p>;
  }
  const present = PRESENTATIONS.get(descriptor.typeKey);
  return (
    <div className="ag-processor-controls">
      {present === undefined ? (
        <ParameterControls parameters={descriptor.parameters} parts={parts} />
      ) : (
        present({ descriptor, parts, sampleRate })
      )}
      <div className="ag-processor-tools">
        <ResetMenu parameters={descriptor.parameters} parts={parts} />
      </div>
    </div>
  );
}
