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
 * files looked at by no one, so they are not read. Everything asked for is
 * given up when the project is let go.
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
      this.linkedFile(media),
    );
  }

  /** The file behind `key`, asked for once by `ask`, said when it settles. */
  private asked(
    key: string,
    scope: AbortSignal,
    ask: () => Promise<DomainResult<Blob> | MediaAvailability>,
  ): MediaAvailability {
    const held = this.held.get(key);
    if (held !== undefined) return held;
    this.held.set(key, FINDING);
    ask().then(
      (answer) => {
        if (this.heldFor !== scope) return;
        this.held.set(key, availabilityOf(answer));
        this.follow();
      },
      (error: unknown) => {
        if (isAbandoned(error) || this.heldFor !== scope) return;
        const reason = error instanceof Error ? error.message : 'No reason was given.';
        this.logger.error('The file of an asset could not be read.', { reason });
        this.held.set(key, { kind: 'unavailable', reason: 'Its file could not be read.' });
        this.follow();
      },
    );
    return FINDING;
  }

  /** The linked file `media` names, as its kept handle finds it without asking. */
  private async linkedFile(
    media: Extract<MediaSource, { readonly kind: 'external' }>,
  ): Promise<MediaAvailability> {
    const access = await this.linkedFiles.look(media.identity);
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
