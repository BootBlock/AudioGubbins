/**
 * Asking the other windows of a browser profile who writes a project
 * (REQ-STOR-098). The question goes out on the project's channel and the
 * window holding its lock answers who it is; one that has not answered once
 * the patience runs out is taken to be a window that cannot be described.
 */

import type { LeaseOwner } from '@audiogubbins/storage';

import type { LeaseMessage } from './lease-messages.js';
import type { ProjectChannels } from './project-channels.js';

/** What a question is put through, each made once by the coordinator. */
export interface OwnerAsking {
  readonly channels: ProjectChannels;

  /** Settles once a question has waited long enough for an answer. */
  readonly patience: () => Promise<void>;
}

/**
 * Asks who writes the project of channel `name`, answering the owner its
 * writer names or `heard` reads from another message, whichever comes first,
 * and `undefined` once the patience runs out or where no channel can ask.
 */
export async function askOwner(
  asking: OwnerAsking,
  name: string,
  question: string,
  heard: (message: LeaseMessage) => LeaseOwner | undefined,
): Promise<LeaseOwner | undefined> {
  const { channels, patience } = asking;
  let stop: () => void = () => undefined;
  const answered = new Promise<LeaseOwner | undefined>((resolve) => {
    stop = channels.listen(name, (message) => {
      const owner =
        message.kind === 'owner' && message.question === question ? message.owner : heard(message);
      if (owner !== undefined) resolve(owner);
    });
    if (!channels.post(name, { kind: 'who-owns', question })) resolve(undefined);
  });
  const owner = await Promise.race([answered, patience().then(() => undefined)]);
  stop();
  return owner;
}
