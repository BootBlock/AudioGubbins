/**
 * How a difference compares an asset group and a membership field by field
 * (ADR-0106, REQ-STOR-195), as `entity-fields.ts` compares every other
 * entity: a table whose type names every field, so a field the game-audio
 * state gains fails to compile here until a difference says how it is
 * compared.
 */

import { memberKey, type PolicyField, type PolicyValues } from '@audiogubbins/game-audio';
import { canonicalJson, writePolicyValue } from '@audiogubbins/project-format';

import {
  optionally,
  same,
  sameList,
  type Comparison,
  type FieldComparisons,
} from './entity-fields.js';
import type { GameGroupEntity, GameMemberEntity } from './game-entities.js';

/**
 * A policy field's values compared as the project format writes them, the one
 * statement of every member a value has: a field a command did not change
 * keeps its value, so only a field it set again is written.
 */
function samePolicy<F extends PolicyField>(field: F): Comparison<PolicyValues[F] | undefined> {
  return optionally(
    (before, after) =>
      before === after ||
      canonicalJson(writePolicyValue(field, before)) ===
        canonicalJson(writePolicyValue(field, after)),
  );
}

/** A group's fields: its name, place and members, and each field of its policy. */
export const GAME_GROUP_FIELDS: FieldComparisons<GameGroupEntity> = {
  id: same,
  name: same,
  parent: same,
  members: sameList,
  processing: samePolicy('processing'),
  loudness: samePolicy('loudness'),
  exportProfile: samePolicy('exportProfile'),
  naming: samePolicy('naming'),
  destination: samePolicy('destination'),
  emitter: samePolicy('emitter'),
  variation: samePolicy('variation'),
  bus: samePolicy('bus'),
  tags: samePolicy('tags'),
};

/** A membership's fields: its group, whether it inherits its processing, and each override. */
export const GAME_MEMBER_FIELDS: FieldComparisons<GameMemberEntity> = {
  member: (before, after) => memberKey(before) === memberKey(after),
  group: same,
  processing: same,
  loudness: samePolicy('loudness'),
  exportProfile: samePolicy('exportProfile'),
  naming: samePolicy('naming'),
  destination: samePolicy('destination'),
  variation: samePolicy('variation'),
  bus: samePolicy('bus'),
};
