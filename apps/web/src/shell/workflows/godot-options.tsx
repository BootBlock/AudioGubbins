/**
 * Export for Godot's options (ADR-0105): what one-shots export as, with what
 * Godot 4 does with each format's loops, and the naming and folder every
 * group is given.
 */

import type { ReactNode } from 'react';

import { withChosen, type DraftFields, type GodotDraft } from '../../state/workflow-drafts.js';
import { NAMING_HELP, type DraftChange, type Setter } from './option-rows.js';
import { SourcedChoice, SourcedText } from './workflow-fields.js';
import { GODOT_FORMATS, GODOT_LOOPS } from './workflow-words.js';

export function GodotOptions({
  fields,
  onDraft,
}: {
  readonly fields: DraftFields<GodotDraft>;
  readonly onDraft: DraftChange;
}): ReactNode {
  const set: Setter<GodotDraft> = (field, value) => {
    onDraft((now) =>
      now.key === 'export-for-godot'
        ? { key: now.key, fields: withChosen(now.fields, field, value) }
        : now,
    );
  };
  return (
    <>
      <SourcedChoice
        label="One-shots export as"
        field={fields.format}
        choices={GODOT_FORMATS}
        onChoose={(value) => {
          set('format', value);
        }}
      />
      <p className="ag-panel-note">{GODOT_LOOPS}</p>
      <SourcedText
        label="Naming"
        description={NAMING_HELP}
        field={fields.naming}
        onText={(value) => {
          set('naming', value);
        }}
      />
      <SourcedText
        label="Folder"
        description="The folders every group’s own folder is placed in, with a / between them, inside the folder you export to."
        field={fields.destinationRoot}
        onText={(value) => {
          set('destinationRoot', value);
        }}
      />
    </>
  );
}
