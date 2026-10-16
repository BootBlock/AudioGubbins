import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { POLICY_FIELDS, type GameAudioState } from '@audiogubbins/game-audio';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { canonicalJson, isJsonArray, isJsonObject, type JsonValue } from './canonical-json.js';
import { startReading } from './document-reading.js';
import { readPolicyField, writePolicyValue } from './game-policy-json.js';
import { readProjectDocument, writeProjectDocument } from './project-json.js';
import { withGameAudio, type ProjectState } from './project-state.js';
import { edited, valueAt, withValue, without } from './testing/json-editing.js';
import { groupedReferenceState } from './testing/project-states.js';
import { randomState } from './testing/random-states.js';

/**
 * A project's asset groups and memberships in its document (ADR-0106): every
 * field of every policy and override written and read back as it was, one
 * state written one way, and a state the project cannot hold refused with its
 * reason at the group or membership that owns it, never quoting what a person
 * wrote (REQ-PRIV-165).
 */

const { state: GROUPED, outer, inner } = groupedReferenceState(sampleProject());
const DOCUMENT = writeProjectDocument(GROUPED);

function game(state: ProjectState): GameAudioState {
  if (state.gameAudio === undefined) throw new Error('The state has game audio.');
  return state.gameAudio;
}

/** Where a group lies in the document's list of groups, which is sorted by identifier. */
function groupIndex(id: string): number {
  const groups = valueAt(DOCUMENT, ['gameAudio', 'groups']);
  const index = isJsonArray(groups)
    ? groups.findIndex((group) => isJsonObject(group) && group['id'] === id)
    : -1;
  if (index < 0) throw new Error(`The document lists group ${id}.`);
  return index;
}

const OUTER = groupIndex(outer.id);
const INNER = groupIndex(inner.id);

/** Each problem's code and place, from reading `value` as a document. */
function problemsOf(value: JsonValue): readonly (readonly [string, unknown])[] {
  const result = readProjectDocument(value);
  return result.ok ? [] : result.failures.map((problem) => [problem.code, problem.details?.['at']]);
}

describe("a project's game-audio state in its document (ADR-0106)", () => {
  it('reads back as the state written, every field of every policy and override', () => {
    const read = expectSuccess(readProjectDocument(DOCUMENT));
    expect(read).toEqual(GROUPED);
    expect(canonicalJson(writeProjectDocument(read))).toBe(canonicalJson(DOCUMENT));
  });

  it('writes each policy field and reads it back alone, as a command argument is', () => {
    for (const field of POLICY_FIELDS) {
      const value = outer.policy[field];
      if (value === undefined) throw new Error(`The outer group sets its ${field}.`);
      const reading = startReading();
      const read = readPolicyField(field)(reading, writePolicyValue(field, value), 'value', field);
      expect(expectSuccess(reading.outcome(read)), field).toEqual(value);
    }
  });

  it('writes its groups by identifier, whatever order the state holds them in', () => {
    const groups = game(GROUPED).groups;
    const reordered = withGameAudio(GROUPED, {
      ...game(GROUPED),
      groups: new Map([...groups].reverse()),
    });
    expect(canonicalJson(writeProjectDocument(reordered))).toBe(canonicalJson(DOCUMENT));
  });

  it('keeps its memberships in assignment order, which a group numbers its members by', () => {
    const memberships = [...game(GROUPED).memberships].reverse();
    const reordered = withGameAudio(GROUPED, { ...game(GROUPED), memberships });
    const document = writeProjectDocument(reordered);
    expect(canonicalJson(document)).not.toBe(canonicalJson(DOCUMENT));
    expect(game(expectSuccess(readProjectDocument(document))).memberships).toEqual(memberships);
  });

  it('keeps no member for a project without groups, the one form of having none', () => {
    const none = withGameAudio(GROUPED, { groups: new Map(), memberships: [] });
    expect(none.gameAudio).toBeUndefined();
    expect(Object.keys(writeProjectDocument(none))).not.toContain('gameAudio');
    expect(withGameAudio(none, game(GROUPED))).toEqual(GROUPED);
  });
});

describe('the game-audio member refuses', () => {
  const group = (index: number, ...path: readonly (string | number)[]) => [
    'gameAudio',
    'groups',
    index,
    ...path,
  ];
  const at = (...path: readonly (string | number)[]) =>
    path.reduce<string>(
      (where, step) =>
        typeof step === 'number' ? `${where}[${String(step)}]` : `${where}.${step}`,
      'gameAudio',
    );

  it.each<[string, (value: JsonValue) => JsonValue, string, string]>([
    [
      'a state that holds nothing',
      (value) => withValue(value, ['gameAudio'], { groups: [], memberships: [] }),
      'game-audio.empty',
      'gameAudio',
    ],
    [
      'a policy field the policy does not have',
      (value) => withValue(value, group(OUTER, 'policy', 'volume'), 1),
      'schema.unknown-member',
      at('groups', OUTER, 'policy'),
    ],
    [
      'an override of a field a member may not set',
      (value) => withValue(value, ['gameAudio', 'memberships', 1, 'overrides', 'emitter'], {}),
      'schema.unknown-member',
      at('memberships', 1, 'overrides'),
    ],
    [
      'an attenuation of a kind there is none of',
      (value) =>
        withValue(value, group(OUTER, 'policy', 'emitter', 'attenuation', 'kind'), 'cubic'),
      'schema.unknown-value',
      at('groups', OUTER, 'policy', 'emitter', 'attenuation', 'kind'),
    ],
    [
      'a loudness target that is not an object',
      (value) => withValue(value, group(OUTER, 'policy', 'loudness'), '-16 LUFS'),
      'schema.not-an-object',
      at('groups', OUTER, 'policy', 'loudness'),
    ],
    [
      'a range without its least',
      (value) => without(value, group(OUTER, 'policy', 'variation', 'pitchCents', 'min')),
      'schema.missing-member',
      at('groups', OUTER, 'policy', 'variation', 'pitchCents', 'min'),
    ],
    [
      "a profile's encoding its format does not hold",
      (value) =>
        withValue(
          withValue(value, group(OUTER, 'policy', 'exportProfile', 'format'), 'aiff'),
          group(OUTER, 'policy', 'exportProfile', 'choices', 'encoding'),
          { kind: 'float', bits: 32 },
        ),
      'export-settings.encoding-not-held',
      at('groups', OUTER, 'policy', 'exportProfile', 'choices', 'encoding'),
    ],
    [
      'a profile choosing what each member gives, its range',
      (value) =>
        withValue(value, group(OUTER, 'policy', 'exportProfile', 'choices', 'range'), {
          kind: 'project',
        }),
      'schema.unknown-member',
      at('groups', OUTER, 'policy', 'exportProfile', 'choices'),
    ],
    [
      'a naming template the game vocabulary does not read',
      (value) => withValue(value, group(OUTER, 'policy', 'naming'), '{weather}'),
      'game.naming-template-invalid',
      at('groups', OUTER, 'policy', 'naming'),
    ],
    [
      'a destination that steps out of the folder it is in',
      (value) => withValue(value, group(OUTER, 'policy', 'destination'), ['audio', '..']),
      'game.destination-invalid',
      at('groups', OUTER, 'policy', 'destination'),
    ],
    [
      'a bus with no name',
      (value) => withValue(value, group(INNER, 'policy', 'bus'), ''),
      'game.bus-name-invalid',
      at('groups', INNER, 'policy', 'bus'),
    ],
    [
      'processing that names neither a chain nor none',
      (value) => withValue(value, group(OUTER, 'policy', 'processing'), 'the reverb'),
      'schema.malformed-id',
      at('groups', OUTER, 'policy', 'processing'),
    ],
    [
      'a member of a kind there is none of',
      (value) => withValue(value, ['gameAudio', 'memberships', 0, 'member', 'kind'], 'clip'),
      'schema.unknown-value',
      at('memberships', 0, 'member', 'kind'),
    ],
    [
      'processing that is neither inherited nor owned',
      (value) => withValue(value, ['gameAudio', 'memberships', 0, 'processing'], 'shared'),
      'schema.unknown-value',
      at('memberships', 0, 'processing'),
    ],
    [
      'a group listed twice',
      (value) =>
        edited(value, ['gameAudio', 'groups'], (groups) =>
          Array.isArray(groups) ? [...groups, groups[OUTER] ?? null] : groups,
        ),
      'schema.duplicate-id',
      at('groups', 2),
    ],
  ])('%s, where it is', (_case, edit, code, where) => {
    expect(problemsOf(edit(DOCUMENT))).toContainEqual([code, where]);
  });

  it.each<[string, (value: JsonValue) => JsonValue, string, string]>([
    [
      'a group inside itself, at each group of the cycle',
      (value) => withValue(value, group(OUTER, 'parent'), inner.id),
      'game.group-cycle',
      at('groups', OUTER),
    ],
    [
      'two groups beside each other named alike but for case',
      (value) =>
        withValue(without(value, group(INNER, 'parent')), group(INNER, 'name'), 'FOOTSTEPS'),
      'game.group-name-taken',
      at('groups', Math.max(OUTER, INNER)),
    ],
    [
      'a member that is no region of the project',
      (value) =>
        withValue(value, ['gameAudio', 'memberships', 0, 'member', 'region'], 'deadbeef-0000'),
      'game.member-unknown',
      at('memberships', 0),
    ],
    [
      'a loudness target out of its range',
      (value) => withValue(value, group(OUTER, 'policy', 'loudness', 'integratedLufs'), 3),
      'game.policy-loudness-invalid',
      at('groups', OUTER),
    ],
    [
      'processing that names a chain the project does not have',
      (value) => withValue(value, group(OUTER, 'policy', 'processing'), 'deadbeef-0001'),
      'game.policy-chain-unknown',
      at('groups', OUTER),
    ],
    [
      "an inheriting member whose rack is not its group's chain",
      (value) => withValue(value, group(OUTER, 'policy', 'processing'), 'none'),
      'game.member-processing-mismatch',
      at('memberships', 0),
    ],
  ])('a state the project cannot hold: %s, at its owner', (_case, edit, code, where) => {
    expect(problemsOf(edit(DOCUMENT))).toContainEqual([code, where]);
  });

  it('a state the project cannot hold, naming the owner and the field it set', () => {
    const result = readProjectDocument(
      withValue(DOCUMENT, group(OUTER, 'policy', 'loudness', 'toleranceLu'), 0),
    );
    expect(result.ok ? [] : result.failures).toMatchObject([
      {
        code: 'game.policy-loudness-invalid',
        kind: 'integrity-violation',
        details: {
          at: at('groups', OUTER),
          owner: 'group',
          group: outer.id,
          field: 'loudness',
          part: 'toleranceLu',
        },
      },
    ]);
  });

  it('without quoting the names, templates or folders a person wrote', () => {
    const broken = withValue(
      withValue(
        withValue(DOCUMENT, group(INNER, 'name'), 'private-person'),
        group(OUTER, 'parent'),
        inner.id,
      ),
      group(OUTER, 'policy', 'destination'),
      ['private-person', '..'],
    );
    const result = readProjectDocument(broken);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private-person');
    const cyclic = readProjectDocument(
      withValue(
        withValue(DOCUMENT, group(INNER, 'name'), 'private-person'),
        group(OUTER, 'parent'),
        inner.id,
      ),
    );
    expect(cyclic.ok ? [] : cyclic.failures.map(({ code }) => code)).toContain('game.group-cycle');
    expect(JSON.stringify(cyclic)).not.toContain('private-person');
  });
});

describe('the random states the round trips are held to', () => {
  it('hold game-audio state of every kind, so the round trips are not vacuous', () => {
    const totals = new Map<string, number>();
    const count = (key: string): void => {
      totals.set(key, (totals.get(key) ?? 0) + 1);
    };
    for (let seed = 1; seed <= 400; seed += 1) {
      const { gameAudio } = randomState(seed);
      if (gameAudio === undefined) continue;
      count('states');
      for (const one of gameAudio.groups.values()) {
        count('groups');
        if (one.parent !== undefined) count('nested');
        for (const field of POLICY_FIELDS)
          if (one.policy[field] !== undefined) count(`policy.${field}`);
      }
      for (const membership of gameAudio.memberships) {
        count(membership.member.kind === 'region' ? 'regionMembers' : 'assetMembers');
        count(membership.processing === 'inherit' ? 'inheriting' : 'owning');
        for (const field of Object.keys(membership.overrides)) count(`override.${field}`);
      }
    }
    const overridable = ['loudness', 'exportProfile', 'naming', 'destination', 'variation', 'bus'];
    const kinds = [
      ...['states', 'groups', 'nested', 'regionMembers', 'assetMembers', 'inheriting', 'owning'],
      ...POLICY_FIELDS.map((field) => `policy.${field}`),
      ...overridable.map((field) => `override.${field}`),
    ];
    for (const kind of kinds) expect(totals.get(kind) ?? 0, kind).toBeGreaterThan(20);
    expect([...totals.keys()].filter((kind) => !kinds.includes(kind))).toEqual([]);
  });
});
