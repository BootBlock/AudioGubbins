/**
 * Who writes each project, served to the page: the window holding a project's
 * lease, and each change of it, sent on the project's own stream while the
 * page listens (REQ-STOR-098).
 *
 * The page subscribes once for each listener it has, so the lease coordinator
 * is watched once a project, from its first listener until its last
 * unsubscribes. Where the platform has no coordination, no project has a
 * writer to tell of, and nothing is sent.
 */

import type { ProjectId } from '@audiogubbins/domain';
import type { LeaseCoordinator } from '@audiogubbins/storage';

import {
  ownershipStream,
  type AreaHandlers,
  type HostChannel,
} from '../protocol/storage-operations.js';

/** A project watched, and how many listeners on the page it is watched for. */
interface Watch {
  listeners: number;
  readonly stop: () => void;
}

/** The ownership operations, over the coordinator, sending on `channel`. */
export function ownershipHandlers(
  coordinator: LeaseCoordinator | undefined,
  channel: HostChannel,
): AreaHandlers<'ownership'> {
  const watches = new Map<ProjectId, Watch>();
  const subscribe = (project: ProjectId): void => {
    const watch = watches.get(project);
    if (watch !== undefined) {
      watch.listeners += 1;
      return;
    }
    if (coordinator === undefined) return;
    const stop = coordinator.watchOwnership(project, (event) => {
      channel.emit(ownershipStream(project), event);
    });
    watches.set(project, { listeners: 1, stop });
  };
  const unsubscribe = (project: ProjectId): void => {
    const watch = watches.get(project);
    if (watch === undefined) return;
    watch.listeners -= 1;
    if (watch.listeners > 0) return;
    watches.delete(project);
    watch.stop();
  };
  return {
    'ownership.ownerOf': async (project) => await coordinator?.ownerOf(project),
    'ownership.subscribe': (project) => {
      subscribe(project);
      return Promise.resolve(undefined);
    },
    'ownership.unsubscribe': (project) => {
      unsubscribe(project);
      return Promise.resolve(undefined);
    },
  };
}
