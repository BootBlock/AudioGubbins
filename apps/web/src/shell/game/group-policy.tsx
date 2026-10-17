/**
 * An asset group's policy in the Inspector (ADR-0101): the group as the
 * Inspector's subject, then every field it sets or inherits, where each value
 * comes from, what it hides of the groups above it, and the controls that set
 * it on the group or reset it to what it inherits, each a game command; and
 * its tags with where each comes from.
 */

import { useId, type ReactNode } from 'react';

import { ButtonTone, Hint, Icon } from '@audiogubbins/design-system';
import {
  POLICY_FIELDS,
  type GameAssetGroup,
  type PolicyField,
  type PolicyValues,
  type Resolved,
} from '@audiogubbins/game-audio';

import { CommandButton } from '../command-button.js';
import {
  PolicyRow,
  ResolvedFacts,
  SourceOf,
  TagFacts,
  fieldHeading,
  type PolicyParts,
} from './policy-facts.js';

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
  const subject = { kind: 'group', group: group.id } as const;
  const ownsIt = group.policy[field] !== undefined;
  return (
    <PolicyRow
      name={fieldHeading(field)}
      source={<SourceOf resolved={resolved} subject={subject} parts={parts} />}
      change={{
        field,
        initial: resolved.value,
        setter: {
          id: 'game.set-policy',
          label: 'Set on this group',
          args: (edited) => ({ group: group.id, field, ...edited }),
        },
        label: ownsIt ? 'Change…' : 'Set here…',
      }}
      actions={
        ownsIt && (
          <CommandButton
            id="game.unset-policy"
            label="Reset to inherited"
            commands={parts.commands}
            args={{ group: group.id, field }}
            tone={ButtonTone.Quiet}
            compact
          />
        )
      }
      parts={parts}
    >
      <ResolvedFacts field={field} resolved={resolved} parts={parts} />
    </PolicyRow>
  );
}

/** A group's tags, each with where it comes from, and the control that sets its own. */
function GroupTags({
  group,
  parts,
}: {
  readonly group: GameAssetGroup;
  readonly parts: PolicyParts;
}): ReactNode {
  return (
    <PolicyRow
      name="Tags"
      change={{
        field: 'tags',
        initial: group.policy.tags,
        setter: {
          id: 'game.set-policy',
          label: 'Set on this group',
          args: (edited) => ({ group: group.id, field: 'tags', ...edited }),
        },
        label: 'Change…',
      }}
      parts={parts}
    >
      <TagFacts tags={parts.view.group(group.id).tags} parts={parts} />
    </PolicyRow>
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
    <section className="ag-policy" aria-labelledby={heading}>
      <div className="ag-policy-subject">
        <span className="ag-policy-tile" aria-hidden="true">
          <Icon name="group" />
        </span>
        <div className="ag-policy-subject-text">
          <span className="ag-policy-subject-title">{group.name}</span>
          <h3 className="ag-policy-scope" id={heading}>
            {`Asset group: ${path}`}
          </h3>
        </div>
        <Hint label="About a group's policy">
          What its members inherit, field by field, unless one sets its own.
        </Hint>
      </div>
      <div className="ag-policy-rows">
        {POLICY_FIELDS.map((field) =>
          field === 'tags' ? (
            <GroupTags key={field} group={group} parts={parts} />
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
      </div>
    </section>
  );
}
