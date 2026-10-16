/**
 * The Inspector's Game policy section (ADR-0101, REQ-GAME-120): for an asset
 * group or a member of one, every field's effective value, where it comes
 * from in words, what the source hides of the groups above it, and the
 * controls that set it here or reset it to what it inherits.
 *
 * It shows the game-audio package's resolution of the project state as it
 * stands (`game-policy-view.ts`) and changes it only through the game
 * commands, so an undo or another view shows here at once. A group sets any
 * field; a member overrides the fields a member may, and chooses whether its
 * rack is its group's processing; its tags are the region's own beside its
 * groups'.
 */

import { useId, useState, type ReactNode } from 'react';

import { Button } from '@audiogubbins/design-system';
import {
  POLICY_FIELDS,
  type EffectivePolicy,
  type GameAssetGroup,
  type GroupMember,
  type PolicyField,
  type PolicyValues,
  type Resolved,
  type ResolvedTag,
} from '@audiogubbins/game-audio';
import type { ProjectState } from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';

import { OVERRIDABLE_FIELDS, POLICY_FIELD_WORDS } from '../../commands/game-field-words.js';
import { memberArgument, memberName } from '../../commands/game-target.js';
import { chainWords } from '../../commands/rack-words.js';
import type { GamePolicyView } from '../../state/game-policy-view.js';
import { CommandButton } from '../command-button.js';
import { UNSET_MEANING, sourceWords, valueWords, type PolicySubject } from './game-words.js';
import { FieldEditor, type EditorParts, type FieldSetter } from './policy-editors.js';

/** What the section reads beside the subject: the state, its groups and the editors' parts. */
export interface PolicyParts extends Omit<EditorParts, 'setter' | 'project'> {
  readonly state: ProjectState;
  readonly view: GamePolicyView;
}

/** A field's name as a heading shows it. */
function fieldHeading(field: PolicyField): string {
  const words = POLICY_FIELD_WORDS[field];
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** What a resolved field shows: its value, its source, and what it hides. */
function ResolvedFacts<F extends PolicyField>({
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
function Changing<F extends PolicyField>({
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
function TagFacts({
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

/** One field of a group's policy, and its controls. */
function GroupField<F extends Exclude<PolicyField, 'tags'>>({
  field,
  group,
  resolved,
  parts,
}: {
  readonly field: F;
  readonly group: GameAssetGroup;
  readonly resolved: Resolved<PolicyValues[F]>;
  readonly parts: PolicyParts;
}): ReactNode {
  const heading = useId();
  const setter: FieldSetter = {
    id: 'game.set-policy',
    label: 'Set on this group',
    args: (edited) => ({ group: group.id, field, ...edited }),
  };
  const ownsIt = group.policy[field] !== undefined;
  return (
    <div role="group" aria-labelledby={heading} className="ag-inspector-row">
      <h4 className="ag-inspector-heading" id={heading}>
        {fieldHeading(field)}
      </h4>
      <ResolvedFacts
        field={field}
        resolved={resolved}
        subject={{ kind: 'group', group: group.id }}
        parts={parts}
      />
      <Changing
        field={field}
        initial={resolved.value}
        parts={parts}
        setter={setter}
        label={ownsIt ? 'Change…' : 'Set here…'}
      />
      {ownsIt && (
        <CommandButton
          id="game.unset-policy"
          label="Reset to inherited"
          commands={parts.commands}
          args={{ group: group.id, field }}
          compact
        />
      )}
    </div>
  );
}

/** Every field of an asset group's policy, and what its members inherit. */
export function GroupPolicySection({
  group,
  parts,
}: {
  readonly group: GameAssetGroup;
  readonly parts: PolicyParts;
}): ReactNode {
  const heading = useId();
  const policy = parts.view.group(group.id);
  const path = parts.view.pathOf(group.id).join('/');
  return (
    <section className="ag-inspector-section" aria-labelledby={heading}>
      <h3 className="ag-inspector-heading" id={heading}>
        {`Asset group: ${path}`}
      </h3>
      <p className="ag-panel-note">
        What its members inherit, field by field, unless one sets its own.
      </p>
      {POLICY_FIELDS.map((field) =>
        field === 'tags' ? (
          <div key={field} className="ag-inspector-row">
            <h4 className="ag-inspector-heading">Tags</h4>
            <TagFacts tags={policy.tags} parts={parts} />
            <Changing
              field="tags"
              initial={group.policy.tags}
              parts={parts}
              setter={{
                id: 'game.set-policy',
                label: 'Set on this group',
                args: (edited) => ({ group: group.id, field: 'tags', ...edited }),
              }}
              label="Change…"
            />
          </div>
        ) : (
          <GroupField
            key={field}
            field={field}
            group={group}
            resolved={policy.fields[field]}
            parts={parts}
          />
        ),
      )}
    </section>
  );
}

/** A member's processing: whether it inherits its group's or owns its rack, and the commands that change it. */
function MemberProcessing({
  member,
  policy,
  parts,
}: {
  readonly member: GroupMember;
  readonly policy: EffectivePolicy;
  readonly parts: PolicyParts;
}): ReactNode {
  const { processing } = policy;
  const { project } = parts.state;
  const rack =
    processing.rack === undefined ? undefined : project.effectChains.get(processing.rack);
  const heard = rack === undefined ? 'It has no rack.' : `Its rack runs ${chainWords(rack)}.`;
  const inherits = processing.membership === 'inherit';
  const args = { member: memberArgument(member) };
  return (
    <div role="group" aria-label="Processing" className="ag-inspector-row">
      <h4 className="ag-inspector-heading">Processing</h4>
      <p>
        {inherits
          ? `It inherits its group’s processing. ${heard}`
          : `It owns its processing. ${heard}`}
      </p>
      <ResolvedFacts
        field="processing"
        resolved={processing}
        subject={{ kind: 'member', member: member.kind }}
        parts={parts}
        {...(policy.group === undefined ? {} : { memberGroup: policy.group })}
      />
      <CommandButton
        id={inherits ? 'game.own-processing' : 'game.inherit-processing'}
        label={inherits ? 'Keep its own rack' : 'Reset to inherited'}
        commands={parts.commands}
        args={args}
        compact
      />
    </div>
  );
}

/** One field a member may override, and its controls. */
function MemberField<F extends Exclude<PolicyField, 'tags' | 'processing'>>({
  field,
  member,
  policy,
  resolved,
  parts,
}: {
  readonly field: F;
  readonly member: GroupMember;
  readonly policy: EffectivePolicy;
  readonly resolved: Resolved<PolicyValues[F]>;
  readonly parts: PolicyParts;
}): ReactNode {
  const heading = useId();
  const overridable = OVERRIDABLE_FIELDS.find((one) => one === field);
  const overridden = resolved.source.kind === 'override';
  return (
    <div role="group" aria-labelledby={heading} className="ag-inspector-row">
      <h4 className="ag-inspector-heading" id={heading}>
        {fieldHeading(field)}
      </h4>
      <ResolvedFacts
        field={field}
        resolved={resolved}
        subject={{ kind: 'member', member: member.kind }}
        parts={parts}
        {...(policy.group === undefined ? {} : { memberGroup: policy.group })}
      />
      {overridable === undefined ? (
        <p className="ag-panel-note">Set on its group: a member does not override it.</p>
      ) : (
        <>
          <Changing
            field={field}
            initial={resolved.value}
            parts={parts}
            setter={{
              id: 'game.set-override',
              label: 'Override on this member',
              args: (edited) => ({
                member: memberArgument(member),
                field: overridable,
                ...edited,
              }),
            }}
            label={overridden ? 'Change…' : 'Override…'}
          />
          {overridden && (
            <CommandButton
              id="game.reset-override"
              label="Reset to inherited"
              commands={parts.commands}
              args={{ member: memberArgument(member), field: overridable }}
              compact
            />
          )}
        </>
      )}
    </div>
  );
}

/** Every field of a member's effective policy, or that it is in no group. */
export function MemberPolicySection({
  member,
  parts,
}: {
  readonly member: GroupMember;
  readonly parts: PolicyParts;
}): ReactNode {
  const heading = useId();
  const policy = parts.view.member(member);
  const name = memberName(parts.state.project, member);
  if (policy.group === undefined) {
    return (
      <section className="ag-inspector-section" aria-labelledby={heading}>
        <h3 className="ag-inspector-heading" id={heading}>
          Game policy
        </h3>
        <p>{`${name} is in no asset group, so it inherits no policy.`}</p>
        <CommandButton
          id="game.assign-selection"
          label="Put it in the chosen group"
          commands={parts.commands}
          args={{ member: memberArgument(member) }}
          compact
        />
      </section>
    );
  }
  const overrides = Object.keys(parts.view.membershipOf(member)?.overrides ?? {}).length;
  return (
    <section className="ag-inspector-section" aria-labelledby={heading}>
      <h3 className="ag-inspector-heading" id={heading}>
        {`Game policy, in ${quoted(parts.view.pathOf(policy.group).join('/'))}`}
      </h3>
      <MemberProcessing member={member} policy={policy} parts={parts} />
      {POLICY_FIELDS.map((field) => {
        switch (field) {
          case 'processing':
            return null;
          case 'tags':
            return (
              <div key={field} className="ag-inspector-row">
                <h4 className="ag-inspector-heading">Tags</h4>
                <TagFacts tags={policy.tags} parts={parts} />
              </div>
            );
          default:
            return (
              <MemberField
                key={field}
                field={field}
                member={member}
                policy={policy}
                resolved={policy[field]}
                parts={parts}
              />
            );
        }
      })}
      {overrides > 0 && (
        <CommandButton
          id="game.reset-all-overrides"
          label="Reset everything to inherited"
          commands={parts.commands}
          args={{ member: memberArgument(member) }}
          compact
        />
      )}
      <CommandButton
        id="game.remove-from-group"
        label="Take out of the group"
        commands={parts.commands}
        args={{ member: memberArgument(member) }}
        compact
      />
    </section>
  );
}
