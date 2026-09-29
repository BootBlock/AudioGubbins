import { describe, expect, it } from 'vitest';

import { unsafeBrandId } from '@audiogubbins/domain';
import { MemoryStorageTree, nodeDigest } from '@audiogubbins/media-store/testing';

import { CheckedRecords } from './checked-records.js';
import { CommandJournal } from './command-journal.js';
import type { JournalEvent } from './journal-events.js';
import type { LeaseRecord } from './lease-records.js';
import { ProjectPaths } from './storage-layout.js';

const PROJECT = unsafeBrandId<'ProjectId'>('0000cccc-0000-4000-8000-000000000001');
const EVENT: JournalEvent = { kind: 'retention-policy', policy: { kind: 'unlimited' } };

async function journalOf(records: readonly (readonly [number, number])[]) {
  const tree = new MemoryStorageTree();
  const journal = new CommandJournal(new CheckedRecords(tree, nodeDigest), PROJECT);
  for (const [epoch, sequence] of records) await journal.append({ epoch, sequence }, EVENT);
  return { tree, journal, paths: new ProjectPaths(PROJECT) };
}

const OPEN_EPOCH_2: LeaseRecord = { epoch: 2, seals: [{ epoch: 1, lastSequence: 2 }] };

describe('the plan of a journal after a position (REQ-STOR-101)', () => {
  it('replays in order across epochs, and fences a sealed epoch’s records past its seal', async () => {
    const { journal } = await journalOf([
      [1, 1],
      [1, 2],
      [1, 3],
      [2, 1],
      [2, 2],
    ]);
    const plan = await journal.readAfter({ epoch: 1, sequence: 1 }, OPEN_EPOCH_2);
    expect(plan.readable).toEqual([
      { epoch: 1, sequence: 2 },
      { epoch: 2, sequence: 1 },
      { epoch: 2, sequence: 2 },
    ]);
    expect(plan.fenced).toEqual([{ epoch: 1, sequence: 3 }]);
    expect(plan.end()).toBeUndefined();
  });

  it('stops where the numbering breaks off, and names every record past the break', async () => {
    const { journal } = await journalOf([
      [2, 1],
      [2, 3],
      [2, 4],
    ]);
    const plan = await journal.readAfter({ epoch: 2, sequence: 0 }, OPEN_EPOCH_2);
    expect(plan.readable).toEqual([{ epoch: 2, sequence: 1 }]);
    expect(plan.end()).toEqual({
      at: { epoch: 2, sequence: 2 },
      reason: { kind: 'missing' },
      discarded: [
        { epoch: 2, sequence: 3 },
        { epoch: 2, sequence: 4 },
      ],
    });
  });

  it('treats a sealed epoch missing records up to its seal as a break', async () => {
    const { journal } = await journalOf([
      [1, 1],
      [2, 1],
    ]);
    const plan = await journal.readAfter({ epoch: 1, sequence: 0 }, OPEN_EPOCH_2);
    expect(plan.readable).toEqual([{ epoch: 1, sequence: 1 }]);
    expect(plan.end()).toMatchObject({
      at: { epoch: 1, sequence: 2 },
      discarded: [{ epoch: 2, sequence: 1 }],
    });
  });

  it('never replays an epoch newer than the lease', async () => {
    const { journal } = await journalOf([[3, 1]]);
    const plan = await journal.readAfter({ epoch: 2, sequence: 0 }, OPEN_EPOCH_2);
    expect(plan.readable).toEqual([]);
    expect(plan.fenced).toEqual([{ epoch: 3, sequence: 1 }]);
  });

  it('breaks at a record replay refused, discarding it and all after', async () => {
    const { journal } = await journalOf([
      [2, 1],
      [2, 2],
      [2, 3],
    ]);
    const plan = await journal.readAfter({ epoch: 2, sequence: 0 }, OPEN_EPOCH_2);
    expect(plan.breakAt({ epoch: 2, sequence: 2 }, { kind: 'missing' }).discarded).toEqual([
      { epoch: 2, sequence: 2 },
      { epoch: 2, sequence: 3 },
    ]);
  });
});

describe('pruning a journal behind a checkpoint', () => {
  it('removes what the checkpoint includes and sets aside what no checkpoint does', async () => {
    const { tree, journal, paths } = await journalOf([
      [1, 1],
      [1, 2],
      [1, 3],
      [2, 1],
      [2, 2],
    ]);
    await journal.prune({ epoch: 2, sequence: 1 }, OPEN_EPOCH_2);
    expect(tree.paths()).toEqual(
      [`${paths.epoch(2)}/000000000002.json`, paths.quarantined(1, 3)].sort(),
    );
  });
});
