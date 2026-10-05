/**
 * The file behind each asset of the open project, as the page holds it for
 * the audio threads to read (ADR-0052).
 *
 * Media kept in the project is a sealed object of the store, asked of the
 * storage worker once by its content and kept while the project is open, since
 * it never changes. A linked file is found through the handle AudioGubbins kept
 * for it, and only once the project's linked files were looked at to the end
 * with no change waiting for it, so the file read is the one the project
 * recorded (REQ-STOR-053): one that changed or went stays unavailable until the
 * person answers the question about it, and the answer changes the project,
 * which is looked at again here. A project open only to read has its linked
 * files looked at by no one, so they are not read. Files are asked for a few at
 * a time, in the order the project names them, so a project of many assets does
 * not ask for every file at once. Everything asked for is given up when the
 * project is let go, and what was still to be asked is never asked.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import type { AssetId, DomainResult } from '@audiogubbins/domain';
import type { MediaSource } from '@audiogubbins/project-format';
import type { MediaClient, RemoteProjectSession } from '@audiogubbins/storage-runtime';

import type { MediaAvailability } from '../assets/project-assets.js';
import { absenceOf, type LinkedFilesPort } from '../io/linked-files.js';
import { isAbandoned } from './abandoning.js';
import { observable, type Observable } from './observable.js';
import type { OpenProjectStore } from './open-project-store.js';
import type { SourceChangeStore } from './source-change-store.js';

/** What the page holds of each asset's file, by asset. */
export type ProjectMediaState = ReadonlyMap<AssetId, MediaAvailability>;

const FINDING: MediaAvailability = { kind: 'finding' };

const READ_ONLY: MediaAvailability = {
  kind: 'unavailable',
  reason: 'This tab only reads the project, so the files it links to are not opened here.',
};

const CHANGED: MediaAvailability = {
  kind: 'unavailable',
  reason:
    'The file it is linked to is no longer the one the project recorded. Answer the question about it first.',
};

/**
 * How many files are asked for at once: enough that one slow file holds up
 * few others, and few enough that a project of many assets does not ask the
 * storage worker and the browser for every file together (`CLAUDE.md` G4).
 */
const FILES_ASKED_AT_ONCE = 4;

/** A file to ask for: what it is held as, the project it is for, and how it is asked. */
interface FileAsk {
  readonly key: string;
  readonly scope: AbortSignal;
  readonly ask: () => Promise<DomainResult<Blob> | MediaAvailability>;
}

/** Why a linked file could not be read, by why its handle gave none. */
const ABSENT: Readonly<Record<ReturnType<typeof absenceOf>, string>> = {
  'not-found': 'The file it is linked to could not be found.',
  'access-needed': 'AudioGubbins needs your leave to read the file it is linked to.',
  'permission-refused': 'Leave to read the file it is linked to was refused.',
  unreadable: 'The file it is linked to could not be read.',
};

/** The files behind the open project's assets. */
export class ProjectMediaStore implements Observable<ProjectMediaState> {
  private readonly media: Pick<MediaClient, 'file'>;
  private readonly project: OpenProjectStore;
  private readonly sources: SourceChangeStore;
  private readonly linkedFiles: LinkedFilesPort;
  private readonly logger: Logger;

  /** Each file asked for while the project is open, by what it is. */
  private readonly held = new Map<string, MediaAvailability>();

  /** The project the files held are of, which they are let go with. */
  private heldFor: AbortSignal | undefined;

  /** The files still to be asked for, in order, and how many are being asked for now. */
  private readonly toAsk: FileAsk[] = [];
  private asking = 0;
  private readonly state = observable<ProjectMediaState>(new Map());

  readonly get = this.state.get;
  readonly subscribe = this.state.subscribe;

  constructor(parts: {
    readonly media: Pick<MediaClient, 'file'>;
    readonly project: OpenProjectStore;
    readonly sources: SourceChangeStore;
    readonly linkedFiles: LinkedFilesPort;
    readonly logger: Logger;
  }) {
    this.media = parts.media;
    this.project = parts.project;
    this.sources = parts.sources;
    this.linkedFiles = parts.linkedFiles;
    this.logger = parts.logger;
    this.project.subscribe(this.follow);
    this.sources.subscribe(this.follow);
  }

  /** What the page holds of `asset`'s file. */
  readonly of = (asset: AssetId): MediaAvailability => this.state.get().get(asset) ?? FINDING;

  /** Asks for every file the open project's assets need, and says what is held. */
  private readonly follow = (): void => {
    const open = this.project.get();
    const scope = this.project.scope();
    if (this.heldFor !== scope) {
      this.held.clear();
      this.heldFor = scope;
    }
    const next = new Map<AssetId, MediaAvailability>();
    if (open.kind === 'open') {
      const session = this.project.session();
      for (const [asset, { media }] of open.snapshot.model.state.sources) {
        next.set(asset, this.availability(asset, media, session, scope));
      }
    }
    const current = this.state.get();
    const same =
      current.size === next.size &&
      [...next].every(([asset, availability]) => current.get(asset) === availability);
    if (!same) this.state.set(next);
  };

  private availability(
    asset: AssetId,
    media: MediaSource,
    session: RemoteProjectSession | undefined,
    scope: AbortSignal,
  ): MediaAvailability {
    if (media.kind === 'managed') {
      return this.asked(`managed:${media.contentId}`, scope, () =>
        this.media.file(media.contentId, scope),
      );
    }
    if (session === undefined) return READ_ONLY;
    if (!this.sources.hasLooked(session)) return FINDING;
    if (this.sources.get().changes.some((change) => change.asset === asset)) return CHANGED;
    return this.asked(`linked:${asset}:${JSON.stringify(media.identity)}`, scope, () =>
      this.linkedFile(media, scope),
    );
  }

  /** The file behind `key`, asked for once by `ask` in its turn, said when it settles. */
  private asked(key: string, scope: AbortSignal, ask: FileAsk['ask']): MediaAvailability {
    const held = this.held.get(key);
    if (held !== undefined) return held;
    this.held.set(key, FINDING);
    this.toAsk.push({ key, scope, ask });
    this.askNext();
    return FINDING;
  }

  /** Asks for the files waiting, up to the number asked for at once. */
  private askNext(): void {
    while (this.asking < FILES_ASKED_AT_ONCE) {
      const next = this.toAsk.shift();
      if (next === undefined) return;
      // Waiting for a project since let go, it is never asked for.
      if (next.scope.aborted) continue;
      this.asking += 1;
      void this.answer(next).finally(() => {
        this.asking -= 1;
        this.askNext();
      });
    }
  }

  /** Asks for one file, and holds and says what it came to. */
  private async answer({ key, scope, ask }: FileAsk): Promise<void> {
    let availability: MediaAvailability;
    try {
      availability = availabilityOf(await ask());
    } catch (error) {
      if (isAbandoned(error) || this.heldFor !== scope) return;
      const reason = error instanceof Error ? error.message : 'No reason was given.';
      this.logger.error('The file of an asset could not be read.', { reason });
      availability = { kind: 'unavailable', reason: 'Its file could not be read.' };
    }
    if (this.heldFor !== scope) return;
    this.held.set(key, availability);
    this.follow();
  }

  /** The linked file `media` names, as its kept handle finds it without asking. */
  private async linkedFile(
    media: Extract<MediaSource, { readonly kind: 'external' }>,
    signal: AbortSignal,
  ): Promise<MediaAvailability> {
    const access = await this.linkedFiles.look(media.identity, signal);
    if (access.kind !== 'available') {
      return { kind: 'unavailable', reason: ABSENT[absenceOf(access)] };
    }
    const { bytes } = access.file;
    return bytes.kind === 'file'
      ? { kind: 'found', file: bytes.file }
      : { kind: 'unavailable', reason: ABSENT.unreadable };
  }
}

/** What an answer for a file comes to. */
function availabilityOf(answer: DomainResult<Blob> | MediaAvailability): MediaAvailability {
  if ('kind' in answer) return answer;
  return answer.ok
    ? { kind: 'found', file: answer.value }
    : { kind: 'unavailable', reason: answer.failures[0].summary };
}
