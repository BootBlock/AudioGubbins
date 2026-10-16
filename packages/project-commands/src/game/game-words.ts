/**
 * How the game commands name what they change in an undo description or a
 * refusal (ADR-0101): a group by its path, as the person sees it in the
 * groups' tree, a member by its region's or asset's name, and a policy field
 * as a sentence says it.
 */

import type { Project } from '@audiogubbins/domain';
import {
  groupPath,
  pathText,
  type GameAssetGroupId,
  type GameAudioState,
  type GroupMember,
  type PolicyField,
} from '@audiogubbins/game-audio';
import { quoted } from '@audiogubbins/text';

/** Each field of a policy as a sentence names it. */
export const FIELD_WORDS: Readonly<Record<PolicyField, string>> = {
  processing: 'processing',
  loudness: 'loudness target',
  exportProfile: 'export profile',
  naming: 'naming template',
  destination: 'destination folder',
  emitter: 'emitter rules',
  variation: 'voice variation',
  bus: 'bus',
  tags: 'tags',
};

/** `group` as a sentence names it, by its quoted path, in a forest the validator has passed. */
export function groupWords(game: GameAudioState, group: GameAssetGroupId): string {
  return `group ${quoted(pathText(groupPath(game.groups, group)))}`;
}

/** The name of `member`'s region or asset, or `undefined` where the project has no such member. */
export function memberName(project: Project, member: GroupMember): string | undefined {
  return member.kind === 'region'
    ? project.regions.get(member.region)?.displayName
    : project.assets.get(member.asset)?.displayName;
}
