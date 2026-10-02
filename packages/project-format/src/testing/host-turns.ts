/**
 * Hosts for the tests of work that takes turns: one that never keeps the work
 * waiting, and one that counts the turns asked of it, so a test can see a
 * loop ask while it runs and give the work up at a chosen turn.
 */

import type { YieldToHost } from '../work-turns.js';

/** A host whose every turn is given back at once. */
export const immediateTurns: YieldToHost = () => Promise.resolve();

/** A host that counts the turns asked of it. */
export interface CountedTurns {
  readonly yieldToHost: YieldToHost;

  /** How many turns were asked so far. */
  readonly asked: number;
}

/** A host that counts its turns, telling `onTurn` the count as each is asked. */
export function countedTurns(onTurn: (asked: number) => void = () => undefined): CountedTurns {
  let asked = 0;
  return {
    yieldToHost: () => {
      asked += 1;
      onTurn(asked);
      return Promise.resolve();
    },
    get asked() {
      return asked;
    },
  };
}
