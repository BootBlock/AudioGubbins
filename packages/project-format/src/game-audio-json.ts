/**
 * Writing and reading a project's game-audio state (`ProjectState.gameAudio`,
 * ADR-0106): its asset groups with their policy, and its memberships with
 * their processing and overrides, and the preview scenarios that play them, as
 * the document member `gameAudio` and the tree's `project/game-audio.json`
 * (REQ-EXEC-136.12).
 *
 * ```
 * { "groups": [ { "id", "name", "parent"?,
 *                 "policy": { <field>: <value>, ... } } ],
 *   "memberships": [ { "member": { "kind": "region", "region" }
 *                              | { "kind": "asset", "asset" },
 *                      "group", "processing": "inherit" | "own",
 *                      "overrides": { ... } } ],
 *   "scenarios": [ <scenario>, ... ] }
 * ```
 *
 * The writer is canonical: groups and scenarios sorted by identifier, which
 * says nothing of them, and memberships in assignment order, which is what a
 * group's members are chosen and numbered in; a policy writes the fields it
 * sets and nothing else (`game-policy-json.ts`), and a scenario is written by
 * `game-scenario-json.ts`. The reader holds every member to its shape and every
 * value to its field's, refusing a group or a scenario twice, a member it does
 * not know, and a state that holds nothing, which the project keeps by having
 * no member at all (`withGameAudio`), so one state is written one way. Whether
 * the forest, the references, the subjects and the ranges are ones the project
 * can hold is `validateGameAudioState`'s, which the project document's reader
 * runs once the project is read, through {@link validatedGameAudio}: the same
 * rules a game command's result is held to.
 */

import type { Project } from '@audiogubbins/domain';
import {
  OVERRIDABLE_FIELDS,
  POLICY_FIELDS,
  holdsNoGameAudio,
  memberKey,
  validateGameAudioState,
  type GameAssetGroup,
  type GameAudioState,
  type GroupMembership,
  type InheritedPolicy,
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
import { readGroupMember, writeGroupMember } from './game-member-json.js';
import { readPolicyField, refuseSafely, writePolicyValue } from './game-policy-json.js';
import { readPreviewScenario, writePreviewScenario } from './game-scenario-json.js';
import { asId, oneOfConverter, textConverter } from './scalar-reading.js';
import { members } from './variant-reading.js';
import { MAXIMUM_ENTITIES, NAME_RULE } from './value-reading.js';

const STATE_MEMBERS = members('groups', 'memberships', 'scenarios');
const GROUP_MEMBERS = members('id', 'name', 'parent', 'policy');
const MEMBERSHIP_MEMBERS = members('member', 'group', 'processing', 'overrides');

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
  const scenarios = entitiesOf(
    reading,
    object,
    at,
    'scenarios',
    MAXIMUM_ENTITIES,
    readPreviewScenario,
  );
  if (groups === undefined || memberships === undefined || scenarios === undefined) {
    return undefined;
  }
  const state: GameAudioState = { groups, memberships, scenarios };
  if (holdsNoGameAudio(state)) {
    reading.refuse(
      'game-audio.empty',
      'A project with no groups and no preview scenarios keeps no game-audio settings, so this member is left out.',
      at,
    );
    return undefined;
  }
  return state;
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
  // The document lists the groups, memberships and scenarios in the order they were read.
  const groupAt = new Map([...game.groups.keys()].map((id, index) => [String(id), index]));
  const memberAt = new Map(game.memberships.map((one, index) => [memberKey(one.member), index]));
  const scenarioAt = new Map([...game.scenarios.keys()].map((id, index) => [String(id), index]));
  for (const failure of valid.failures) {
    const details = failure.details ?? {};
    const group = groupAt.get(String(details['group']));
    const member = memberAt.get(String(details['member']));
    const scenario = scenarioAt.get(String(details['scenario']));
    const place =
      details['owner'] === 'member' && member !== undefined
        ? pathOf(pathOf(at, 'memberships'), member)
        : details['owner'] === 'group' && group !== undefined
          ? pathOf(pathOf(at, 'groups'), group)
          : scenario !== undefined
            ? pathOf(pathOf(at, 'scenarios'), scenario)
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
    scenarios: sortedBy(state.scenarios.values(), (scenario) => scenario.id, writePreviewScenario),
  };
}
