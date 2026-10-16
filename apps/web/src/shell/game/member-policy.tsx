/**
 * A member's game policy in the Inspector (ADR-0101): the asset group the
 * region or asset shown is in, whether its rack is its group's processing or
 * its own and what a reset would give it, every other field it resolves with
 * where each value comes from and what an override hides, and the controls
 * that override a field, reset one or all to inherited, or take it out of its
 * group, each a game command; or, in no group, the command that puts it in
 * the one chosen.
 */

import { useId, type ReactNode } from 'react';

import {
  POLICY_FIELDS,
  memberKey,
  inheritedProcessing,
  type EffectivePolicy,
  type GroupMember,
  type PolicyField,
  type PolicyValues,
  type Resolved,
} from '@audiogubbins/game-audio';
import type { ProjectState } from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';

import { OVERRIDABLE_FIELDS } from '../../commands/game-field-words.js';
import { memberName } from '../../commands/game-target.js';
import { chainWords } from '../../commands/rack-words.js';
import { CommandButton } from '../command-button.js';
import {
  Changing,
  ResolvedFacts,
  TagFacts,
  fieldHeading,
  type PolicyParts,
} from './policy-facts.js';
import { usePolicyParts, type PolicySources } from './policy-parts.js';

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
  const args = { member: memberKey(member) };
  // What a reset to inherited would give it: the rack the package says an
  // inheriting member has, never the interface's own reading of the policy.
  const wouldInherit = inheritedProcessing(parts.view.game, member);
  const inherited = wouldInherit === undefined ? undefined : project.effectChains.get(wouldInherit);
  const reset =
    inherited === undefined
      ? 'Inheriting, it would have no rack.'
      : `Inheriting, its rack would run ${chainWords(inherited)}.`;
  return (
    <div role="group" aria-label="Processing" className="ag-inspector-row">
      <h4 className="ag-inspector-heading">Processing</h4>
      <p>
        {inherits
          ? `It inherits its group’s processing. ${heard}`
          : `It owns its processing. ${heard} ${reset}`}
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
                member: memberKey(member),
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
              args={{ member: memberKey(member), field: overridable }}
              compact
            />
          )}
        </>
      )}
    </div>
  );
}

/** One row of a member's policy: a field it may override, or its tags; its processing has its own. */
function MemberFieldRow({
  field,
  member,
  policy,
  parts,
}: {
  readonly field: PolicyField;
  readonly member: GroupMember;
  readonly policy: EffectivePolicy;
  readonly parts: PolicyParts;
}): ReactNode {
  switch (field) {
    case 'processing':
      return null;
    case 'tags':
      return (
        <div className="ag-inspector-row">
          <h4 className="ag-inspector-heading">Tags</h4>
          <TagFacts tags={policy.tags} parts={parts} />
        </div>
      );
    default:
      return (
        <MemberField
          field={field}
          member={member}
          policy={policy}
          resolved={policy[field]}
          parts={parts}
        />
      );
  }
}

/** A region or asset in no group: that it inherits nothing, and the command that puts it in one. */
function NotInGroup({
  member,
  parts,
}: {
  readonly member: GroupMember;
  readonly parts: PolicyParts;
}): ReactNode {
  const heading = useId();
  const name = memberName(parts.state.project, member);
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
        args={{ member: memberKey(member) }}
        compact
      />
    </section>
  );
}

/** Every field of a member's effective policy, or that it is in no group. */
function MemberPolicySection({
  member,
  parts,
}: {
  readonly member: GroupMember;
  readonly parts: PolicyParts;
}): ReactNode {
  const heading = useId();
  const policy = parts.view.member(member);
  if (policy.group === undefined) return <NotInGroup member={member} parts={parts} />;
  const overrides = Object.keys(parts.view.membershipOf(member)?.overrides ?? {}).length;
  return (
    <section className="ag-inspector-section" aria-labelledby={heading}>
      <h3 className="ag-inspector-heading" id={heading}>
        {`Game policy, in ${quoted(parts.view.pathOf(policy.group).join('/'))}`}
      </h3>
      <MemberProcessing member={member} policy={policy} parts={parts} />
      {POLICY_FIELDS.map((field) => (
        <MemberFieldRow key={field} field={field} member={member} policy={policy} parts={parts} />
      ))}
      {overrides > 0 && (
        <CommandButton
          id="game.reset-all-overrides"
          label="Reset everything to inherited"
          commands={parts.commands}
          args={{ member: memberKey(member) }}
          compact
        />
      )}
      <CommandButton
        id="game.remove-from-group"
        label="Take out of the group"
        commands={parts.commands}
        args={{ member: memberKey(member) }}
        compact
      />
    </section>
  );
}

/** The game policy of `member` in `state`, read from the stores `sources` names. */
export function MemberPolicy({
  member,
  state,
  sources,
}: {
  readonly member: GroupMember;
  readonly state: ProjectState;
  readonly sources: PolicySources;
}): ReactNode {
  return <MemberPolicySection member={member} parts={usePolicyParts(sources, state)} />;
}
