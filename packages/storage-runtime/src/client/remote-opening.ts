/**
 * Hearing a project the worker begins to hold under a handle the page named:
 * its history's leading slices, then its first update, then each update after
 * (ADR-0022, REQ-STOR-021).
 *
 * The page hears the handle's streams from before it asks, so nothing the
 * worker sends once it holds the project is missed. Each slice of the history
 * is applied as it arrives, in a task of its own, so no one task of the page
 * holds a long history; the copy is made once the answer brings the last
 * slice, and the updates that arrived before it are applied to it in order. An
 * ask abandoned by its signal stops hearing, and tells the worker to let go of
 * the project should it hold it all the same.
 */

import { succeed, type DomainResult, type ProjectId } from '@audiogubbins/domain';
import { applyHistoryDelta, type History } from '@audiogubbins/history';

import {
  openingStream,
  projectStream,
  type HeldOpening,
  type ProjectHandle,
  type ProjectUpdate,
} from '../protocol/project-operations.js';
import type { ClientChannel } from '../protocol/storage-operations.js';
import { ProjectMirror } from './project-mirror.js';
import type { RemoteParts } from './remote-project.js';

/** What the worker answered, and the parts of the project it holds, where it holds one. */
export interface Held<TAnswer> {
  readonly answer: TAnswer;
  readonly parts: RemoteParts;
}

/**
 * Asks the worker, with `ask`, to hold `project` under `handle`, and hears it
 * from before it asks (see the module comment).
 */
export async function heldUnder<TAnswer extends HeldOpening>(
  channel: ClientChannel,
  handle: ProjectHandle,
  project: ProjectId,
  ask: () => Promise<DomainResult<TAnswer>>,
  signal?: AbortSignal,
): Promise<DomainResult<Held<TAnswer>>> {
  const early: ProjectUpdate[] = [];
  let hear = (update: ProjectUpdate): void => {
    early.push(update);
  };
  const stopHearing = channel.listen(projectStream(handle), (update) => {
    hear(update);
  });
  let sliced: History | undefined;
  let slices = 0;
  const stopSlices = channel.listen(openingStream(handle), (slice) => {
    sliced = applyHistoryDelta(sliced, slice);
    slices += 1;
  });
  let answered: DomainResult<TAnswer> | undefined;
  try {
    answered = await ask();
  } finally {
    stopSlices();
    if (answered?.ok !== true) stopHearing();
    if (answered === undefined && signal?.aborted === true) {
      await channel.call('projects.abandon', { handle });
    }
  }
  if (!answered.ok) return answered;

  const { first } = answered.value;
  if (slices !== answered.value.slices) {
    throw new Error(
      `The history arrived in ${String(slices)} of its ${String(answered.value.slices)} slices.`,
    );
  }
  const mirror = new ProjectMirror(project, first, sliced);
  for (const update of early) mirror.apply(update);
  hear = (update) => {
    mirror.apply(update);
  };
  return succeed({ answer: answered.value, parts: { channel, handle, mirror, stopHearing } });
}
