/**
 * Whether the values a group sets, or a member overrides, are ones the policy
 * takes (ADR-0101), each refusal naming its field and its owner.
 *
 * The packet's failure rule is that an invalid inherited setting identifies the
 * group or the override that owns it, so every refusal here is a
 * `game.policy-*` failure whose details carry the field and the owner, the
 * group by identifier and path or the member by key, and whose summary names
 * the owner as a person reads it. The value's own refusal (a template the game
 * vocabulary does not read, a folder no file system takes, a range passed) is
 * its `cause`, so nothing it said is lost.
 *
 * A game export profile is held to its format's choices by its type, and to a
 * member's audio only where the member's export is planned, since the rate,
 * channels and codec its encoding is checked against are the member's
 * (`validateExportSettings`, the one authority on them); so its field is not
 * read here.
 */

import {
  FailureKind,
  failure,
  type DomainFailure,
  type DomainResult,
  type Project,
} from '@audiogubbins/domain';

import { destinationPath } from '../export/destination-path.js';
import { namingTemplate } from '../export/naming-template.js';
import type { GameAssetGroupId } from '../groups/group-ids.js';
import { pathText } from '../groups/group-names.js';
import { memberKey, type GroupMember } from '../groups/membership.js';
import { busName } from './bus-name.js';
import type { InheritedPolicy } from './inherited-policy.js';
import { loudnessProblems } from './loudness-target.js';
import { emitterRulesProblems, voiceVariationProblems } from './playback-rules.js';
import { POLICY_FIELDS, type PolicyField, type PolicyValues } from './policy-fields.js';

/** Who sets a policy's values: a group, or a member over its group. */
export type PolicyOwner =
  | {
      readonly kind: 'group';
      readonly group: GameAssetGroupId;
      /** The group's path from its root; as far as it reads, in a forest that does not. */
      readonly path: readonly string[];
    }
  | {
      readonly kind: 'member';
      readonly member: GroupMember;
      /** The region's or asset's name, as a person knows it. */
      readonly name: string;
    };

/** A field this module refuses a value of: every one but the profile, checked per member. */
type CheckedField = Exclude<PolicyField, 'exportProfile'>;

/** The code each field's refusal is made under. */
const REFUSAL_CODES: Readonly<Record<CheckedField, string>> = {
  processing: 'game.policy-chain-unknown',
  loudness: 'game.policy-loudness-invalid',
  naming: 'game.policy-naming-invalid',
  destination: 'game.policy-destination-invalid',
  emitter: 'game.policy-emitter-invalid',
  variation: 'game.policy-variation-invalid',
  bus: 'game.policy-bus-invalid',
  tags: 'game.policy-tag-invalid',
};

/** Each field as a sentence names it. */
const FIELD_WORDS: Readonly<Record<CheckedField, string>> = {
  processing: 'processing chain',
  loudness: 'loudness target',
  naming: 'naming template',
  destination: 'destination',
  emitter: 'emitter rules',
  variation: 'voice variation',
  bus: 'bus',
  tags: 'tags',
};

/** The most characters, in UTF-16 code units, a tag holds. */
const LONGEST_TAG = 64;
const CONTROL_CHARACTER = /\p{Cc}/u;

/** The owner as a sentence begins with it. */
export function ownerWords(owner: PolicyOwner): string {
  return owner.kind === 'group'
    ? `The group "${pathText(owner.path)}"`
    : `The ${owner.member.kind} "${owner.name}"`;
}

/** The details that identify `owner`. */
export function ownerDetails(owner: PolicyOwner): Readonly<Record<string, string>> {
  return owner.kind === 'group'
    ? { owner: 'group', group: owner.group, groupPath: pathText(owner.path) }
    : { owner: 'member', member: memberKey(owner.member) };
}

function refusal(
  field: CheckedField,
  owner: PolicyOwner,
  sentence: string,
  cause?: DomainFailure,
): DomainFailure {
  const verb = owner.kind === 'group' ? 'sets' : 'overrides';
  return failure(
    REFUSAL_CODES[field],
    FailureKind.Rejected,
    `${ownerWords(owner)} ${verb} its ${FIELD_WORDS[field]} with what it does not take: ${sentence}`,
    { details: { field, ...ownerDetails(owner) }, ...(cause === undefined ? {} : { cause }) },
  );
}

function refusalsOf(
  field: CheckedField,
  owner: PolicyOwner,
  causes: readonly DomainFailure[],
): readonly DomainFailure[] {
  return causes.map((cause) => refusal(field, owner, cause.summary, cause));
}

function causesOf<T>(result: DomainResult<T>): readonly DomainFailure[] {
  return result.ok ? [] : result.failures;
}

function tagProblem(tag: string): string | undefined {
  const characters = tag.length;
  if (characters === 0 || characters > LONGEST_TAG) {
    return `a tag is 1 to ${String(LONGEST_TAG)} characters long, and "${tag}" is ${String(characters)}.`;
  }
  return CONTROL_CHARACTER.test(tag) ? `the tag "${tag}" holds a control character.` : undefined;
}

type FieldCheck<F extends PolicyField> = (
  value: PolicyValues[F],
  project: Project,
  owner: PolicyOwner,
) => readonly DomainFailure[];

/** How each field's value is checked. */
const CHECKS: { readonly [F in PolicyField]: FieldCheck<F> } = {
  processing: (chain, project, owner) =>
    chain === 'none' || project.effectChains.has(chain)
      ? []
      : [refusal('processing', owner, `the project has no chain ${chain}.`)],
  loudness: (target, _project, owner) => refusalsOf('loudness', owner, loudnessProblems(target)),
  // Checked against each member's audio where its export is planned (above).
  exportProfile: () => [],
  naming: (template, _project, owner) =>
    refusalsOf('naming', owner, causesOf(namingTemplate(template.source))),
  destination: (path, _project, owner) =>
    refusalsOf('destination', owner, causesOf(destinationPath(path.segments))),
  emitter: (rules, _project, owner) => refusalsOf('emitter', owner, emitterRulesProblems(rules)),
  variation: (variation, _project, owner) =>
    refusalsOf('variation', owner, voiceVariationProblems(variation)),
  bus: (name, _project, owner) => refusalsOf('bus', owner, causesOf(busName(name))),
  tags: (tags, _project, owner) =>
    tags.flatMap((tag) => {
      const problem = tagProblem(tag);
      return problem === undefined ? [] : [refusal('tags', owner, problem)];
    }),
};

function fieldProblems<F extends PolicyField>(
  field: F,
  value: PolicyValues[F],
  project: Project,
  owner: PolicyOwner,
): readonly DomainFailure[] {
  return CHECKS[field](value, project, owner);
}

/** Every value `policy` sets that its field does not take, in field order, each naming `owner`. */
export function policyProblems(
  project: Project,
  policy: InheritedPolicy,
  owner: PolicyOwner,
): readonly DomainFailure[] {
  return POLICY_FIELDS.flatMap((field) => {
    const value = policy[field];
    return value === undefined ? [] : fieldProblems(field, value, project, owner);
  });
}
