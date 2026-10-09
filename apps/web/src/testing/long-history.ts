/**
 * Long histories for the tests of the History panel, and a count of the points
 * a test reads of one, so a test can hold the panel to reading what it shows.
 */

import { commandId } from '@audiogubbins/commands';
import { createDeterministicIdGenerator, unsafeBrandId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { changeNodeOf, recordChange, startHistory, type History } from '@audiogubbins/history';
import type { HistoryNodeId } from '@audiogubbins/project-format';

/** A history of `changes` changes in one line, each renaming the project. */
export function longHistory(changes: number): History {
  const ids = createDeterministicIdGenerator(5);
  let history = startHistory(unsafeBrandId<'ProjectId'>('00000000-0000-4000-8000-00000000a0a0'), {
    kind: 'origin',
    id: ids.next<'HistoryNodeId'>(),
    at: 1_790_000_000_000,
    origin: { kind: 'new' },
  });
  for (let step = 1; step <= changes; step += 1) {
    const invocation = { commandId: commandId('project.rename'), arguments: { name: 'x' } };
    const node = changeNodeOf(history, {
      id: ids.next<'HistoryNodeId'>(),
      at: 1_790_000_000_000 + step,
      entry: {
        description: `Change ${String(step)}`,
        forward: [invocation],
        inverse: [invocation],
      },
      affects: {
        assets: [],
        tracks: [],
        buses: [],
        clips: [],
        regions: [],
        markers: [],
        effectChains: [],
        takeStacks: [],
        project: true,
      },
    });
    history = expectSuccess(recordChange(history, node));
  }
  return history;
}

/** A history whose points are counted as they are read, one by one or all in turn. */
export interface CountedHistory {
  readonly history: History;

  /** How many points were read since the count began or was last started again. */
  reads(): number;
  restart(): void;
}

/** `history`, its points counted as they are read. */
export function countedHistory(history: History): CountedHistory {
  let reads = 0;
  const counting = function* <TItem>(items: Iterable<TItem>): Generator<TItem> {
    for (const item of items) {
      reads += 1;
      yield item;
    }
  };
  const nodes = new Proxy(history.nodes, {
    get(target, key, receiver) {
      const member: unknown = Reflect.get(target, key, receiver);
      switch (key) {
        case 'get':
          return (id: HistoryNodeId) => {
            reads += 1;
            return target.get(id);
          };
        case 'values':
          return () => counting(target.values());
        case 'entries':
          return () => counting(target.entries());
        default:
          return member;
      }
    },
  });
  return {
    history: { ...history, nodes },
    reads: () => reads,
    restart: () => {
      reads = 0;
    },
  };
}
