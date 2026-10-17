/**
 * The Inspector's level controls: a gain typed in decibels, and a fade of a
 * chosen shape, each run as the command of the same name on what the view in
 * use acts on, the selection or else the whole sound (ADR-0042). The command
 * checks what is typed, so a field and the palette refuse alike.
 */

import { useState, type ReactNode } from 'react';

import { OptionSelect, TextField } from '@audiogubbins/design-system';
import { FadeShape } from '@audiogubbins/domain';

import { CommandButton, type PanelCommands } from '../command-button.js';
import { FADE_SHAPE_NAMES } from './edit-words.js';
import { InspectorPart } from './inspector-part.js';

const SHAPE_OPTIONS = [...FADE_SHAPE_NAMES].map(([value, label]) => ({ value, label }));

/** Whether `value` names a fade shape. */
function isFadeShape(value: string): value is FadeShape {
  return [...FADE_SHAPE_NAMES.keys()].some((shape) => shape === value);
}

/**
 * The decibels typed, as the command reads a number: an empty field is no
 * number, rather than the zero `Number` makes of it, so the command asks for
 * one.
 */
function decibelsOf(typed: string): number {
  return typed.trim() === '' ? Number.NaN : Number(typed);
}

/** What each control is given: the editor panel it acts in, and how it runs a command. */
interface ControlParts {
  readonly panel: string;
  readonly commands: PanelCommands;
  readonly labelFor: (id: string) => string;
}

/** A gain typed in decibels, and the control that makes it. */
function GainControl({ panel, commands, labelFor }: ControlParts): ReactNode {
  const [decibels, setDecibels] = useState('-3');
  const args = { view: panel, decibels: decibelsOf(decibels) };
  return (
    <div className="ag-inspector-form-row">
      <TextField
        label="Gain in decibels"
        unit="dB"
        value={decibels}
        onValueChange={setDecibels}
        onSubmit={() => {
          commands.run('edit.gain', args);
        }}
      />
      <div className="ag-inspector-form-actions">
        <CommandButton
          id="edit.gain"
          label={labelFor('edit.gain')}
          commands={commands}
          args={args}
          compact
        />
      </div>
    </div>
  );
}

/** The fades, in and out. */
const FADES: readonly string[] = ['edit.fade-in', 'edit.fade-out'];

/** A fade shape, and the controls that fade in and out with it. */
function FadeControl({ panel, commands, labelFor }: ControlParts): ReactNode {
  const [shape, setShape] = useState<FadeShape>(FadeShape.Linear);
  return (
    <>
      {/* Two buttons do not fit beside a select in a narrow panel, so they
          take the line under it, under the control rather than its label. */}
      <div className="ag-inspector-form-row" data-ag-actions-below="">
        <OptionSelect
          label="Fade shape"
          value={shape}
          options={SHAPE_OPTIONS}
          onValueChange={(value) => {
            if (isFadeShape(value)) setShape(value);
          }}
        />
        <div className="ag-inspector-form-actions">
          {FADES.map((id) => (
            <CommandButton
              key={id}
              id={id}
              label={labelFor(id)}
              commands={commands}
              args={{ view: panel, shape }}
              compact
            />
          ))}
        </div>
      </div>
    </>
  );
}

/** The gain and fade controls, acting in the editor panel `panel`. */
export function LevelControls(parts: ControlParts): ReactNode {
  return (
    <InspectorPart heading="Level" title="Level">
      <GainControl {...parts} />
      <FadeControl {...parts} />
    </InspectorPart>
  );
}
