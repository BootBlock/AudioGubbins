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

import { OptionSelect } from '@audiogubbins/design-system';
import {
  DEFAULT_VOICE_VARIATION,
  busName,
  destinationPath,
  namingTemplate,
  type LoudnessTarget,
  type PolicyField,
  type PolicyValues,
  type VoiceVariation,
} from '@audiogubbins/game-audio';

import { policyValueArgument } from '../../commands/game-changes.js';
import { chainWords } from '../../commands/rack-words.js';
import {
  NumbersEditor,
  SetButton,
  TextEditor,
  made,
  useDraft,
  type EditedValue,
  type EditorParts,
} from './editor-controls.js';
import { EmitterEditor } from './emitter-editor.js';

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

/** A loudness target typed: its integrated loudness, its tolerance and any true-peak ceiling. */
function LoudnessEditor({
  initial,
  parts,
}: {
  readonly initial: LoudnessTarget | undefined;
  readonly parts: EditorParts;
}): ReactNode {
  const ceiling = initial?.truePeakCeilingDbtp;
  return (
    <NumbersEditor
      fields={[
        { label: 'Integrated loudness in LUFS', initial: String(initial?.integratedLufs ?? -16) },
        { label: 'Tolerance in LU', initial: String(initial?.toleranceLu ?? 1) },
        {
          label: 'True-peak ceiling in dBTP, if any',
          initial: ceiling === undefined ? '' : String(ceiling),
          optional: true,
        },
      ]}
      make={([integratedLufs = 0, toleranceLu = 0, peak]) => ({
        value: policyValueArgument('loudness', {
          integratedLufs,
          toleranceLu,
          ...(peak === undefined ? {} : { truePeakCeilingDbtp: peak }),
        }),
      })}
      parts={parts}
    />
  );
}

/** How each voice varies, typed: its pitch and gain ranges and how far in it may start. */
function VariationEditor({
  initial,
  parts,
}: {
  readonly initial: VoiceVariation | undefined;
  readonly parts: EditorParts;
}): ReactNode {
  const from = initial ?? DEFAULT_VOICE_VARIATION;
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

/** The tags typed, separated by commas, as the commands take them. */
function tagsValue(typed: string): EditedValue {
  const tags = typed
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
  return { value: policyValueArgument('tags', tags) };
}

/** The editor of a field typed as text, starting from its value now. */
function TextFieldEditor({
  field,
  values,
  parts,
}: {
  readonly field: 'naming' | 'destination' | 'bus' | 'tags';
  readonly values: Partial<PolicyValues>;
  readonly parts: EditorParts;
}): ReactNode {
  switch (field) {
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
          make={tagsValue}
          parts={parts}
        />
      );
  }
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
    case 'loudness':
      return <LoudnessEditor initial={values.loudness} parts={parts} />;
    case 'variation':
      return <VariationEditor initial={values.variation} parts={parts} />;
    case 'naming':
    case 'destination':
    case 'bus':
    case 'tags':
      return <TextFieldEditor field={field} values={values} parts={parts} />;
  }
}
