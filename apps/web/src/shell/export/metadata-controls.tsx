/**
 * The metadata an exported file carries (ADR-0092, ADR-0093): the policy, and
 * the fields the person sets or removes over it, in order. Whether the edits
 * suit the policy is the package's to say.
 */

import type { ReactNode } from 'react';

import { Button, TextField } from '@audiogubbins/design-system';
import type { MetadataTextKey } from '@audiogubbins/codecs';
import type { MetadataEdit, MetadataPolicy } from '@audiogubbins/import-export';

import { METADATA_FIELD_NAMES, METADATA_POLICY_WORDS } from './export-words.js';
import { ChoiceField, SettingGroup, type Choice, type SettingsProps } from './setting-fields.js';

const POLICIES: readonly Choice<MetadataPolicy>[] = [
  { value: 'full', label: 'Full' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'none', label: 'None' },
];

const FIELDS: readonly Choice<MetadataTextKey>[] = (
  [
    'title',
    'artist',
    'album',
    'albumArtist',
    'trackNumber',
    'trackTotal',
    'discNumber',
    'discTotal',
    'date',
    'genre',
    'comment',
    'copyright',
    'encoder',
    'isrc',
  ] as const
).map((value) => ({ value, label: METADATA_FIELD_NAMES[value] }));

const EDIT_KINDS: readonly Choice<MetadataEdit['kind']>[] = [
  { value: 'set', label: 'Set to' },
  { value: 'remove', label: 'Remove' },
];

/** The first field no edit names yet, to add an edit of. */
function freeField(edits: readonly MetadataEdit[]): MetadataTextKey | undefined {
  return FIELDS.find((field) => !edits.some((edit) => edit.key === field.value))?.value;
}

/** One edit of a field: which field, whether it is set or removed, and its text where it is set. */
function EditRow({
  edit,
  onEdit,
  onForget,
}: {
  readonly edit: MetadataEdit;
  readonly onEdit: (edit: MetadataEdit) => void;
  readonly onForget: () => void;
}): ReactNode {
  const name = METADATA_FIELD_NAMES[edit.key];
  return (
    <li>
      <ChoiceField
        label="Field"
        value={edit.key}
        choices={FIELDS}
        onChoose={(key) => {
          onEdit({ ...edit, key });
        }}
      />
      <ChoiceField
        label={`What to do with ${name}`}
        value={edit.kind}
        choices={EDIT_KINDS}
        onChoose={(kind) => {
          onEdit(kind === 'set' ? { kind, key: edit.key, value: '' } : { kind, key: edit.key });
        }}
      />
      {edit.kind === 'set' && (
        <TextField
          label={`${name} text`}
          value={edit.value}
          onValueChange={(value) => {
            onEdit({ ...edit, value });
          }}
        />
      )}
      <Button compact onClick={onForget}>
        {`Forget the edit of ${name}`}
      </Button>
    </li>
  );
}

/** The metadata's controls. */
export function MetadataControls({ settings, onSettings }: SettingsProps): ReactNode {
  const { metadata } = settings;
  const setEdits = (edits: readonly MetadataEdit[]): void => {
    onSettings({ ...settings, metadata: { ...metadata, edits } });
  };
  const free = freeField(metadata.edits);
  return (
    <SettingGroup title="Metadata">
      <ChoiceField
        label="Carry"
        value={metadata.policy}
        choices={POLICIES}
        onChoose={(policy) => {
          onSettings({ ...settings, metadata: { ...metadata, policy } });
        }}
      />
      <p className="ag-dialogue-note">{`${METADATA_POLICY_WORDS[metadata.policy]}.`}</p>
      <ul className="ag-export-metadata-edits" aria-label="Metadata fields set or removed">
        {metadata.edits.map((edit, index) => (
          <EditRow
            key={edit.key}
            edit={edit}
            onEdit={(changed) => {
              setEdits(metadata.edits.with(index, changed));
            }}
            onForget={() => {
              setEdits(metadata.edits.filter((_, at) => at !== index));
            }}
          />
        ))}
      </ul>
      {free !== undefined && (
        <Button
          compact
          onClick={() => {
            setEdits([...metadata.edits, { kind: 'set', key: free, value: '' }]);
          }}
        >
          Set or remove a field…
        </Button>
      )}
    </SettingGroup>
  );
}
