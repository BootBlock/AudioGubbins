/**
 * The Inspector's time and rate controls: a length of silence to insert, a
 * length or a ratio to stretch to, and a sample rate to convert to, each run
 * as the command of the same name on what the view in use acts on. The
 * command checks what is typed, so a field and the palette refuse alike, and
 * the stretch and the conversion, run from a menu or the palette with no
 * value, send the person here to type one.
 */

import { useState, type ReactNode } from 'react';

import { OptionSelect, TextField } from '@audiogubbins/design-system';

import { DEFAULT_SILENCE_SECONDS, OFFERED_RATES } from '../../commands/time-edit-commands.js';
import { sampleRateWords } from '../../wording.js';
import { CommandButton, useCommandReasons, type PanelCommands } from '../command-button.js';
import { SharedReasonNotes, type SharedReasons } from '../settings/reasoned-button.js';

/** The commands of these controls, whose reasons are said once above them. */
const TIME_COMMANDS: readonly string[] = [
  'edit.insert-silence',
  'edit.stretch',
  'edit.convert-rate',
];

/** What a stretch is given: a length in seconds, or a ratio of the new length to the old. */
type StretchBy = 'seconds' | 'ratio';

const STRETCH_OPTIONS: readonly { readonly value: StretchBy; readonly label: string }[] = [
  { value: 'seconds', label: 'Length in seconds' },
  { value: 'ratio', label: 'Ratio of lengths' },
];

const RATE_OPTIONS = OFFERED_RATES.map((rate) => ({
  value: String(rate),
  label: sampleRateWords(rate),
}));

/**
 * The number typed, as a command reads one: an empty field is no number,
 * rather than the zero `Number` makes of it, so the command refuses it.
 */
function typedNumber(typed: string): number {
  return typed.trim() === '' ? Number.NaN : Number(typed);
}

/** What each row is given: the editor panel it acts in, and how it runs a command. */
interface RowParts {
  readonly panel: string;
  readonly commands: PanelCommands;
  readonly labelFor: (id: string) => string;

  /** The reasons of the three commands, said once above the rows. */
  readonly reasons: SharedReasons<string>;
}

/** A length of silence typed, and the control that inserts it. */
function SilenceRow({ panel, commands, labelFor, reasons }: RowParts): ReactNode {
  const [silence, setSilence] = useState(String(DEFAULT_SILENCE_SECONDS));
  const args = { view: panel, seconds: typedNumber(silence) };
  return (
    <div className="ag-inspector-row">
      <TextField
        label="Silence in seconds"
        value={silence}
        onValueChange={setSilence}
        onSubmit={() => {
          commands.run('edit.insert-silence', args);
        }}
      />
      <CommandButton
        id="edit.insert-silence"
        label={labelFor('edit.insert-silence')}
        commands={commands}
        args={args}
        compact
        shared={reasons}
      />
    </div>
  );
}

/** A length or a ratio typed, and the control that stretches to it. */
function StretchRow({ panel, commands, labelFor, reasons }: RowParts): ReactNode {
  const [stretchBy, setStretchBy] = useState<StretchBy>('ratio');
  const [stretch, setStretch] = useState('2');
  const args = { view: panel, [stretchBy]: typedNumber(stretch) };
  return (
    <div className="ag-inspector-row">
      <OptionSelect
        label="Stretch by"
        value={stretchBy}
        options={STRETCH_OPTIONS}
        onValueChange={(value) => {
          const chosen = STRETCH_OPTIONS.find((option) => option.value === value);
          if (chosen !== undefined) setStretchBy(chosen.value);
        }}
      />
      <TextField
        label={stretchBy === 'ratio' ? 'New length over old' : 'New length in seconds'}
        value={stretch}
        onValueChange={setStretch}
        onSubmit={() => {
          commands.run('edit.stretch', args);
        }}
      />
      <CommandButton
        id="edit.stretch"
        label={labelFor('edit.stretch')}
        commands={commands}
        args={args}
        compact
        shared={reasons}
      />
    </div>
  );
}

/** A sample rate chosen, first one the asset is not at, and the control that converts to it. */
function RateRow({
  panel,
  commands,
  labelFor,
  reasons,
  sampleRate,
}: RowParts & { readonly sampleRate: number }): ReactNode {
  const [rate, setRate] = useState(() =>
    String(OFFERED_RATES.find((offered) => offered !== sampleRate && offered >= 44_100) ?? 48_000),
  );
  return (
    <div className="ag-inspector-row">
      <OptionSelect
        label="Sample rate"
        value={rate}
        options={RATE_OPTIONS}
        onValueChange={setRate}
      />
      <CommandButton
        id="edit.convert-rate"
        label={labelFor('edit.convert-rate')}
        commands={commands}
        args={{ view: panel, rate: Number(rate) }}
        compact
        shared={reasons}
      />
    </div>
  );
}

/** The time and rate controls, acting in the editor panel `panel`. */
export function TimeControls(
  parts: Omit<RowParts, 'reasons'> & {
    /** The rate the asset is at now, which the rate offered first is not. */
    readonly sampleRate: number;
  },
): ReactNode {
  const reasons = useCommandReasons(parts.commands, TIME_COMMANDS);
  const rows = { ...parts, reasons };
  return (
    <div className="ag-inspector-controls">
      <h4 className="ag-inspector-heading">Time and rate</h4>
      <SharedReasonNotes reasons={reasons} />
      <SilenceRow {...rows} />
      <StretchRow {...rows} />
      <RateRow {...rows} />
    </div>
  );
}
