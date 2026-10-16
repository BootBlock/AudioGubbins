/**
 * The runtime bus a member plays on, by name (ADR-0101): a bus as a game engine
 * knows it, not one of the editor's own. The preview routes each voice by it,
 * and an engine integration maps it to the engine's bus of that name.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type Branded,
  type DomainResult,
} from '@audiogubbins/domain';

/** 1 to 64 characters, NFC, no control character. */
export type BusName = Branded<'BusName'>;

/** The most characters, in UTF-16 code units, a bus's name holds. */
const LONGEST_BUS_NAME = 64;

const CONTROL_CHARACTER = /\p{Cc}/u;

function problemOf(text: string): string | undefined {
  const characters = text.length;
  if (characters === 0 || characters > LONGEST_BUS_NAME) {
    return `A bus's name is 1 to ${String(LONGEST_BUS_NAME)} characters long; this one is ${String(characters)}.`;
  }
  if (CONTROL_CHARACTER.test(text)) return "A bus's name holds no control character.";
  if (text.normalize('NFC') !== text) return "A bus's name is written in Unicode's NFC form.";
  return undefined;
}

/** `text` as a bus's name, or why it is not one. */
export function busName(text: string): DomainResult<BusName> {
  const problem = problemOf(text);
  if (problem !== undefined) {
    return fail(failure('game.bus-name-invalid', FailureKind.Rejected, problem));
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- a brand is minted here, after the checks above
  return succeed(text as BusName);
}
