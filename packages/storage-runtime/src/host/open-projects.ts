/**
 * The projects the page has open in the storage worker, by the handle it
 * named each with, and the updates each sends it (ADR-0022).
 *
 * A project held here is heard from as it is held, and each snapshot it
 * publishes after is sent on its stream as the update from the project last
 * sent, so the page's copy follows every change in order. The history it opens
 * with is sent in slices: every slice but the last on the handle's opening
 * stream, as it is held, and the last in the update it opens with, so the page
 * has the whole history once that update arrives. A handle names one project
 * from its opening until it is released, and is never named again: a call
 * naming one not held is the page's defect, and fails as one.
 */

import type { ProjectState } from '@audiogubbins/project-format';
import type { OpenedProject, ProjectSession, ReadOnlyProject } from '@audiogubbins/storage';

import {
  openingStream,
  projectStream,
  type HeldOpening,
  type ProjectHandle,
} from '../protocol/project-operations.js';
import type { HostChannel } from '../protocol/storage-operations.js';
import { firstUpdate, historySlices, updateSince } from './project-updates.js';

/** A project held, and how to stop hearing it. */
interface Held {
  readonly opened: OpenedProject;
  readonly stopHearing: () => void;
}

/** What a session and a view both offer: their snapshots. */
type Published = Pick<ProjectSession, 'subscribe' | 'getSnapshot'>;

function publisherOf(opened: OpenedProject): Published {
  return opened.kind === 'writable' ? opened.session : opened.view;
}

/** The projects open in the worker (see the module comment). */
export class OpenProjects {
  readonly #channel: HostChannel;
  readonly #held = new Map<ProjectHandle, Held>();

  constructor(channel: HostChannel) {
    this.#channel = channel;
  }

  /**
   * Holds a project opened under `handle`, sends the leading slices of its
   * history, and gives the update it opens with.
   */
  hold(handle: ProjectHandle, opened: OpenedProject): HeldOpening {
    if (this.#held.has(handle)) {
      throw new Error(`A project is already open as handle ${String(handle)}.`);
    }
    const published = publisherOf(opened);
    const opening = published.getSnapshot();
    let sent = opening.model;
    const stopHearing = published.subscribe(() => {
      const snapshot = published.getSnapshot();
      this.#channel.emit(projectStream(handle), updateSince(sent, snapshot));
      sent = snapshot.model;
    });
    this.#held.set(handle, { opened, stopHearing });
    const first = firstUpdate(opening);
    const slices = historySlices(first.history);
    const last = slices.pop() ?? first.history;
    for (const slice of slices) this.#channel.emit(openingStream(handle), slice);
    return { first: { ...first, history: last }, slices: slices.length };
  }

  /** The project open under `handle`, where one is. */
  find(handle: ProjectHandle): OpenedProject | undefined {
    return this.#held.get(handle)?.opened;
  }

  /** The session open under `handle`. */
  session(handle: ProjectHandle): ProjectSession {
    const opened = this.find(handle);
    if (opened?.kind !== 'writable') throw notHeld(handle, 'to write');
    return opened.session;
  }

  /** The view open under `handle`. */
  view(handle: ProjectHandle): ReadOnlyProject {
    const opened = this.find(handle);
    if (opened?.kind !== 'read-only') throw notHeld(handle, 'to read');
    return opened.view;
  }

  /** Stops hearing the project open under `handle`, and forgets it. */
  release(handle: ProjectHandle): void {
    this.#held.get(handle)?.stopHearing();
    this.#held.delete(handle);
  }

  /** The state each project open is in now. */
  states(): ProjectState[] {
    return [...this.#held.values()].map(
      ({ opened }) => publisherOf(opened).getSnapshot().model.state,
    );
  }
}

function notHeld(handle: ProjectHandle, how: string): Error {
  return new Error(`No project is open ${how} as handle ${String(handle)}.`);
}
