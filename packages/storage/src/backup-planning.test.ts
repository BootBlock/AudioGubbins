import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';

import type { BackupPolicy, BackupRetention } from './backup-policy.js';
import {
  backupDue,
  planBackupPruning,
  type BackupGeneration,
  type BackupReason,
} from './backup-planning.js';
import { seededRandom } from './testing/seeded-random.js';
import { harness, madeProject, openToWrite } from './testing/storage-harness.js';
import { setName } from './testing/test-commands.js';

/**
 * When a generation is due and which ones retention keeps (REQ-STOR-105): a
 * generation follows changes, by time or by their number, never idleness; and
 * pruning never removes a protected or a manual generation, whatever the
 * limits, and removes only what some limit does not keep.
 */

const DAY = 86_400_000;

async function historyWithChanges(count: number) {
  const test = harness();
  const tree = new MemoryStorageTree();
  const header = await madeProject(test, tree);
  const session = await openToWrite(test, tree, header.id);
  for (let step = 0; step < count; step += 1) {
    expectSuccess(await session.run(setName(`Take ${String(step)}`)));
  }
  return session.getSnapshot().model.history;
}

function changeTimes(history: Awaited<ReturnType<typeof historyWithChanges>>): number[] {
  return [...history.nodes.values()]
    .filter((node) => node.kind === 'change')
    .map((node) => node.at)
    .sort((one, other) => one - other);
}

describe('when a backup generation is due (REQ-STOR-105)', () => {
  const policy = (trigger: { everyMinutes?: number; everyChanges?: number }): BackupPolicy => ({
    kind: 'automatic',
    trigger,
    retention: {},
  });

  it('makes none while nothing changed, however long the project stays open', async () => {
    const history = await historyWithChanges(0);
    expect(backupDue(policy({ everyMinutes: 1 }), history, undefined, 10 * DAY)).toBeUndefined();
  });

  it('makes one after the changes set, counted since the last generation', async () => {
    const history = await historyWithChanges(5);
    const times = changeTimes(history);
    expect(backupDue(policy({ everyChanges: 5 }), history, undefined, 0)).toBe('save');
    expect(backupDue(policy({ everyChanges: 5 }), history, times[0], 0)).toBeUndefined();
    expect(backupDue(policy({ everyChanges: 4 }), history, times[0], 0)).toBe('save');
  });

  it('makes one once the interval has passed since the last, with changes made', async () => {
    const history = await historyWithChanges(2);
    const [first = 0, last = 0] = changeTimes(history);
    const every = policy({ everyMinutes: 30 });
    expect(backupDue(every, history, undefined, first + 29 * 60_000)).toBeUndefined();
    expect(backupDue(every, history, undefined, first + 30 * 60_000)).toBe('time');
    expect(backupDue(every, history, last, last + 31 * 60_000)).toBeUndefined();
    expect(backupDue(every, history, first, first + 31 * 60_000)).toBe('time');
  });

  it('makes none where the policy is off', async () => {
    const history = await historyWithChanges(3);
    expect(backupDue({ kind: 'off' }, history, undefined, 10 * DAY)).toBeUndefined();
  });
});

describe('pruning backup generations (REQ-STOR-105, REQ-STOR-106)', () => {
  const REASONS: readonly BackupReason[] = ['time', 'save', 'manual'];

  it.each(Array.from({ length: 200 }, (_, index) => index + 1))(
    'never removes a protected or manual generation, and only what a limit does not keep: seed %i',
    (seed) => {
      const random = seededRandom(seed);
      const now = 100 * DAY;
      const generations: BackupGeneration[] = Array.from(
        { length: random.below(30) },
        (_, index) => ({
          number: index + 1,
          at: now - random.below(40) * DAY,
          reason: random.pick(REASONS) ?? 'time',
          bytes: random.below(1_000),
          protected: random.next() < 0.3,
        }),
      );
      const retention: BackupRetention = {
        ...(random.next() < 0.6 ? { count: random.below(10) + 1 } : {}),
        ...(random.next() < 0.5 ? { days: random.below(30) + 1 } : {}),
        ...(random.next() < 0.4 ? { bytes: random.below(8_000) + 1 } : {}),
      };
      const { removed, bytes } = planBackupPruning(generations, retention, now);

      for (const generation of removed) {
        expect(generation.protected).toBe(false);
        expect(generation.reason).not.toBe('manual');
      }
      expect(bytes).toBe(removed.reduce((sum, generation) => sum + generation.bytes, 0));

      const kept = generations.filter(
        (generation) =>
          !generation.protected && generation.reason !== 'manual' && !removed.includes(generation),
      );
      if (retention.count !== undefined) expect(kept.length).toBeLessThanOrEqual(retention.count);
      if (retention.days !== undefined) {
        for (const generation of kept) {
          expect(now - generation.at).toBeLessThanOrEqual(retention.days * DAY);
        }
      }
      if (retention.bytes !== undefined) {
        expect(kept.reduce((sum, generation) => sum + generation.bytes, 0)).toBeLessThanOrEqual(
          retention.bytes,
        );
      }
      // Pruning keeps the newest: nothing it keeps is older than something it
      // removed for the count or the budget alone.
      const newestRemovedInDays = removed
        .filter(
          (generation) =>
            retention.days === undefined || now - generation.at <= retention.days * DAY,
        )
        .reduce((most, generation) => Math.max(most, generation.number), 0);
      for (const generation of kept) expect(generation.number).toBeGreaterThan(newestRemovedInDays);
    },
  );

  it('keeps every generation where no limit is set', () => {
    const generations: BackupGeneration[] = [1, 2, 3].map((number) => ({
      number,
      at: number,
      reason: 'time',
      bytes: 10,
      protected: false,
    }));
    expect(planBackupPruning(generations, {}, DAY).removed).toEqual([]);
    expect(
      planBackupPruning(generations, { count: 1 }, DAY).removed.map(({ number }) => number),
    ).toEqual([2, 1]);
  });
});
