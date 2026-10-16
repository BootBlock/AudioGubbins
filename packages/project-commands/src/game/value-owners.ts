/**
 * Who gives a policy value a game command reads, as its refusal names it
 * (ADR-0101): the group that sets it, by its path, or the member that
 * overrides its group's, by its name.
 *
 * The packet's failure rule is that an invalid inherited setting identifies the
 * group or the override that owns it. A value is read by the project format's
 * reader (`invocation-arguments.ts`), whose refusals name only the place in the
 * argument, as a document's must; so each refusal of a value is said again here
 * naming its owner and its field, its code and its place kept.
 */

import {
  FailureKind,
  fail,
  failure,
  unsafeBrandId,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import {
  POLICY_FIELDS,
  groupPath,
  memberKey,
  pathText,
  type GameAssetGroupId,
  type GameAudioState,
  type GroupMember,
  type PolicyField,
} from '@audiogubbins/game-audio';
import { isJsonObject, type JsonValue } from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';

import { FIELD_WORDS, groupWords } from './game-words.js';

/** The group or member a policy value is given for, as a refusal names it. */
export interface ValueOwner {
  /** As a sentence names it after "The". */
  readonly words: string;
  /** What it does with a field: a group sets it, a member overrides its group's. */
  readonly kind: 'group' | 'member';
  /** What identifies it, as the game-audio state's own refusals carry it. */
  readonly details: Readonly<Record<string, string>>;
}

const FIELDS: ReadonlySet<string> = new Set(POLICY_FIELDS);

export function isPolicyField(text: string): text is PolicyField {
  return FIELDS.has(text);
}

/** `group` of `game` as the owner of what it sets. */
export function groupOwner(game: GameAudioState, group: GameAssetGroupId): ValueOwner {
  return {
    words: groupWords(game, group),
    kind: 'group',
    details: { owner: 'group', group, groupPath: pathText(groupPath(game.groups, group)) },
  };
}

/**
 * The group `value`, a group an invocation adds, would be in `game`, as the
 * owner of what it sets: by the path its name and parent give, as far as
 * `value` reads.
 */
export function newGroupOwner(game: GameAudioState, value: JsonValue): ValueOwner {
  const fields = isJsonObject(value) ? value : undefined;
  const name = fields?.['name'];
  const parent = fields?.['parent'];
  const parentId =
    typeof parent === 'string' ? unsafeBrandId<'GameAssetGroupId'>(parent) : undefined;
  const above =
    parentId !== undefined && game.groups.has(parentId) ? groupPath(game.groups, parentId) : [];
  const id = fields?.['id'];
  return {
    words:
      typeof name === 'string' ? `new group ${quoted(pathText([...above, name]))}` : 'new group',
    kind: 'group',
    details: { owner: 'group', ...(typeof id === 'string' ? { group: id } : {}) },
  };
}

/** `member`, called `name`, as the owner of what it overrides. */
export function memberOwner(member: GroupMember, name: string): ValueOwner {
  return {
    words: `${member.kind} ${quoted(name)}`,
    kind: 'member',
    details: { owner: 'member', member: memberKey(member) },
  };
}

/** What an owner does with `field`, or with its policy where the field is not known. */
function settingWords(owner: ValueOwner, field: PolicyField | undefined): string {
  const what = field === undefined ? 'policy' : FIELD_WORDS[field];
  return owner.kind === 'group' ? `sets its ${what}` : `overrides its group’s ${what}`;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * `result`, its every failure placed at `under` or within it said again as the
 * refusal of a value `owner` gives: of `field`, or, where none is given, of
 * the field the first step of its place below `under` names.
 */
export function ownedBy<TValue>(
  result: DomainResult<TValue>,
  owner: ValueOwner,
  under: string,
  field?: PolicyField,
): DomainResult<TValue> {
  if (result.ok) return result;
  const owned = (problem: DomainFailure): DomainFailure => {
    const at = problem.details?.['at'];
    if (typeof at !== 'string' || (at !== under && !at.startsWith(`${under}.`))) return problem;
    const step = at.slice(under.length + 1).split('.')[0] ?? '';
    const named = field ?? (isPolicyField(step) ? step : undefined);
    return failure(
      problem.code,
      FailureKind.Rejected,
      `The ${owner.words} ${settingWords(owner, named)} with what it does not take: ${lowerFirst(problem.summary)}`,
      {
        details: {
          ...problem.details,
          ...owner.details,
          ...(named === undefined ? {} : { field: named }),
        },
        ...(problem.cause === undefined ? {} : { cause: problem.cause }),
      },
    );
  };
  const [first, ...rest] = result.failures;
  return fail(owned(first), ...rest.map(owned));
}
