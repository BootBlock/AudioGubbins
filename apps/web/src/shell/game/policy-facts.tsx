/**
 * What the Inspector's game policy shows of a field (ADR-0101, REQ-GAME-120):
 * its effective value, a chip saying where it comes from, what the source
 * hides of the groups above it, the control that shows the field's editor, and
 * the tags with every source that gives each; shared by a group's policy
 * (`group-policy.tsx`) and a member's (`member-policy.tsx`).
 *
 * Each field is one row of the design language's policy (section 10,
 * "Property grids"): its name, its source chip and its actions on one line,
 * its value under them, and, while its editor is shown, the row drawn as a
 * card holding the editor.
 *
 * It shows the game-audio package's resolution of the project state as it
 * stands (`game-policy-view.ts`) and changes it only through the game
 * commands, so an undo or another view shows here at once.
 */

import { useId, useState, type ReactNode } from 'react';

import { Button, SourceChip, TemplateText, ValueSource } from '@audiogubbins/design-system';
import type {
  GameAssetGroup,
  PolicyField,
  PolicySource,
  PolicyValues,
  Resolved,
  ResolvedTag,
} from '@audiogubbins/game-audio';
import type { ProjectState } from '@audiogubbins/project-format';

import { POLICY_FIELD_WORDS } from '../../commands/game-field-words.js';
import type { GamePolicyView } from '../../state/game-policy-view.js';
import type { EditorParts, FieldSetter } from './editor-controls.js';
import { UNSET_MEANING, sourceWords, valueWords, type PolicySubject } from './game-words.js';
import { FieldEditor } from './policy-editors.js';

/** What the section reads beside the subject: the state, its groups and the editors' parts. */
export interface PolicyParts extends Omit<EditorParts, 'setter' | 'project'> {
  readonly state: ProjectState;
  readonly view: GamePolicyView;
}

/** A field's name as a heading shows it. */
export function fieldHeading(field: PolicyField): string {
  const words = POLICY_FIELD_WORDS[field];
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/**
 * How the chip draws where a value comes from: set on the subject itself, or
 * on a member's own group, or overridden on the member, is set; a group above
 * is inherited; nowhere is unset.
 */
function sourceKind(
  source: PolicySource,
  subject: PolicySubject,
  memberGroup: GameAssetGroup['id'] | undefined,
): ValueSource {
  switch (source.kind) {
    case 'unset':
      return ValueSource.Unset;
    case 'override':
      return ValueSource.Set;
    case 'group': {
      const own = subject.kind === 'group' ? subject.group : memberGroup;
      return source.group === own ? ValueSource.Set : ValueSource.Inherited;
    }
  }
}

/** The chip saying where a resolved field's value comes from. */
export function SourceOf({
  resolved,
  subject,
  parts,
  memberGroup,
}: {
  readonly resolved: Resolved<unknown>;
  readonly subject: PolicySubject;
  readonly parts: PolicyParts;
  readonly memberGroup?: GameAssetGroup['id'];
}): ReactNode {
  return (
    <SourceChip source={sourceKind(resolved.source, subject, memberGroup)}>
      {sourceWords(resolved.source, subject, parts.view, memberGroup)}
    </SourceChip>
  );
}

/**
 * A field's value as a person reads it; a naming template drawn with its
 * tokens highlighted, between the quotes every template value is shown in.
 */
function ValueText<F extends PolicyField>({
  field,
  value,
  parts,
}: {
  readonly field: F;
  readonly value: PolicyValues[F];
  readonly parts: PolicyParts;
}): ReactNode {
  const values: Partial<PolicyValues> = { [field]: value };
  if (values.naming !== undefined) {
    return (
      <>
        “<TemplateText text={values.naming.source} />”
      </>
    );
  }
  return valueWords(parts.state.project, field, value);
}

/** What a resolved field shows under its name: its value, or what its being unset means, and what it hides. */
export function ResolvedFacts<F extends PolicyField>({
  field,
  resolved,
  parts,
}: {
  readonly field: F;
  readonly resolved: Resolved<PolicyValues[F]>;
  readonly parts: PolicyParts;
}): ReactNode {
  const { project } = parts.state;
  const { value } = resolved;
  return (
    <>
      <p className="ag-policy-value" data-ag-unset={value === undefined ? '' : undefined}>
        {value === undefined ? (
          UNSET_MEANING[field]
        ) : (
          <ValueText field={field} value={value} parts={parts} />
        )}
      </p>
      {resolved.shadowed.length > 0 && (
        <ul
          className="ag-policy-hidden"
          aria-label={`What the ${POLICY_FIELD_WORDS[field]} here hides`}
        >
          {resolved.shadowed.map((hidden) => (
            <li key={hidden.group}>
              {`It hides ${valueWords(project, field, hidden.value)}, set on ${parts.view.pathOf(hidden.group).join('/')}.`}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** The editor a row shows on request: its field, the value it starts from, and what sets it. */
export interface RowChange<F extends PolicyField> {
  readonly field: F;
  readonly initial: PolicyValues[F] | undefined;
  readonly setter: FieldSetter;
  /** The words of the control that shows the editor. */
  readonly label: string;
}

/**
 * One row of a policy: the field's name, where its value comes from, its
 * actions, and what it shows; with the control that shows its editor, the row
 * becoming a card holding the editor while it is shown.
 */
export function PolicyRow<F extends PolicyField>({
  name,
  source,
  change,
  actions,
  parts,
  label,
  children,
}: {
  /** The field's name, its heading. */
  readonly name: string;

  /** The chip saying where its value comes from, where it has one. */
  readonly source?: ReactNode;

  /** The editor shown on request, where the field can be changed here. */
  readonly change?: RowChange<F>;

  /** Its other actions, after the control that shows the editor. */
  readonly actions?: ReactNode;

  readonly parts: PolicyParts;

  /** The row's accessible name, where its heading does not name it. */
  readonly label?: string;

  /** What it shows under its name. */
  readonly children: ReactNode;
}): ReactNode {
  const heading = useId();
  const editor = useId();
  const [open, setOpen] = useState(false);
  return (
    <div
      role="group"
      {...(label === undefined ? { 'aria-labelledby': heading } : { 'aria-label': label })}
      className="ag-policy-row"
      data-ag-open={open ? '' : undefined}
    >
      <h4 className="ag-policy-name" id={heading}>
        {name}
      </h4>
      <span className="ag-policy-source">{source}</span>
      <span className="ag-policy-actions">
        {change !== undefined && (
          <Button
            compact
            aria-expanded={open}
            aria-controls={editor}
            onClick={() => {
              setOpen(!open);
            }}
          >
            {change.label}
          </Button>
        )}
        {actions}
      </span>
      <div className="ag-policy-facts">{children}</div>
      {change !== undefined && (
        <div id={editor} className="ag-policy-editor" hidden={!open}>
          {open && (
            <FieldEditor
              field={change.field}
              initial={change.initial}
              parts={{ ...parts, project: parts.state.project, setter: change.setter }}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** The tags a member or group has, each with where it comes from. */
export function TagFacts({
  tags,
  parts,
}: {
  readonly tags: readonly ResolvedTag[];
  readonly parts: PolicyParts;
}): ReactNode {
  if (tags.length === 0) return <p className="ag-policy-value">No tags.</p>;
  return (
    <ul className="ag-policy-value ag-policy-tags">
      {tags.map(({ tag, from }) => (
        <li key={tag}>
          {`${tag}: from ${from
            .map((one) =>
              one.kind === 'member' ? 'its own tags' : parts.view.pathOf(one.group).join('/'),
            )
            .join(', ')}`}
        </li>
      ))}
    </ul>
  );
}
