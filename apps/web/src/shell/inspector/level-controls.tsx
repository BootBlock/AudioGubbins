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
    <div className="ag-inspector-row">
      <TextField
        label="Gain in decibels"
        value={decibels}
        onValueChange={setDecibels}
        onSubmit={() => {
          commands.run('edit.gain', args);
        }}
      />
      <CommandButton
        id="edit.gain"
        label={labelFor('edit.gain')}
        commands={commands}
        args={args}
        compact
      />
    </div>
  );
}

/** A fade shape, and the controls that fade in and out with it. */
function FadeControl({ panel, commands, labelFor }: ControlParts): ReactNode {
  const [shape, setShape] = useState<FadeShape>(FadeShape.Linear);
  return (
    <div className="ag-inspector-row">
      <OptionSelect
        label="Fade shape"
        value={shape}
        options={SHAPE_OPTIONS}
        onValueChange={(value) => {
          if (isFadeShape(value)) setShape(value);
        }}
      />
      {['edit.fade-in', 'edit.fade-out'].map((id) => (
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
  );
}

/** The gain and fade controls, acting in the editor panel `panel`. */
export function LevelControls(parts: ControlParts): ReactNode {
  return (
    <div className="ag-inspector-controls">
      <GainControl {...parts} />
      <FadeControl {...parts} />
    </div>
  );
}
