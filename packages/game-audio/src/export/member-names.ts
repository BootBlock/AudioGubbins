/**
 * What a naming template reads of a group's members, and the names it gives
 * their regions (ADR-0102).
 *
 * The one account of a member's naming values, read by the game export plan
 * for its files' names and by region naming for the regions' own: the
 * project's name, the member's asset and region, its group's name and path,
 * and its place in its group. `{number}` counts the member's place among its
 * group's members in assignment order, never among the members asked about,
 * so a member's name does not change with what else is named or exported.
 *
 * Every member is answered by itself: one that cannot be named is refused
 * with its reasons and the others are named, and nothing is answered as named
 * that is not.
 */

import {
  FailureKind,
  failure,
  type DomainFailure,
  type DomainResult,
  fail,
  succeed,
  type Project,
  type RegionId,
} from '@audiogubbins/domain';
import type { ExportClock } from '@audiogubbins/import-export';
import { quoted } from '@audiogubbins/text';

import type { GameAudioState } from '../groups/game-audio-state.js';
import { groupPath } from '../groups/group-forest.js';
import type { GameAssetGroupId } from '../groups/group-ids.js';
import { memberKey, type GroupMember } from '../groups/membership.js';
import { expandNaming, type NamingValues } from './member-naming.js';
import type { NamingTemplate } from './naming-template.js';

/** What a template reads of a member: every value but the clock and the target's extension. */
export type MemberNaming = Omit<NamingValues, 'clock' | 'extension'>;

/** The members counted so far in a group: its count, once every membership is read. */
interface Tally {
  count: number;
}

/** A member's place in its group, from 1, and its group's tally. */
interface Place {
  readonly group: GameAssetGroupId;
  readonly number: number;
  readonly of: Tally;
}

function refused(code: string, sentence: string, member: GroupMember): DomainFailure {
  return failure(code, FailureKind.Rejected, sentence, {
    details: { member: memberKey(member) },
  });
}

/** Each member's place in its group, by key, from one pass over the memberships. */
function placesOf(state: GameAudioState): ReadonlyMap<string, Place> {
  const tallies = new Map<GameAssetGroupId, Tally>();
  const places = new Map<string, Place>();
  for (const { member, group } of state.memberships) {
    const known = tallies.get(group);
    const of = known ?? { count: 0 };
    if (known === undefined) tallies.set(group, of);
    of.count += 1;
    places.set(memberKey(member), { group, number: of.count, of });
  }
  return places;
}

/** The member's region's name, if it is one, and its asset's, or `undefined` where the project has neither. */
function ownNames(
  project: Project,
  member: GroupMember,
): { readonly asset: string; readonly region: string | undefined } | undefined {
  if (member.kind === 'asset') {
    const asset = project.assets.get(member.asset);
    return asset === undefined ? undefined : { asset: asset.displayName, region: undefined };
  }
  const region = project.regions.get(member.region);
  if (region === undefined) return undefined;
  const asset = project.assets.get(region.assetId);
  if (asset === undefined) {
    throw new Error(`Region ${region.id} names asset ${region.assetId}, which the project lacks.`);
  }
  return { asset: asset.displayName, region: region.displayName };
}

/**
 * A reader of each member's naming values in `project` and `state`, which
 * places every member and walks each group's path once however many members
 * it is asked about. A member the project does not hold, or one in no group,
 * is refused: it has no group to be named or numbered by.
 */
export function memberNamings(
  project: Project,
  state: GameAudioState,
): (member: GroupMember) => DomainResult<MemberNaming> {
  const places = placesOf(state);
  const paths = new Map<GameAssetGroupId, readonly string[]>();
  const pathOf = (group: GameAssetGroupId): readonly string[] => {
    const known = paths.get(group);
    if (known !== undefined) return known;
    const path = groupPath(state.groups, group);
    paths.set(group, path);
    return path;
  };
  return (member) => {
    const own = ownNames(project, member);
    if (own === undefined) {
      return fail(
        refused(
          'game.member-unknown',
          `The project has no ${member.kind} ${memberKey(member)}, so it cannot be named.`,
          member,
        ),
      );
    }
    const place = places.get(memberKey(member));
    if (place === undefined) {
      return fail(
        refused(
          'game.member-in-no-group',
          `The ${member.kind} ${quoted(own.region ?? own.asset)} is in no group, so no group names or numbers it; add it to one.`,
          member,
        ),
      );
    }
    const group = state.groups.get(place.group);
    if (group === undefined) {
      throw new Error(
        `Group ${place.group} is not in the forest; only a validated state is named.`,
      );
    }
    return succeed({
      project: project.displayName,
      asset: own.asset,
      region: own.region,
      groupName: group.name,
      groupPath: pathOf(place.group),
      number: place.number,
      count: place.of.count,
    });
  };
}

/**
 * The stem `template` names a member by, or why it cannot. A stem with
 * nothing but spaces in it names nothing, and is refused here rather than
 * left for the export to call `export` or a region to show blank.
 */
export function memberStem(
  template: NamingTemplate,
  values: NamingValues,
  member: GroupMember,
): DomainResult<string> {
  const stem = expandNaming(template, values);
  if (!stem.ok || stem.value.trim() !== '') return stem;
  return fail(
    refused(
      'game.member-name-empty',
      `The naming template ${quoted(template.source)} gives the ${member.kind} ${quoted(values.region ?? values.asset)} no name; name it by something it has.`,
      member,
    ),
  );
}

/** A region of a group, the one kind of member whose own name a template sets. */
export interface RegionMember {
  readonly kind: 'region';
  readonly region: RegionId;
}

/** A region's new name, or every reason it has none. */
export type RegionName =
  | { readonly kind: 'named'; readonly member: RegionMember; readonly name: string }
  | {
      readonly kind: 'refused';
      readonly member: RegionMember;
      readonly failures: readonly [DomainFailure, ...DomainFailure[]];
    };

function namesFormat(template: NamingTemplate): boolean {
  return template.parts.some((part) => part.kind === 'token' && part.token === 'format');
}

/**
 * Each region's new name by `template` at `clock`, in the order asked: the
 * names the project's region command writes into each region's
 * `displayName`, one step for all of them. A region's name is not a file's,
 * so a template naming `{format}`, a file's extension, names no region.
 */
export function memberNames(
  project: Project,
  state: GameAudioState,
  members: readonly RegionMember[],
  template: NamingTemplate,
  clock: ExportClock,
): readonly RegionName[] {
  const namingOf = memberNamings(project, state);
  const format = namesFormat(template);
  return members.map((member): RegionName => {
    if (format) {
      return {
        kind: 'refused',
        member,
        failures: [
          refused(
            'game.region-name-format-token',
            `The naming template ${quoted(template.source)} names {format}, a file's extension, which no region's name has; name the region without it.`,
            member,
          ),
        ],
      };
    }
    const naming = namingOf(member);
    // Refused above where the template names {format}, so no part reads the extension.
    const stem = naming.ok
      ? memberStem(template, { ...naming.value, clock, extension: '' }, member)
      : naming;
    return stem.ok
      ? { kind: 'named', member, name: stem.value }
      : { kind: 'refused', member, failures: stem.failures };
  });
}
