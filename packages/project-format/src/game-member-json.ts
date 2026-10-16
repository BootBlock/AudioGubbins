/**
 * Writing and reading a member of an asset group (ADR-0106), wherever one is
 * kept: a membership, a preview scenario's subject, and a game command's
 * argument (REQ-EXEC-136.12).
 *
 * ```
 * { "kind": "region", "region": <id> } | { "kind": "asset", "asset": <id> }
 * ```
 */

import type { GroupMember } from '@audiogubbins/game-audio';

import type { JsonObject } from './canonical-json.js';
import { required, type Converter } from './document-reading.js';
import { asId } from './scalar-reading.js';
import { kindOf, members } from './variant-reading.js';

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

/** Writes a member of a group. */
export function writeGroupMember(member: GroupMember): JsonObject {
  return member.kind === 'region'
    ? { kind: member.kind, region: member.region }
    : { kind: member.kind, asset: member.asset };
}
