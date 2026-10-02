import { describe, expect, it } from 'vitest';

import type { Logger, LogFields } from '@audiogubbins/diagnostics';
import type { LeaseCoordinator, LeaseOwner, ProjectWriteLease } from '@audiogubbins/storage';
import { describeWriteLeaseScenarios, type LeaseWindows } from '@audiogubbins/storage/testing';
import { emptyProject } from '@audiogubbins/test-fixtures';

import type { OpenLeaseChannel } from './project-channels.js';
import { MemoryBroadcast, settled } from './testing/memory-broadcast.js';
import { MemoryLocks } from './testing/memory-locks.js';
import type { LeaseLocks } from './lock-manager.js';
import { createLeaseCoordinator, type WebLeaseServices } from './web-lock-leases.js';
import { webDigest } from './web-digest.js';

/**
 * The lease coordinator over Web Locks and broadcast channels, driven through
 * the storage's single-writer scenarios and through what only the browser can
 * do to it: a window that cannot answer, a lock manager that refuses, a channel
 * closed under the page and a lock dropped by the browser (REQ-STOR-098).
 */

interface Logged {
  readonly severity: 'error' | 'warning' | 'info' | 'debug' | 'trace';
  readonly message: string;
  readonly fields: LogFields | undefined;
}

function recordingLogger(logged: Logged[]): Logger {
  const logger: Logger = {
    category: 'storage',
    error: (message, fields) => logged.push({ severity: 'error', message, fields }),
    warning: (message, fields) => logged.push({ severity: 'warning', message, fields }),
    info: (message, fields) => logged.push({ severity: 'info', message, fields }),
    debug: (message, fields) => logged.push({ severity: 'debug', message, fields }),
    trace: (message, fields) => logged.push({ severity: 'trace', message, fields }),
    measured: () => undefined,
    forOperation: () => logger,
  };
  return logger;
}

/** A profile's windows over one lock manager and one set of channels. */
class Profile implements LeaseWindows {
  readonly locks = new MemoryLocks();
  readonly broadcast = new MemoryBroadcast();
  readonly logged: Logged[] = [];
  readonly #windows = new Map<string, LeaseCoordinator>();

  coordinatorFor(owner: LeaseOwner): LeaseCoordinator {
    return this.window(owner);
  }

  /** A window's coordinator, made once, and made without channels where it is `mute`. */
  window(
    owner: LeaseOwner,
    channels: 'broadcast' | 'mute' = 'broadcast',
    patience: () => Promise<void> = settled,
  ): LeaseCoordinator {
    const known = this.#windows.get(owner.instance);
    if (known !== undefined) return known;
    const openChannel = channels === 'mute' ? undefined : this.broadcast.open;
    const made = createLeaseCoordinator({
      ...this.services(owner.instance, openChannel),
      patience,
    });
    if (made === undefined) throw new Error('A profile with Web Locks made no coordinator.');
    this.#windows.set(owner.instance, made);
    return made;
  }

  services(instance: string, openChannel: OpenLeaseChannel | undefined): WebLeaseServices {
    return {
      locks: this.locks,
      openChannel,
      instance,
      patience: settled,
      logger: recordingLogger(this.logged),
    };
  }

  settle(): Promise<void> {
    return settled();
  }
}

describeWriteLeaseScenarios('Web Locks and broadcast channels', {
  windows: () => new Profile(),
  uncoordinated: () =>
    createLeaseCoordinator({ ...new Profile().services('window-a', undefined), locks: undefined }),
  refusing: () => {
    const profile = new Profile();
    profile.locks.refusal = { error: new DOMException('Denied.', 'SecurityError'), thrown: false };
    return profile.window({ instance: 'window-a', label: 'Window A' });
  },
  digest: webDigest(crypto.subtle),
});

const PROJECT = emptyProject().id;
const LOCK = `audiogubbins.project.${PROJECT}`;
const A: LeaseOwner = { instance: 'window-a', label: 'Another AudioGubbins tab' };
const B: LeaseOwner = { instance: 'window-b', label: 'Another AudioGubbins tab' };

async function held(coordinator: LeaseCoordinator, owner: LeaseOwner): Promise<ProjectWriteLease> {
  const acquired = await coordinator.acquire(PROJECT, { steal: false, owner });
  if (acquired.kind !== 'held') throw new Error('Expected the lease to be held.');
  return acquired.lease;
}

/** A window's patience, which runs out only once the test opens it. */
function gatedPatience(): { readonly patience: () => Promise<void>; readonly open: () => void } {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {
    patience: () => opened,
    open: () => {
      open();
    },
  };
}

/** What a promise has settled to once everything under way has, or that it is still waiting. */
function settledTo<T>(promise: Promise<T>): Promise<T | 'still waiting'> {
  return Promise.race([promise, settled().then((): 'still waiting' => 'still waiting')]);
}

function warnings(profile: Profile): readonly string[] {
  return profile.logged.filter((entry) => entry.severity === 'warning').map((e) => e.message);
}

describe('the Web Locks lease coordinator (REQ-STOR-098)', () => {
  it('fits the lock manager and channel constructor the platform reads', () => {
    const fits = (locks: LockManager, open: (name: string) => BroadcastChannel) => {
      const taken: { locks: LeaseLocks; open: OpenLeaseChannel } = { locks, open };
      return taken;
    };
    expect(fits).toBeTypeOf('function');
  });

  it('is busy without an owner where the writing window cannot answer', async () => {
    const profile = new Profile();
    await held(profile.window(A, 'mute'), A);
    const acquired = await profile.window(B).acquire(PROJECT, { steal: false, owner: B });
    expect(acquired).toEqual({ kind: 'busy' });
    expect(await profile.window(B).ownerOf(PROJECT)).toBeUndefined();
  });

  it('tells no owner, and asks nobody, for a project no window writes', async () => {
    const profile = new Profile();
    expect(await profile.window(B).ownerOf(PROJECT)).toBeUndefined();
    expect(profile.broadcast.posted).toEqual([]);
  });

  it('leaves the owner unidentified, not failed, where the browser closed its channels', async () => {
    const profile = new Profile();
    await held(profile.window(A), A);
    profile.broadcast.closeAll();
    expect(await profile.window(B).acquire(PROJECT, { steal: false, owner: B })).toEqual({
      kind: 'busy',
    });
  });

  it.each([true, false])(
    'reports every lock unavailable where the lock manager refuses (thrown: %s)',
    async (thrown) => {
      const profile = new Profile();
      profile.locks.refusal = { error: new DOMException('Denied.', 'SecurityError'), thrown };
      expect(await profile.window(A).acquire(PROJECT, { steal: false, owner: A })).toEqual({
        kind: 'unavailable',
      });
      expect(await profile.window(A).acquire(PROJECT, { steal: true, owner: A })).toEqual({
        kind: 'unavailable',
      });
      expect(await profile.window(A).lockStorage('exclusive', { wait: false })).toEqual({
        kind: 'unavailable',
      });
      expect(warnings(profile)).toContain(
        'The browser refused the project’s lock, so this window does not write it.',
      );
    },
  );

  it('loses the lease where the browser drops the lock, logging why', async () => {
    const profile = new Profile();
    const lease = await held(profile.window(A), A);
    profile.locks.drop(LOCK, new DOMException('Gone.', 'InvalidStateError'));
    expect(await lease.lost).toEqual({ kind: 'taken' });
    expect(warnings(profile)).toContain('The browser let a held project’s lock go.');
    expect(await profile.window(A).ownerOf(PROJECT)).toBeUndefined();
  });

  it('names the window that took the project where its notice comes after the steal', async () => {
    const profile = new Profile();
    const patience = gatedPatience();
    const lease = await held(profile.window(A, 'broadcast', patience.patience), A);
    profile.broadcast.holdBack();
    const taking = await profile.window(B).acquire(PROJECT, { steal: true, owner: B });
    expect(taking.kind).toBe('held');
    await settled();
    profile.broadcast.letThrough();
    expect(await settledTo(lease.lost)).toEqual({ kind: 'taken', by: B });
  });

  it('reports the loss unnamed once the patience runs out where the taker cannot be described', async () => {
    const profile = new Profile();
    const patience = gatedPatience();
    const lease = await held(profile.window(A, 'broadcast', patience.patience), A);
    await profile.window(B, 'mute').acquire(PROJECT, { steal: true, owner: B });
    await settled();
    patience.open();
    expect(await settledTo(lease.lost)).toEqual({ kind: 'taken' });
    expect(await profile.window(A).ownerOf(PROJECT)).toBeUndefined();
  });

  it('grants a request once the writer lets the project go without answering', async () => {
    const profile = new Profile();
    const lease = await held(profile.window(A), A);
    const asked = profile.window(B).requestTransfer(PROJECT, B);
    await settled();
    await lease.release();
    expect(await asked).toBe('granted');
    expect((await profile.window(B).acquire(PROJECT, { steal: false, owner: B })).kind).toBe(
      'held',
    );
  });

  it('settles a request unreachable at once where no channel can carry it', async () => {
    const profile = new Profile();
    await held(profile.window(A), A);
    expect(await profile.window(B, 'mute').requestTransfer(PROJECT, B)).toBe('unreachable');
    expect(warnings(profile)).toContain('A request for a project could not reach its writer.');
  });

  it('tells a watching window of a checkpoint and of the writer letting the project go', async () => {
    const profile = new Profile();
    const heard: string[] = [];
    const stop = profile.window(B).watchOwnership(PROJECT, (event) => heard.push(event.kind));
    const lease = await held(profile.window(A), A);
    lease.announceCheckpoint();
    await settled();
    await lease.release();
    await settled();
    lease.announceCheckpoint();
    await settled();
    stop();
    expect(heard).toEqual(['acquired', 'checkpointed', 'released']);
  });

  it('has let the lock go by the time a release settles', async () => {
    const profile = new Profile();
    const lease = await held(profile.window(A), A);
    await lease.release();
    expect((await profile.window(B).acquire(PROJECT, { steal: false, owner: B })).kind).toBe(
      'held',
    );
  });

  it('grants a request where no window writes the project', async () => {
    const profile = new Profile();
    expect(await profile.window(B).requestTransfer(PROJECT, B)).toBe('granted');
  });

  it('answers a request made in the writing window itself', async () => {
    const profile = new Profile();
    const lease = await held(profile.window(A), A);
    const heard: string[] = [];
    lease.onTransferRequest((request) => {
      heard.push(request.from.instance);
      void profile.window(A).answerTransfer(PROJECT, request, 'declined');
    });
    expect(await profile.window(A).requestTransfer(PROJECT, B)).toBe('declined');
    expect(heard).toEqual(['window-b']);
  });

  it('stops listening once the lease and its questions are done', async () => {
    const profile = new Profile();
    const lease = await held(profile.window(A), A);
    expect(await profile.window(B).ownerOf(PROJECT)).toEqual(A);
    expect(profile.broadcast.openCount).toBe(1);
    await lease.release();
    expect(profile.broadcast.openCount).toBe(0);
  });
});
