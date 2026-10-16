/**
 * The preview scenarios that play a group or a member (ADR-0104, ADR-0106),
 * so a command that would leave an emitter playing nothing is refused naming
 * the scenario, rather than changing a scenario the person did not touch.
 *
 * A member subject is a member of a group, played by its group's rules, so a
 * member leaving its group, or its region or asset leaving the project, would
 * leave its emitter playing nothing, as would its group's removal. The person
 * takes it out of the scenario first; one undoable step never edits a
 * scenario as a side effect of a change elsewhere.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import {
  memberKey,
  type GameAudioState,
  type GamePreviewScenario,
  type PreviewSubject,
} from '@audiogubbins/game-audio';
import { quoted } from '@audiogubbins/text';

function samePlayed(one: PreviewSubject, other: PreviewSubject): boolean {
  if (one.kind === 'group') return other.kind === 'group' && one.group === other.group;
  return other.kind === 'member' && memberKey(one.member) === memberKey(other.member);
}

function plays(scenario: GamePreviewScenario, subject: PreviewSubject): boolean {
  return scenario.emitters.some((emitter) => samePlayed(emitter.subject, subject));
}

/**
 * Nothing, where no scenario of `game` plays `subject`; otherwise a refusal
 * naming the first that does, `words` saying what is played and `change` what
 * would be done to it.
 */
export function unplayed(
  game: GameAudioState,
  subject: PreviewSubject,
  words: string,
  change: string,
): DomainResult<undefined> {
  const scenario = [...game.scenarios.values()].find((one) => plays(one, subject));
  if (scenario === undefined) return succeed(undefined);
  return fail(
    failure(
      'game.subject-played',
      FailureKind.Rejected,
      `The preview scenario ${quoted(scenario.name)} plays ${words}, so it cannot be ${change}; take it out of the scenario first.`,
      { details: { scenario: scenario.id } },
    ),
  );
}
