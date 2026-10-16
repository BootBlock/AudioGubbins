/**
 * Reading the game commands' arguments (ADR-0101): the group or member an
 * invocation names, a policy field and its value, how a member's processing
 * stands, its rack where it leaves its group's, and where a membership joins
 * the assignment order. A nested value is canonical JSON read by the project
 * format's reader for its shape (`invocation-arguments.ts`), so a value a
 * command accepts is one the document accepts.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainResult,
  type EffectChainId,
} from '@audiogubbins/domain';
import {
  POLICY_FIELDS,
  type GameAssetGroup,
  type GameAssetGroupId,
  type GameAudioState,
  type GroupMember,
  type MemberProcessing,
  type OverridableField,
  type PolicyField,
  type PolicyOverrides,
  type PolicyValues,
} from '@audiogubbins/game-audio';
import {
  readGroupMember,
  readPolicyField,
  readPolicyOverrides,
  type ProjectState,
} from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';

import { idArgument } from '../editing/editing-arguments.js';
import { jsonArgument, optionalTextArgument, readNested } from '../invocation-arguments.js';
import { chainToName } from '../processing/chain-naming.js';
import { FIELD_WORDS, groupWords, memberName } from './game-words.js';

function rejected(code: string, summary: string): DomainResult<never> {
  return fail(failure(code, FailureKind.Rejected, summary));
}

/** The group the argument `name` names. */
export function targetGroup(
  game: GameAudioState,
  invocation: CommandInvocation,
  name = 'group',
): DomainResult<GameAssetGroup> {
  const id = idArgument<'GameAssetGroupId'>(invocation, name);
  if (!id.ok) return id;
  const group = game.groups.get(id.value);
  return group === undefined
    ? rejected('game.group-unknown', 'The project has no group with that identifier.')
    : succeed(group);
}

/** The group identifier the argument `name` holds, or `undefined` where it is absent. */
export function optionalGroupId(
  invocation: CommandInvocation,
  name: string,
): DomainResult<GameAssetGroupId | undefined> {
  const given = invocation.arguments?.[name];
  return given === undefined || given === null
    ? succeed(undefined)
    : idArgument<'GameAssetGroupId'>(invocation, name);
}

/** A region or asset of the project, as the argument `member` names it, with its name. */
export interface TargetMember {
  readonly member: GroupMember;
  readonly name: string;
}

/** The region or asset of the project the argument `member` names. */
export function targetMember(
  state: ProjectState,
  invocation: CommandInvocation,
): DomainResult<TargetMember> {
  const value = jsonArgument(invocation, 'member');
  const member = value.ok ? readNested(readGroupMember, value.value, 'member') : value;
  if (!member.ok) return member;
  const name = memberName(state.project, member.value);
  return name === undefined
    ? rejected('game.member-unknown', `The project has no ${member.value.kind} by that identifier.`)
    : succeed({ member: member.value, name });
}

const FIELDS: ReadonlySet<string> = new Set(POLICY_FIELDS);

function isPolicyField(text: string): text is PolicyField {
  return FIELDS.has(text);
}

/** The policy field the argument `field` names. */
export function fieldArgument(invocation: CommandInvocation): DomainResult<PolicyField> {
  const text = optionalTextArgument(invocation, 'field');
  if (!text.ok) return text;
  if (text.value === undefined) {
    return rejected('argument.missing', 'The command needs the argument “field”.');
  }
  return isPolicyField(text.value)
    ? succeed(text.value)
    : rejected('game.field-unknown', `A policy's fields are ${POLICY_FIELDS.join(', ')}.`);
}

/**
 * Why a member sets none of the fields it may not set over its group: typed
 * over the fields `OverridableField` leaves out, so a field that joins or
 * leaves it fails to compile here.
 */
const NOT_OVERRIDDEN: Readonly<Record<Exclude<PolicyField, OverridableField>, string>> = {
  processing: 'its rack is its group’s processing while it inherits, and its own once it owns it',
  tags: 'a group’s tags add to its own and replace none',
  emitter: 'how the group is played belongs to whoever plays it, not to one sound in it',
};

function isOverridable(field: PolicyField): field is OverridableField {
  return !(field in NOT_OVERRIDDEN);
}

/**
 * The field the argument `field` names, where a member of `group` may set it
 * over the group; refused naming the group whose setting it is where it may
 * not.
 */
export function overridableFieldArgument(
  invocation: CommandInvocation,
  game: GameAudioState,
  target: TargetMember,
  group: GameAssetGroupId,
): DomainResult<OverridableField> {
  const field = fieldArgument(invocation);
  if (!field.ok) return field;
  const name = field.value;
  if (isOverridable(name)) return succeed(name);
  return rejected(
    'game.field-not-overridable',
    `${quoted(target.name)} sets no ${FIELD_WORDS[name]} over its group, since ${NOT_OVERRIDDEN[name]}: it is set on ${groupWords(game, group)}.`,
  );
}

/** The value of `field` the argument `value` holds, or `undefined` where it is absent: unset. */
export function policyValueArgument<F extends PolicyField>(
  invocation: CommandInvocation,
  field: F,
): DomainResult<PolicyValues[F] | undefined> {
  const given = invocation.arguments?.['value'];
  if (given === undefined || given === null) return succeed(undefined);
  const value = jsonArgument(invocation, 'value');
  return value.ok ? readNested(readPolicyField(field), value.value, 'value') : value;
}

const PROCESSINGS: ReadonlySet<string> = new Set<MemberProcessing>(['inherit', 'own']);

function isProcessing(text: string): text is MemberProcessing {
  return PROCESSINGS.has(text);
}

/** How the argument `processing` says a member's processing stands, or `undefined` where it is absent. */
export function optionalProcessingArgument(
  invocation: CommandInvocation,
): DomainResult<MemberProcessing | undefined> {
  const text = optionalTextArgument(invocation, 'processing');
  if (!text.ok) return text;
  if (text.value === undefined) return succeed(undefined);
  return isProcessing(text.value)
    ? succeed(text.value)
    : rejected('game.processing-invalid', 'A member inherits its processing or owns its own.');
}

/** How the argument `processing` says a member's processing stands. */
export function processingArgument(invocation: CommandInvocation): DomainResult<MemberProcessing> {
  const processing = optionalProcessingArgument(invocation);
  if (!processing.ok) return processing;
  return processing.value === undefined
    ? rejected('argument.missing', 'The command needs the argument “processing”.')
    : succeed(processing.value);
}

/** The overrides the argument `overrides` holds, or none where it is absent. */
export function overridesArgument(invocation: CommandInvocation): DomainResult<PolicyOverrides> {
  const given = invocation.arguments?.['overrides'];
  if (given === undefined || given === null) return succeed({});
  const value = jsonArgument(invocation, 'overrides');
  return value.ok ? readNested(readPolicyOverrides, value.value, 'overrides') : value;
}

/**
 * The place in the assignment order the argument `position` puts a membership,
 * among `others` other memberships, or `undefined` where it is absent.
 */
export function positionArgument(
  invocation: CommandInvocation,
  others: number,
): DomainResult<number | undefined> {
  const given = invocation.arguments?.['position'];
  if (given === undefined || given === null) return succeed(undefined);
  return typeof given === 'number' && Number.isSafeInteger(given) && given >= 0 && given <= others
    ? succeed(given)
    : rejected(
        'game.position-invalid',
        `A membership's place is a whole number from 0 to ${String(others)}.`,
      );
}

/** What a member's rack becomes as it owns its processing or leaves its group. */
export type RackChange =
  /** It keeps the rack it has. */
  | { readonly kind: 'keep' }
  /** It is given `rack`, or none, in `state`, which holds the chain where it was given whole. */
  | {
      readonly kind: 'set';
      readonly rack: EffectChainId | undefined;
      readonly state: ProjectState;
    };

/**
 * The rack the arguments give: `rack: "none"` takes it away, `chainId` or a
 * whole `chain` names it (`chain-naming.ts`), and none of them keeps it.
 */
export function rackArgument(
  state: ProjectState,
  invocation: CommandInvocation,
): DomainResult<RackChange> {
  const none = optionalTextArgument(invocation, 'rack');
  if (!none.ok) return none;
  const named = chainToName(state, invocation);
  if (!named.ok) return named;
  if (none.value !== undefined) {
    if (none.value !== 'none') {
      return rejected('game.rack-invalid', 'A rack is taken away by “none”, or named as a chain.');
    }
    return named.value === undefined
      ? succeed({ kind: 'set', rack: undefined, state })
      : rejected('chain.named-twice', 'The command takes the rack away, or names one, not both.');
  }
  return named.value === undefined
    ? succeed({ kind: 'keep' })
    : succeed({ kind: 'set', rack: named.value.chain, state: named.value.state });
}

/** A membership a member joins with, as its arguments give it. */
export interface Joining {
  readonly group: GameAssetGroupId;
  readonly processing: MemberProcessing;
  readonly overrides: PolicyOverrides;
  readonly position: number | undefined;
}

/**
 * The membership the arguments `group`, `processing`, `overrides` and
 * `position` give, among `others` other memberships, or `undefined` where
 * none of them is given.
 */
export function readJoining(
  invocation: CommandInvocation,
  others: number,
): DomainResult<Joining | undefined> {
  const group = optionalGroupId(invocation, 'group');
  if (!group.ok) return group;
  const processing = optionalProcessingArgument(invocation);
  if (!processing.ok) return processing;
  const overrides = overridesArgument(invocation);
  if (!overrides.ok) return overrides;
  const position = positionArgument(invocation, others);
  if (!position.ok) return position;
  if (group.value === undefined || processing.value === undefined) {
    const partial =
      group.value !== undefined ||
      processing.value !== undefined ||
      invocation.arguments?.['overrides'] !== undefined ||
      position.value !== undefined;
    return partial
      ? rejected('game.membership-partial', 'A membership names its group and its processing.')
      : succeed(undefined);
  }
  return succeed({
    group: group.value,
    processing: processing.value,
    overrides: overrides.value,
    position: position.value,
  });
}
