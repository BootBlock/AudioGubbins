/**
 * An asset group's policy in the Inspector (ADR-0101): every field it sets or
 * inherits, where each value comes from, what it hides of the groups above it,
 * and the controls that set it on the group or reset it to what it inherits,
 * each a game command; and its tags with where each comes from.
 */

import { useId, type ReactNode } from 'react';

import {
  POLICY_FIELDS,
  type GameAssetGroup,
  type PolicyField,
  type PolicyValues,
  type Resolved,
} from '@audiogubbins/game-audio';

import { CommandButton } from '../command-button.js';
import type { FieldSetter } from './editor-controls.js';
import {
  Changing,
  ResolvedFacts,
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
