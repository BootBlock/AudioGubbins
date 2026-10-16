/**
 * The editors of an asset group's policy fields (ADR-0101): each starts from
 * the value the field resolves to now, so changing an inherited value starts
 * from it, and gives what it was set to as the value the policy commands take,
 * the project document's own canonical JSON, built by the game-audio
 * package's own constructors. A value one refuses is shown with its reason
 * beside the control that would set it, and nothing is run; one it accepts is
 * read again by the project's command, which is the authority.
 */

import { useState, type ReactNode } from 'react';

import { OptionSelect, TextField } from '@audiogubbins/design-system';
import type { DomainResult, Project } from '@audiogubbins/domain';
import {
  DEFAULT_EMITTER_RULES,
  DEFAULT_VOICE_VARIATION,
  busName,
  destinationPath,
  namingTemplate,
  type Attenuation,
  type EmitterRules,
  type PolicyField,
  type PolicyValues,
  type SelectionRule,
  type VoiceStealing,
} from '@audiogubbins/game-audio';
import type { LibraryListing } from '@audiogubbins/storage';

import { policyValueArgument } from '../../commands/game-group-commands.js';
import type { ProfilePreset } from '../../commands/game-profiles.js';
import { chainWords } from '../../commands/rack-words.js';
import { CommandButton, type PanelCommands } from '../command-button.js';

/** What an editor gives: a value as the commands take it, a saved chain, or why it gives none. */
export type EditedValue =
  { readonly value: string } | { readonly entry: string } | { readonly refused: string };

/** How an editor sets what it gives: the command, its label, and its arguments for a value. */
export interface FieldSetter {
  readonly id: string;
  readonly label: string;
  readonly args: (
    edited: { readonly value: string } | { readonly entry: string },
  ) => Readonly<Record<string, string>>;
}

/** What every editor is given beside its own field's value. */
export interface EditorParts {
  readonly project: Project;
  readonly setter: FieldSetter;
  readonly commands: PanelCommands;

  /** The export presets a profile may be set from. */
  readonly presets: readonly ProfilePreset[];

  /** The saved chains, the built-in ones among them, a group's processing may be set from. */
  readonly library: readonly LibraryListing[];
}

/** The control that sets what an editor gives, with its reason where it gives nothing. */
function SetButton({
  edited,
  parts,
}: {
  readonly edited: EditedValue;
  readonly parts: EditorParts;
}): ReactNode {
  const { setter, commands } = parts;
  return 'refused' in edited ? (
    <CommandButton
      id={setter.id}
      label={setter.label}
      commands={commands}
      refusal={edited.refused}
      compact
    />
  ) : (
    <CommandButton
      id={setter.id}
      label={setter.label}
      commands={commands}
      args={setter.args(edited)}
      compact
    />
  );
}

/**
 * A draft that starts again from `initial` whenever the value it was started
 * from changes, by this editor's own command, an undo or another view.
 */
function useDraft<T>(initial: T): readonly [T, (next: T) => void] {
  const [draft, setDraft] = useState(initial);
  const [from, setFrom] = useState(initial);
  if (from !== initial) {
    setFrom(initial);
    setDraft(initial);
  }
  return [draft, setDraft];
}

/** A number typed, or `undefined` where the field holds none. */
function numberIn(typed: string): number | undefined {
  const value = typed.trim() === '' ? Number.NaN : Number(typed);
  return Number.isFinite(value) ? value : undefined;
}

/** A value made by a game-audio constructor, as the commands take it, or its reason. */
function made<F extends PolicyField>(field: F, result: DomainResult<PolicyValues[F]>): EditedValue {
  return result.ok
    ? { value: policyValueArgument(field, result.value) }
    : { refused: result.failures.map((one) => one.summary).join(' ') };
}

/** A field typed as text, made into a value by `make`. */
function TextEditor({
  label,
  initial,
  make,
  parts,
}: {
  readonly label: string;
  readonly initial: string;
  readonly make: (typed: string) => EditedValue;
  readonly parts: EditorParts;
}): ReactNode {
  const [typed, setTyped] = useDraft(initial);
  const edited = make(typed);
  return (
    <div className="ag-inspector-row">
      <TextField
        label={label}
        value={typed}
        onValueChange={setTyped}
        onSubmit={() => {
          if (!('refused' in edited))
            parts.commands.run(parts.setter.id, parts.setter.args(edited));
        }}
      />
      <SetButton edited={edited} parts={parts} />
    </div>
  );
}

/** Numbers typed into labelled fields, made into a value by `make` once each is a number. */
function NumbersEditor({
  fields,
  make,
  parts,
}: {
  readonly fields: readonly {
    readonly label: string;
    readonly initial: string;
    readonly optional?: boolean;
  }[];
  readonly make: (numbers: readonly (number | undefined)[]) => EditedValue;
  readonly parts: EditorParts;
}): ReactNode {
  const [typed, setTyped] = useDraft(fields.map((one) => one.initial).join('\u0000'));
  const values = typed.split('\u0000');
  const numbers = values.map(numberIn);
  const missing = fields.some(
    (one, index) => one.optional !== true && numbers[index] === undefined,
  );
  const edited: EditedValue = missing ? { refused: 'Type a number in each field.' } : make(numbers);
  return (
    <div className="ag-inspector-row">
      {fields.map((one, index) => (
        <TextField
          key={one.label}
          label={one.label}
          value={values[index] ?? ''}
          onValueChange={(next) => {
            setTyped(values.map((value, at) => (at === index ? next : value)).join('\u0000'));
          }}
        />
      ))}
      <SetButton edited={edited} parts={parts} />
    </div>
  );
}

/** The chain a group's processing names, or none, or a saved chain to copy in. */
function ProcessingEditor({
  initial,
  parts,
}: {
  readonly initial: PolicyValues['processing'] | undefined;
  readonly parts: EditorParts;
}): ReactNode {
  const options = [
    { value: 'none', label: 'No processing' },
    ...[...parts.project.effectChains.values()].map((chain) => ({
      value: `chain:${chain.id}`,
      label: `In the project: ${chainWords(chain)}`,
    })),
    ...parts.library.flatMap((listed) =>
      listed.kind === 'usable' && listed.entry.content.kind === 'chain'
        ? [
            {
              value: `entry:${listed.entry.id}`,
              label: `${listed.builtIn ? 'Built in' : 'Saved'}: ${listed.entry.name}`,
            },
          ]
        : [],
    ),
  ];
  const [chosen, setChosen] = useDraft(
    initial === undefined || initial === 'none' ? 'none' : `chain:${initial}`,
  );
  const [kind, id = ''] = chosen.split(':');
  const chain = [...parts.project.effectChains.keys()].find((one) => one === id);
  const edited: EditedValue =
    kind === 'entry'
      ? { entry: id }
      : { value: policyValueArgument('processing', chain ?? 'none') };
  return (
    <div className="ag-inspector-row">
      <OptionSelect label="Processing" value={chosen} options={options} onValueChange={setChosen} />
      <SetButton edited={edited} parts={parts} />
    </div>
  );
}

/** The export preset a profile is set from. */
function ProfileEditor({ parts }: { readonly parts: EditorParts }): ReactNode {
  const [first] = parts.presets;
  const [chosen, setChosen] = useState(first?.id ?? '');
  const preset = parts.presets.find((one) => one.id === chosen);
  const edited: EditedValue =
    preset === undefined
      ? { refused: 'Choose an export preset.' }
      : { value: policyValueArgument('exportProfile', preset.profile) };
  return (
    <div className="ag-inspector-row">
      <OptionSelect
        label="From the export preset"
        value={chosen}
        options={parts.presets.map((one) => ({ value: one.id, label: one.name }))}
        onValueChange={setChosen}
      />
      <SetButton edited={edited} parts={parts} />
    </div>
  );
}

const SELECTIONS = [
  { value: 'uniform', label: 'At random' },
  { value: 'avoid-recent', label: 'Never the last chosen' },
];

const STEALING: readonly { readonly value: VoiceStealing; readonly label: string }[] = [
  { value: 'oldest', label: 'Steal the oldest' },
  { value: 'quietest', label: 'Steal the quietest' },
  { value: 'reject', label: 'Refuse a new voice' },
];

const ATTENUATIONS: readonly { readonly value: Attenuation['kind']; readonly label: string }[] = [
  { value: 'none', label: 'No attenuation' },
  { value: 'inverse', label: 'Inverse distance' },
  { value: 'inverse-square', label: 'Inverse square' },
  { value: 'logarithmic', label: 'Logarithmic' },
  { value: 'exponent', label: 'By exponent' },
];

/** The attenuation of `kind` from the numbers typed: unit size, furthest distance, ceiling, exponent. */
function attenuationOf(
  kind: Attenuation['kind'],
  [unitSize, maxDistance, ceiling, exponent]: readonly (number | undefined)[],
): Attenuation | string {
  if (kind === 'none') return { kind };
  if (kind === 'exponent') {
    return maxDistance === undefined || exponent === undefined
      ? 'Type the furthest distance and the exponent.'
      : { kind, maxDistance, exponent };
  }
  return unitSize === undefined || maxDistance === undefined || ceiling === undefined
    ? 'Type the unit size, the furthest distance and the ceiling.'
    : { kind, unitSize, maxDistance, ceilingDecibels: ceiling };
}

/** How a player of the group selects, limits, steals, cools down and attenuates. */
function EmitterEditor({
  initial,
  parts,
}: {
  readonly initial: EmitterRules | undefined;
  readonly parts: EditorParts;
}): ReactNode {
  const from = initial ?? DEFAULT_EMITTER_RULES;
  const [selection, setSelection] = useDraft<string>(from.selection.kind);
  const [stealing, setStealing] = useDraft<VoiceStealing>(from.voices.stealing);
  const [attenuation, setAttenuation] = useDraft<Attenuation['kind']>(from.attenuation.kind);
  const at = from.attenuation;
  const fields = [
    {
      label: 'Never the last, how many',
      initial: from.selection.kind === 'avoid-recent' ? String(from.selection.depth) : '2',
      optional: true,
    },
    { label: 'Voices at once', initial: String(from.voices.limit) },
    { label: 'Cooldown in milliseconds', initial: String(from.cooldownMilliseconds) },
    { label: 'Unit size', initial: 'unitSize' in at ? String(at.unitSize) : '1', optional: true },
    {
      label: 'Silent from',
      initial: 'maxDistance' in at ? String(at.maxDistance) : '20',
      optional: true,
    },
    {
      label: 'Ceiling in dB',
      initial: 'ceilingDecibels' in at ? String(at.ceilingDecibels) : '0',
      optional: true,
    },
    { label: 'Exponent', initial: 'exponent' in at ? String(at.exponent) : '1', optional: true },
  ];
  const make = ([depth, limit, cooldown, ...distance]: readonly (
    number | undefined
  )[]): EditedValue => {
    const rule: SelectionRule | string =
      selection === 'avoid-recent'
        ? depth === undefined
          ? 'Type how many it never repeats.'
          : { kind: 'avoid-recent', depth }
        : { kind: 'uniform' };
    const attenuated = attenuationOf(attenuation, distance);
    if (typeof rule === 'string') return { refused: rule };
    if (typeof attenuated === 'string') return { refused: attenuated };
    if (limit === undefined || cooldown === undefined)
      return { refused: 'Type a number in each field.' };
    const rules: EmitterRules = {
      selection: rule,
      voices: { limit, stealing },
      cooldownMilliseconds: cooldown,
      attenuation: attenuated,
      ...(from.filter === undefined ? {} : { filter: from.filter }),
    };
    return { value: policyValueArgument('emitter', rules) };
  };
  return (
    <>
      <div className="ag-inspector-row">
        <OptionSelect
          label="Selection"
          value={selection}
          options={SELECTIONS}
          onValueChange={setSelection}
        />
        <OptionSelect
          label="Past the limit"
          value={stealing}
          options={STEALING}
          onValueChange={(value) => {
            const chosen = STEALING.find((one) => one.value === value);
            if (chosen !== undefined) setStealing(chosen.value);
          }}
        />
        <OptionSelect
          label="Attenuation"
          value={attenuation}
          options={ATTENUATIONS}
          onValueChange={(value) => {
            const chosen = ATTENUATIONS.find((one) => one.value === value);
            if (chosen !== undefined) setAttenuation(chosen.value);
          }}
        />
      </div>
      <NumbersEditor fields={fields} make={make} parts={parts} />
    </>
  );
}

/** The editor of `field`, starting from `initial`, the value it resolves to now. */
export function FieldEditor<F extends PolicyField>({
  field,
  initial,
  parts,
}: {
  readonly field: F;
  readonly initial: PolicyValues[F] | undefined;
  readonly parts: EditorParts;
}): ReactNode {
  const values: Partial<PolicyValues> = { [field]: initial };
  switch (field) {
    case 'processing':
      return <ProcessingEditor initial={values.processing} parts={parts} />;
    case 'exportProfile':
      return <ProfileEditor parts={parts} />;
    case 'emitter':
      return <EmitterEditor initial={values.emitter} parts={parts} />;
    case 'loudness': {
      const target = values.loudness;
      return (
        <NumbersEditor
          fields={[
            {
              label: 'Integrated loudness in LUFS',
              initial: String(target?.integratedLufs ?? -16),
            },
            { label: 'Tolerance in LU', initial: String(target?.toleranceLu ?? 1) },
            {
              label: 'True-peak ceiling in dBTP, if any',
              initial:
                target?.truePeakCeilingDbtp === undefined ? '' : String(target.truePeakCeilingDbtp),
              optional: true,
            },
          ]}
          make={([integratedLufs = 0, toleranceLu = 0, ceiling]) => ({
            value: policyValueArgument('loudness', {
              integratedLufs,
              toleranceLu,
              ...(ceiling === undefined ? {} : { truePeakCeilingDbtp: ceiling }),
            }),
          })}
          parts={parts}
        />
      );
    }
    case 'variation': {
      const from = values.variation ?? DEFAULT_VOICE_VARIATION;
      return (
        <NumbersEditor
          fields={[
            { label: 'Lowest pitch in cents', initial: String(from.pitchCents.min) },
            { label: 'Highest pitch in cents', initial: String(from.pitchCents.max) },
            { label: 'Lowest gain in dB', initial: String(from.gainDecibels.min) },
            { label: 'Highest gain in dB', initial: String(from.gainDecibels.max) },
            {
              label: 'Furthest start in milliseconds',
              initial: String(from.startOffsetMilliseconds.max),
            },
          ]}
          make={([pitchLow = 0, pitchHigh = 0, gainLow = 0, gainHigh = 0, start = 0]) => ({
            value: policyValueArgument('variation', {
              pitchCents: { min: pitchLow, max: pitchHigh },
              gainDecibels: { min: gainLow, max: gainHigh },
              startOffsetMilliseconds: { max: start },
            }),
          })}
          parts={parts}
        />
      );
    }
    case 'naming':
      return (
        <TextEditor
          label="Naming template"
          initial={values.naming?.source ?? '{group:snake}_{number:2}'}
          make={(typed) => made('naming', namingTemplate(typed))}
          parts={parts}
        />
      );
    case 'destination':
      return (
        <TextEditor
          label="Destination folder, its folders separated by /"
          initial={values.destination?.segments.join('/') ?? ''}
          make={(typed) =>
            made('destination', destinationPath(typed === '' ? [] : typed.split('/')))
          }
          parts={parts}
        />
      );
    case 'bus':
      return (
        <TextEditor
          label="Bus"
          initial={values.bus ?? ''}
          make={(typed) => made('bus', busName(typed))}
          parts={parts}
        />
      );
    case 'tags':
      return (
        <TextEditor
          label="Tags, separated by commas"
          initial={values.tags?.join(', ') ?? ''}
          make={(typed) => ({
            value: policyValueArgument(
              'tags',
              typed
                .split(',')
                .map((tag) => tag.trim())
                .filter((tag) => tag !== ''),
            ),
          })}
          parts={parts}
        />
      );
  }
}
