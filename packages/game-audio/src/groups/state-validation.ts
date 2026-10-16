/**
 * Whether a game-audio state is one the project can hold (ADR-0101): run by
 * every game command on its result, by the rack command, and by the project
 * format's reader after it reads the project.
 *
 * Every problem is reported at once. Each failure's details carry the owner,
 * `owner: 'group'` with the group's identifier and path or `owner: 'member'`
 * with the member's key, and its summary names the group by path or the member
 * by name, so an invalid setting is traced to whoever set it wherever the
 * failure is shown. Policy values are checked by `policyProblems`.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
  type EffectChainId,
  type Project,
} from '@audiogubbins/domain';

import {
  ownerDetails,
  ownerWords,
  policyProblems,
  type PolicyOwner,
} from '../policy/policy-validation.js';
import { groupPolicies, type GroupEffectivePolicy } from '../policy/policy-resolution.js';
import { rackInherited } from '../policy/processing-realisation.js';
import type { GameAssetGroup } from './game-asset-group.js';
import type { GameAudioState } from './game-audio-state.js';
import type { GameAssetGroupId } from './group-ids.js';
import { walkAncestry } from './group-forest.js';
import { groupNameKey, groupNameProblem, pathText } from './group-names.js';
import { memberKey, type GroupMember, type GroupMembership } from './membership.js';

function refused(
  code: string,
  owner: PolicyOwner,
  sentence: string,
  details: Readonly<Record<string, string>> = {},
): DomainFailure {
  return failure(code, FailureKind.Rejected, `${ownerWords(owner)} ${sentence}`, {
    details: { ...ownerDetails(owner), ...details },
  });
}

/** What the forest's walk found of one group: its owner as a refusal names it, and whether it reaches a root. */
interface GroupReading {
  readonly group: GameAssetGroup;
  readonly owner: PolicyOwner & { readonly kind: 'group' };
  readonly sound: boolean;
}

function readGroups(
  groups: ReadonlyMap<GameAssetGroupId, GameAssetGroup>,
): readonly GroupReading[] {
  return [...groups.values()].map((group) => {
    const { line, end } = walkAncestry(groups, group.id);
    // As far as the path reads: a cycle or a missing parent leaves the part walked.
    const path = line.map((one) => one.name).reverse();
    return { group, owner: { kind: 'group', group: group.id, path }, sound: end.kind === 'root' };
  });
}

function forestProblems(
  groups: ReadonlyMap<GameAssetGroupId, GameAssetGroup>,
  { group, owner }: GroupReading,
): readonly DomainFailure[] {
  const problems: DomainFailure[] = [];
  const nameProblem = groupNameProblem(group.name);
  if (nameProblem !== undefined) {
    problems.push(
      refused('game.group-name-invalid', owner, `is named as no group is: ${nameProblem}`),
    );
  }
  if (group.parent !== undefined && !groups.has(group.parent)) {
    problems.push(
      refused(
        'game.group-parent-unknown',
        owner,
        `is inside group ${group.parent}, which the project does not have.`,
        { parent: group.parent },
      ),
    );
  }
  const { end } = walkAncestry(groups, group.id);
  if (end.kind === 'cycle' && end.at === group.id) {
    problems.push(refused('game.group-cycle', owner, 'is inside itself, through its parents.'));
  }
  return problems;
}

/** Two groups of one parent, or two roots, whose names are one to a sibling. */
function takenNames(readings: readonly GroupReading[]): readonly DomainFailure[] {
  const first = new Map<string, GroupReading>();
  const problems: DomainFailure[] = [];
  for (const reading of readings) {
    const key = JSON.stringify([reading.group.parent ?? null, groupNameKey(reading.group.name)]);
    const earlier = first.get(key);
    if (earlier === undefined) {
      first.set(key, reading);
      continue;
    }
    problems.push(
      refused(
        'game.group-name-taken',
        reading.owner,
        `has the name of the group "${pathText(earlier.owner.path)}" beside it; siblings' names differ in more than case.`,
        { other: earlier.group.id },
      ),
    );
  }
  return problems;
}

/** A member as a refusal names it, by its region's or asset's name or by key where it has none, and its rack. */
interface MemberReading {
  readonly owner: PolicyOwner;
  readonly known: boolean;
  readonly rack: EffectChainId | undefined;
}

function readMember(project: Project, member: GroupMember): MemberReading {
  const found =
    member.kind === 'region'
      ? project.regions.get(member.region)
      : project.assets.get(member.asset);
  return {
    owner: { kind: 'member', member, name: found?.displayName ?? memberKey(member) },
    known: found !== undefined,
    rack: found?.rack,
  };
}

function membershipProblems(
  project: Project,
  state: GameAudioState,
  sound: ReadonlySet<GameAssetGroupId>,
): readonly DomainFailure[] {
  const seen = new Set<string>();
  const policyOf = groupPolicies(state);
  const problems: DomainFailure[] = [];
  for (const membership of state.memberships) {
    const reading = readMember(project, membership.member);
    const { owner } = reading;
    const key = memberKey(membership.member);
    if (!reading.known) {
      problems.push(
        refused('game.member-unknown', owner, `names no ${membership.member.kind} of the project.`),
      );
    }
    if (seen.has(key)) {
      problems.push(refused('game.member-twice', owner, 'is in more than one membership.'));
    }
    seen.add(key);
    if (!state.groups.has(membership.group)) {
      problems.push(
        refused(
          'game.member-group-unknown',
          owner,
          `is in group ${membership.group}, which the project does not have.`,
          { group: membership.group },
        ),
      );
    }
    problems.push(...policyProblems(project, membership.overrides, owner));
    if (reading.known && sound.has(membership.group)) {
      problems.push(...processingMismatch(membership, reading, policyOf(membership.group)));
    }
  }
  return problems;
}

/** An `inherit` member whose rack is not the processing it inherits. */
function processingMismatch(
  membership: GroupMembership,
  { owner, rack }: MemberReading,
  policy: GroupEffectivePolicy,
): readonly DomainFailure[] {
  if (membership.processing !== 'inherit') return [];
  const inherited = rackInherited(policy);
  if (rack === inherited) return [];
  const { source } = policy.fields.processing;
  const from =
    source.kind === 'group'
      ? `the group "${pathText(source.path)}" ${inherited === undefined ? 'sets no rack' : `names chain ${inherited}`}`
      : 'no group sets its processing';
  return [
    refused(
      'game.member-processing-mismatch',
      owner,
      `inherits its processing, and ${from}, but its rack is ${rack === undefined ? 'none' : `chain ${rack}`}.`,
      {
        field: 'processing',
        ...(rack === undefined ? {} : { rack }),
        ...(inherited === undefined ? {} : { inherited }),
        ...(source.kind === 'group' ? { from: source.group } : {}),
      },
    ),
  ];
}

/** `state`, where `project` can hold it, or every reason it cannot. */
export function validateGameAudioState(
  project: Project,
  state: GameAudioState,
): DomainResult<GameAudioState> {
  const readings = readGroups(state.groups);
  const sound = new Set(readings.filter((one) => one.sound).map((one) => one.group.id));
  const [first, ...rest] = [
    ...readings.flatMap((reading) => forestProblems(state.groups, reading)),
    ...takenNames(readings),
    ...readings.flatMap(({ group, owner }) => policyProblems(project, group.policy, owner)),
    ...membershipProblems(project, state, sound),
  ];
  return first === undefined ? succeed(state) : fail(first, ...rest);
}
