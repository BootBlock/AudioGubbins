/**
 * Taking a project out of this browser and bringing one in: as a portable
 * bundle, as an unpacked tree in a folder, and making a project whole by
 * copying the files it links to into it (REQ-STOR-099, REQ-STOR-103,
 * REQ-STOR-166, REQ-STOR-197).
 *
 * The file or folder is asked for first, in the handler of the person's
 * gesture, since a browser opens no chooser outside one; one dismissed brings
 * nothing and takes nothing, and says nothing. A project brought in keeps its
 * identity where the storage does not hold it yet, and comes in as a copy where
 * it does, so bringing the same bundle in twice never refuses the person.
 * Copying linked files runs through the open project's session, one project
 * command an asset, so undo reverses each. Every export of a project that was
 * read is an event of its provenance, whether it wrote or failed, and is
 * recorded in its history where this tab writes the project
 * (`export-recorder.ts`); undo never reverses one.
 */

import { succeed, type AssetId, type DomainResult, type ProjectId } from '@audiogubbins/domain';
import { setAssetMediaInvocation } from '@audiogubbins/project-commands';
import {
  ExportDestinationKind,
  type ContentIdentity,
  type ExportDestination,
  type ExportOutput,
} from '@audiogubbins/project-format';
import {
  consolidate,
  exportBackup,
  exportBundle,
  exportUnpacked,
  importBundle,
  importUnpacked,
  type AssetConsolidation,
  type CopyOptions,
  type ExportAttempt,
  type ExportedBundle,
  type ImportIdentity,
  type ProjectHeader,
  type ProjectSession,
} from '@audiogubbins/storage';

import { bundleNameOf } from '../io/file-names.js';
import type { SaveTarget, TransferFiles } from '../io/transfer-files.js';
import type { ProjectServices } from '../storage/project-services.js';
import { copyOutput, type ExportRecorder, type RecordedExport } from './export-recorder.js';
import { linkedFileOf } from './linked-files.js';
import { observable, type Observable } from './observable.js';
import type { ProjectLibraryStore } from './project-library-store.js';

/** A project brought in, and whether it came in as a copy. */
export interface ImportedProject {
  readonly header: ProjectHeader;
  readonly asCopy: boolean;
}

/** An export written, whether its history records it, and the linked assets it could not carry. */
export interface ExportedProject {
  readonly linked: readonly AssetId[];
  readonly recorded: RecordedExport;
}

/** What is being taken out or brought in, while something is. */
export interface TransferState {
  readonly working?: 'exporting' | 'importing' | 'consolidating';
}

/** What a bundle is saved as. */
const BUNDLE_TYPE = 'application/zip';

/** The container a bundle is, as its provenance names it. */
const BUNDLE_CONTAINER = 'zip';

/** The container an unpacked project is, as its provenance names it. */
const FOLDER_CONTAINER = 'project-tree';

/** What an export says of itself, and how its written output is read. */
interface ExportDescription<TWritten> {
  readonly output: ExportOutput;
  readonly destination: ExportDestination;

  /** The assets it could not carry, and the identity of its bytes where it has one output. */
  readonly readOut: (written: TWritten) => {
    readonly linked: readonly AssetId[];
    readonly identity?: ContentIdentity;
  };

  /** Hands the written file to the person, where saving it takes a step of its own. */
  readonly finish?: () => void;
}

/** A bundle saved to `target`, as its export describes itself. */
function bundleExport(target: SaveTarget, output: ExportOutput): ExportDescription<ExportedBundle> {
  return {
    output,
    destination: { kind: ExportDestinationKind.Bundle, label: target.name },
    readOut: ({ linked, output: identity }) => ({ linked, identity }),
    finish: target.finish,
  };
}

/** A backup is exported whole, as it was kept. */
const WHOLE_HISTORY: CopyOptions = { scope: { kind: 'whole-history' }, includeCaches: false };

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
  private readonly recorder: ExportRecorder;
  private readonly state = observable<TransferState>({});

  readonly get = this.state.get;
  readonly subscribe = this.state.subscribe;

  constructor(
    services: ProjectServices,
    files: TransferFiles,
    library: ProjectLibraryStore,
    recorder: ExportRecorder,
  ) {
    this.services = services;
    this.files = files;
    this.library = library;
    this.recorder = recorder;
  }

  /** Writes a project as a bundle, saved where the person chooses. */
  readonly exportBundle = async (
    project: ProjectId,
    name: string,
    options: CopyOptions,
  ): Promise<DomainResult<ExportedProject | undefined>> => {
    const target = await this.files.save(bundleNameOf(name), BUNDLE_TYPE);
    if (target === undefined) return succeed(undefined);
    return await this.working(
      'exporting',
      async () =>
        await this.recorded(
          project,
          await exportBundle(project, target.sink, options, this.services),
          bundleExport(target, copyOutput(BUNDLE_CONTAINER, options)),
        ),
    );
  };

  /** Writes one of a project's backups as a bundle, saved where the person chooses. */
  readonly exportBackup = async (
    project: ProjectId,
    generation: number,
    name: string,
  ): Promise<DomainResult<ExportedProject | undefined>> => {
    const target = await this.files.save(bundleNameOf(name), BUNDLE_TYPE);
    if (target === undefined) return succeed(undefined);
    return await this.working(
      'exporting',
      async () =>
        await this.recorded(
          project,
          await exportBackup(project, generation, target.sink, WHOLE_HISTORY, this.services),
          bundleExport(target, copyOutput(BUNDLE_CONTAINER, WHOLE_HISTORY, { backup: generation })),
        ),
    );
  };

  /** Writes a project as an unpacked tree into a folder the person chooses. */
  readonly exportFolder = async (
    project: ProjectId,
    options: CopyOptions,
  ): Promise<DomainResult<ExportedProject | undefined>> => {
    const folder = await this.files.chooseFolderToWrite?.();
    if (folder === undefined) return succeed(undefined);
    return await this.working(
      'exporting',
      async () =>
        await this.recorded(
          project,
          await exportUnpacked(project, folder.writer, options, this.services),
          {
            output: copyOutput(FOLDER_CONTAINER, options),
            destination: { kind: ExportDestinationKind.Directory, label: folder.name },
            readOut: (linked) => ({ linked }),
          },
        ),
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
        yieldToHost: this.services.yieldToHost,
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

  /**
   * Keeps an export of a project that was read in its history, whether it wrote
   * or failed, and hands a written file over; a project that could not be read
   * wrote nothing and has nothing to record.
   */
  private async recorded<TWritten>(
    project: ProjectId,
    attempt: DomainResult<ExportAttempt<TWritten>>,
    described: ExportDescription<TWritten>,
  ): Promise<DomainResult<ExportedProject>> {
    if (!attempt.ok) return attempt;
    const { source, written } = attempt.value;
    const { output, destination } = described;
    const draft = { project, source, output, destination };
    if (!written.ok) {
      await this.recorder.record({ ...draft, written });
      return written;
    }
    const { linked, identity } = described.readOut(written.value);
    described.finish?.();
    const recorded = await this.recorder.record({ ...draft, written: succeed(identity) });
    return succeed({ linked, recorded });
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
