/**
 * Writing and reading a project's game-audio state (`ProjectState.gameAudio`,
 * ADR-0106): its asset groups with their policy, and its memberships with
 * their processing and overrides, as the document member `gameAudio` and the
 * tree's `project/game-audio.json` (REQ-EXEC-136.12).
 *
 * ```
 * { "groups": [ { "id", "name", "parent"?, "policy": { <field>: <value>, ... } } ],
 *   "memberships": [ { "member": { "kind": "region", "region" } | { "kind": "asset", "asset" },
 *                      "group", "processing": "inherit" | "own", "overrides": { ... } } ] }
 * ```
 *
 * The writer is canonical: groups sorted by identifier, which says nothing of
 * them, and memberships in assignment order, which is what a group's members
 * are chosen and numbered in; a policy writes the fields it sets and nothing
 * else (`game-policy-json.ts`). The reader holds every member to its shape and
 * every value to its field's, refusing a group twice, a member it does not
 * know, and a state that holds nothing, which the project keeps by having no
 * member at all (`withGameAudio`), so one state is written one way. Whether
 * the forest, the references and the ranges are ones the project can hold is
 * `validateGameAudioState`'s, which the project document's reader runs once
 * the project is read, through {@link validatedGameAudio}: the same rules a
 * game command's result is held to.
 *
 * Its members are an object's, so a member a later phase adds, such as the
 * preview's scenarios, is one more member read and written beside these.
 */

import type { Project } from '@audiogubbins/domain';
import {
  POLICY_FIELDS,
  memberKey,
  validateGameAudioState,
  type GameAssetGroup,
  type GameAudioState,
  type GroupMember,
  type GroupMembership,
  type InheritedPolicy,
  type OverridableField,
  type PolicyField,
  type PolicyOverrides,
  type PolicyValues,
} from '@audiogubbins/game-audio';

import type { JsonObject, JsonValue } from './canonical-json.js';
import {
  entitiesOf,
  listConverter,
  objectOf,
  optional,
  pathOf,
  required,
  type Converter,
  type Reading,
} from './document-reading.js';
import { presentMembers, sortedBy } from './document-writing.js';
import { readPolicyField, refuseSafely, writePolicyValue } from './game-policy-json.js';
import { asId, oneOfConverter, textConverter } from './scalar-reading.js';
import { kindOf, members } from './variant-reading.js';
import { MAXIMUM_ENTITIES, NAME_RULE } from './value-reading.js';

const STATE_MEMBERS = members('groups', 'memberships');
const GROUP_MEMBERS = members('id', 'name', 'parent', 'policy');
const MEMBERSHIP_MEMBERS = members('member', 'group', 'processing', 'overrides');

/**
 * The fields a member may override, each named once: a record typed over
 * `OverridableField`, so a field the type gains or loses fails to compile here.
 */
const OVERRIDABLE: Readonly<Record<OverridableField, true>> = {
  loudness: true,
  exportProfile: true,
  naming: true,
  destination: true,
  variation: true,
  bus: true,
};

const OVERRIDABLE_FIELDS = POLICY_FIELDS.filter(
  (field): field is OverridableField => field in OVERRIDABLE,
);

const POLICY_MEMBERS: ReadonlySet<string> = new Set(POLICY_FIELDS);
const OVERRIDE_MEMBERS: ReadonlySet<string> = new Set(OVERRIDABLE_FIELDS);

/** A group's name as the document bounds it; the group's own rule is the state's. */
const asGroupName = textConverter(NAME_RULE);
const asProcessing = oneOfConverter(['inherit', 'own'] as const);

/** A policy or overrides under construction, a field at a time. */
type Fields<K extends PolicyField> = { -readonly [F in K]?: PolicyValues[F] };

/** Reads `field` of `object` into `into`; false where it is present and refused. */
function readField<K extends PolicyField>(
  reading: Reading,
  object: JsonObject,
  at: string,
  field: K,
  into: Fields<K>,
): boolean {
  const value = optional(reading, object, at, field, readPolicyField(field));
  if (value !== undefined) into[field] = value;
  return value !== undefined || object[field] === undefined;
}

/** A converter reading an object of `fields`, each by its field's reader. */
function fieldsConverter<K extends PolicyField>(
  fields: readonly K[],
  allowed: ReadonlySet<string>,
): Converter<{ readonly [F in K]?: PolicyValues[F] }> {
  return (reading, value, parent, key) => {
    const object = objectOf(reading, value, parent, key, allowed);
    if (object === undefined) return undefined;
    const at = pathOf(parent, key);
    const read: Fields<K> = {};
    let whole = true;
    for (const field of fields) whole = readField(reading, object, at, field, read) && whole;
    return whole ? read : undefined;
  };
}

/** Reads a group's policy: the fields it sets. */
const readInheritedPolicy: Converter<InheritedPolicy> = fieldsConverter(
  POLICY_FIELDS,
  POLICY_MEMBERS,
);

/** Reads a member's overrides: the fields it sets over its group. */
export const readPolicyOverrides: Converter<PolicyOverrides> = fieldsConverter(
  OVERRIDABLE_FIELDS,
  OVERRIDE_MEMBERS,
);

/** Reads an asset group. */
export const readGameAssetGroup: Converter<GameAssetGroup> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, GROUP_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const id = required(reading, object, at, 'id', asId<'GameAssetGroupId'>);
  const name = required(reading, object, at, 'name', asGroupName);
  const parentGroup = optional(reading, object, at, 'parent', asId<'GameAssetGroupId'>);
  const policy = required(reading, object, at, 'policy', readInheritedPolicy);
  if (id === undefined || name === undefined || policy === undefined) return undefined;
  if (object['parent'] !== undefined && parentGroup === undefined) return undefined;
  return { id, name, ...(parentGroup === undefined ? {} : { parent: parentGroup }), policy };
};

/** Reads a member of a group: a region or an asset. */
export const readGroupMember: Converter<GroupMember> = (reading, value, parent, key) => {
  const read = kindOf(reading, value, parent, key, 'kind', {
    region: members('kind', 'region'),
    asset: members('kind', 'asset'),
  });
  if (read === undefined) return undefined;
  const { object, at, kind } = read;
  if (kind === 'region') {
    const region = required(reading, object, at, 'region', asId<'RegionId'>);
    return region === undefined ? undefined : { kind, region };
  }
  const asset = required(reading, object, at, 'asset', asId<'AssetId'>);
  return asset === undefined ? undefined : { kind, asset };
};

const readMembership: Converter<GroupMembership> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, MEMBERSHIP_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const member = required(reading, object, at, 'member', readGroupMember);
  const group = required(reading, object, at, 'group', asId<'GameAssetGroupId'>);
  const processing = required(reading, object, at, 'processing', asProcessing);
  const overrides = required(reading, object, at, 'overrides', readPolicyOverrides);
  return member === undefined ||
    group === undefined ||
    processing === undefined ||
    overrides === undefined
    ? undefined
    : { member, group, processing, overrides };
};

const asMemberships = listConverter(MAXIMUM_ENTITIES, readMembership);

/** Reads a project's game-audio state, refusing one that holds nothing. */
export const readGameAudio: Converter<GameAudioState> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, STATE_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const groups = entitiesOf(reading, object, at, 'groups', MAXIMUM_ENTITIES, readGameAssetGroup);
  const memberships = required(reading, object, at, 'memberships', asMemberships);
  if (groups === undefined || memberships === undefined) return undefined;
  if (groups.size === 0 && memberships.length === 0) {
    reading.refuse(
      'game-audio.empty',
      'A project with no groups keeps no game-audio settings, so this member is left out.',
      at,
    );
    return undefined;
  }
  return { groups, memberships };
};

/**
 * `game`, where `project` can hold it, or `undefined` having refused each
 * reason it cannot at the group or membership that owns it, as
 * `validateGameAudioState` finds them for a command's result.
 */
export function validatedGameAudio(
  reading: Reading,
  project: Project,
  game: GameAudioState,
  at: string,
): GameAudioState | undefined {
  const valid = validateGameAudioState(project, game);
  if (valid.ok) return valid.value;
  // The document lists the groups in the order they were read, and the memberships in theirs.
  const groupAt = new Map([...game.groups.keys()].map((id, index) => [String(id), index]));
  const memberAt = new Map(game.memberships.map((one, index) => [memberKey(one.member), index]));
  for (const failure of valid.failures) {
    const details = failure.details ?? {};
    const group = groupAt.get(String(details['group']));
    const member = memberAt.get(String(details['member']));
    const place =
      details['owner'] === 'member' && member !== undefined
        ? pathOf(pathOf(at, 'memberships'), member)
        : details['owner'] === 'group' && group !== undefined
          ? pathOf(pathOf(at, 'groups'), group)
          : at;
    refuseSafely(reading, [failure], place);
  }
  return undefined;
}

/** Writes a group's policy or a member's overrides: the fields it sets, each by its writer. */
function writeFields<K extends PolicyField>(
  fields: readonly K[],
  set: { readonly [F in K]?: PolicyValues[F] },
): JsonObject {
  const written: Record<string, JsonValue | undefined> = {};
  for (const field of fields) {
    const value = set[field];
    if (value !== undefined) written[field] = writePolicyValue(field, value);
  }
  return presentMembers(written);
}

/** Writes a group's policy. */
function writeInheritedPolicy(policy: InheritedPolicy): JsonObject {
  return writeFields(POLICY_FIELDS, policy);
}

/** Writes a member's overrides. */
export function writePolicyOverrides(overrides: PolicyOverrides): JsonObject {
  return writeFields(OVERRIDABLE_FIELDS, overrides);
}

/** Writes an asset group. */
export function writeGameAssetGroup(group: GameAssetGroup): JsonObject {
  return presentMembers({
    id: group.id,
    name: group.name,
    parent: group.parent,
    policy: writeInheritedPolicy(group.policy),
  });
}

/** Writes a member of a group. */
export function writeGroupMember(member: GroupMember): JsonObject {
  return member.kind === 'region'
    ? { kind: member.kind, region: member.region }
    : { kind: member.kind, asset: member.asset };
}

/** Writes a project's game-audio state. */
export function writeGameAudio(state: GameAudioState): JsonObject {
  return {
    groups: sortedBy(state.groups.values(), (group) => group.id, writeGameAssetGroup),
    memberships: state.memberships.map((membership) => ({
      member: writeGroupMember(membership.member),
      group: membership.group,
      processing: membership.processing,
      overrides: writePolicyOverrides(membership.overrides),
    })),
  };
}
