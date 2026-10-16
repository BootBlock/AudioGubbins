/**
 * What the Inspector's game policy shows of a field (ADR-0101, REQ-GAME-120):
 * its effective value, where it comes from in words, what the source hides of
 * the groups above it, the control that shows the field's editor, and the
 * tags with every source that gives each; shared by a group's policy
 * (`group-policy.tsx`) and a member's (`member-policy.tsx`).
 *
 * It shows the game-audio package's resolution of the project state as it
 * stands (`game-policy-view.ts`) and changes it only through the game
 * commands, so an undo or another view shows here at once.
 */

import { useId, useState, type ReactNode } from 'react';

import { Button } from '@audiogubbins/design-system';
import type {
  GameAssetGroup,
  PolicyField,
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

/** What a resolved field shows: its value, its source, and what it hides. */
export function ResolvedFacts<F extends PolicyField>({
  field,
  resolved,
  subject,
  parts,
  memberGroup,
}: {
  readonly field: F;
  readonly resolved: Resolved<PolicyValues[F]>;
  readonly subject: PolicySubject;
  readonly parts: PolicyParts;
  readonly memberGroup?: GameAssetGroup['id'];
}): ReactNode {
  const { project } = parts.state;
  const { value } = resolved;
  const source = sourceWords(resolved.source, subject, parts.view, memberGroup);
  return (
    <>
      <p>
        {value === undefined
          ? `${source}. ${UNSET_MEANING[field]}`
          : `${valueWords(project, field, value)}. ${source}.`}
      </p>
      {resolved.shadowed.length > 0 && (
        <ul aria-label={`What the ${POLICY_FIELD_WORDS[field]} here hides`}>
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

/** A control that shows a field's editor, and the editor while it is shown. */
export function Changing<F extends PolicyField>({
  field,
  initial,
  parts,
  setter,
  label,
}: {
  readonly field: F;
  readonly initial: PolicyValues[F] | undefined;
  readonly parts: PolicyParts;
  readonly setter: FieldSetter;
  readonly label: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const editor = useId();
  return (
    <>
      <Button
        compact
        aria-expanded={open}
        aria-controls={editor}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {label}
      </Button>
      <div id={editor} hidden={!open}>
        {open && (
          <FieldEditor
            field={field}
            initial={initial}
            parts={{ ...parts, project: parts.state.project, setter }}
          />
        )}
      </div>
    </>
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
  if (tags.length === 0) return <p>No tags.</p>;
  return (
    <ul>
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
