/**
 * Taking a project out of this browser and bringing one in: as a portable
 * bundle, as an unpacked tree in a folder, and making a project whole by
 * copying the files it links to into it (REQ-STOR-099, REQ-STOR-103,
 * REQ-STOR-166).
 *
 * The file or folder is asked for first, in the handler of the person's
 * gesture, since a browser opens no chooser outside one; one dismissed brings
 * nothing and takes nothing, and says nothing. A project brought in keeps its
 * identity where the storage does not hold it yet, and comes in as a copy where
 * it does, so bringing the same bundle in twice never refuses the person.
 * Copying linked files runs through the open project's session, one project
 * command an asset, so undo reverses each.
 */

import { succeed, type AssetId, type DomainResult, type ProjectId } from '@audiogubbins/domain';
import { setAssetMediaInvocation } from '@audiogubbins/project-commands';
import {
  consolidate,
  exportBackup,
  exportBundle,
  exportUnpacked,
  importBundle,
  importUnpacked,
  type AssetConsolidation,
  type CopyOptions,
  type ExportedBundle,
  type ImportIdentity,
  type ProjectHeader,
  type ProjectSession,
} from '@audiogubbins/storage';

import type { TransferFiles } from '../io/transfer-files.js';
import type { ProjectServices } from '../storage/project-services.js';
import { linkedFileOf } from './linked-files.js';
import { observable, type Observable } from './observable.js';
import type { ProjectLibraryStore } from './project-library-store.js';

/** A project brought in, and whether it came in as a copy. */
export interface ImportedProject {
  readonly header: ProjectHeader;
  readonly asCopy: boolean;
}

/** What is being taken out or brought in, while something is. */
export interface TransferState {
  readonly working?: 'exporting' | 'importing' | 'consolidating';
}

/** What a bundle is saved as. */
const BUNDLE_TYPE = 'application/zip';

/** Characters no file name may hold on the systems a bundle is saved to. */
const NOT_IN_A_FILE_NAME = /[\\/:*?"<>|\p{Cc}]+/gu;

/** The name a project's bundle, or one of its backups, is suggested as. */
function bundleNameOf(projectName: string): string {
  const cleaned = projectName.replace(NOT_IN_A_FILE_NAME, ' ').replace(/\s+/gu, ' ').trim();
  return `${cleaned === '' ? 'Project' : cleaned}.zip`;
}

/**
 * Why bringing a project in as itself is refused where it is taken already: the
 * storage holds it, or a window holds its lease, which a project has only where
 * it is kept or is being brought in.
 */
const TAKEN: ReadonlySet<string> = new Set(['storage.project-exists', 'storage.project-busy']);

/** Brings a project in as itself, and as a copy where the storage holds it already. */
async function asItselfOrACopy(
  bringIn: (identity: ImportIdentity) => Promise<DomainResult<ProjectHeader>>,
): Promise<DomainResult<ImportedProject>> {
  const original = await bringIn('original');
  if (original.ok) return succeed({ header: original.value, asCopy: false });
  if (!original.failures.some((one) => TAKEN.has(one.code))) return original;
  const copy = await bringIn('copy');
  return copy.ok ? succeed({ header: copy.value, asCopy: true }) : copy;
}

/**
 * Taking projects out and bringing them in. Each answers `undefined` where the
 * person dismissed the chooser, which is no failure.
 */
export class ProjectTransferStore implements Observable<TransferState> {
  private readonly services: ProjectServices;
  private readonly files: TransferFiles;
  private readonly library: ProjectLibraryStore;
  private readonly state = observable<TransferState>({});

  readonly get = this.state.get;
  readonly subscribe = this.state.subscribe;

  constructor(services: ProjectServices, files: TransferFiles, library: ProjectLibraryStore) {
    this.services = services;
    this.files = files;
    this.library = library;
  }

  /** Writes a project as a bundle, saved where the person chooses. */
  readonly exportBundle = async (
    project: ProjectId,
    name: string,
    options: CopyOptions,
  ): Promise<DomainResult<ExportedBundle | undefined>> => {
    const target = await this.files.save(bundleNameOf(name), BUNDLE_TYPE);
    if (target === undefined) return succeed(undefined);
    return await this.working('exporting', async () => {
      const written = await exportBundle(project, target.sink, options, this.services);
      if (written.ok) target.finish();
      return written;
    });
  };

  /** Writes one of a project's backups as a bundle, saved where the person chooses. */
  readonly exportBackup = async (
    project: ProjectId,
    generation: number,
    name: string,
  ): Promise<DomainResult<ExportedBundle | undefined>> => {
    const target = await this.files.save(bundleNameOf(name), BUNDLE_TYPE);
    if (target === undefined) return succeed(undefined);
    return await this.working('exporting', async () => {
      const whole = { scope: { kind: 'whole-history' }, includeCaches: false } as const;
      const written = await exportBackup(project, generation, target.sink, whole, this.services);
      if (written.ok) target.finish();
      return written;
    });
  };

  /** Writes a project as an unpacked tree into a folder the person chooses. */
  readonly exportFolder = async (
    project: ProjectId,
    options: CopyOptions,
  ): Promise<DomainResult<readonly AssetId[] | undefined>> => {
    const folder = await this.files.chooseFolderToWrite?.();
    if (folder === undefined) return succeed(undefined);
    return await this.working('exporting', () =>
      exportUnpacked(project, folder, options, this.services),
    );
  };

  /** Brings a project in from a bundle the person chooses. */
  readonly importBundle = async (): Promise<DomainResult<ImportedProject | undefined>> => {
    const bundle = await this.files.chooseBundle();
    if (bundle === undefined) return succeed(undefined);
    return await this.bringingIn((identity) =>
      importBundle(bundle.source, identity, this.services),
    );
  };

  /** Brings a project in from a folder the person chooses. */
  readonly importFolder = async (): Promise<DomainResult<ImportedProject | undefined>> => {
    const folder = await this.files.chooseFolderToRead();
    if (folder === undefined) return succeed(undefined);
    return await this.bringingIn((identity) => importUnpacked(folder, identity, this.services));
  };

  /** Copies every linked file of the open project into it, one change each. */
  readonly consolidate = (
    session: ProjectSession,
  ): Promise<DomainResult<readonly AssetConsolidation[]>> =>
    this.working('consolidating', () =>
      consolidate(session, {
        store: this.services.store,
        digest: this.services.digest,
        locate: async (_asset, identity) => {
          const access = await linkedFileOf(this.services.keeper, identity);
          return access.kind === 'available' ? access.file : undefined;
        },
        setMedia: setAssetMediaInvocation,
      }),
    );

  private async working<TValue>(
    doing: NonNullable<TransferState['working']>,
    work: () => Promise<DomainResult<TValue>>,
  ): Promise<DomainResult<TValue>> {
    this.state.set({ working: doing });
    try {
      return await work();
    } finally {
      this.state.set({});
    }
  }

  /** Brings in what `bringIn` reads, and reads the list again after. */
  private bringingIn(
    bringIn: (identity: ImportIdentity) => Promise<DomainResult<ProjectHeader>>,
  ): Promise<DomainResult<ImportedProject>> {
    return this.working('importing', async () => {
      const imported = await asItselfOrACopy(bringIn);
      await this.library.refresh();
      return imported;
    });
  }
}
