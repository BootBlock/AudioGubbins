/**
 * The editor of a group's emitter rules (ADR-0104): how a player of the group
 * selects among its members, how many voices it sounds and which it steals,
 * how long it waits between triggers, and how it attenuates with distance. A
 * distance filter a group already sets is kept as it is.
 */

import type { ReactNode } from 'react';

import { OptionSelect } from '@audiogubbins/design-system';
import {
  DEFAULT_EMITTER_RULES,
  type Attenuation,
  type EmitterRules,
  type SelectionRule,
  type VoiceStealing,
} from '@audiogubbins/game-audio';

import { policyValueArgument } from '../../commands/game-changes.js';
import { NumbersEditor, useDraft, type EditedValue, type EditorParts } from './editor-controls.js';

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

/** The numbers an emitter's rules are typed as, each starting from `from`'s. */
function emitterFields(from: EmitterRules) {
  const at = from.attenuation;
  return [
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
}

/** What the choices made and the numbers typed give, as the commands take it. */
function emitterValue(
  chosen: {
    readonly selection: string;
    readonly stealing: VoiceStealing;
    readonly attenuation: Attenuation['kind'];
    readonly from: EmitterRules;
  },
  [depth, limit, cooldown, ...distance]: readonly (number | undefined)[],
): EditedValue {
  const rule: SelectionRule | string =
    chosen.selection === 'avoid-recent'
      ? depth === undefined
        ? 'Type how many it never repeats.'
        : { kind: 'avoid-recent', depth }
      : { kind: 'uniform' };
  const attenuated = attenuationOf(chosen.attenuation, distance);
  if (typeof rule === 'string') return { refused: rule };
  if (typeof attenuated === 'string') return { refused: attenuated };
  if (limit === undefined || cooldown === undefined) {
    return { refused: 'Type a number in each field.' };
  }
  const rules: EmitterRules = {
    selection: rule,
    voices: { limit, stealing: chosen.stealing },
    cooldownMilliseconds: cooldown,
    attenuation: attenuated,
    ...(chosen.from.filter === undefined ? {} : { filter: chosen.from.filter }),
  };
  return { value: policyValueArgument('emitter', rules) };
}

/** How a player of the group selects, limits, steals, cools down and attenuates. */
export function EmitterEditor({
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
  return (
    <>
      <div className="ag-policy-edit">
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
      <NumbersEditor
        fields={emitterFields(from)}
        make={(numbers) => emitterValue({ selection, stealing, attenuation, from }, numbers)}
        parts={parts}
      />
    </>
  );
}
