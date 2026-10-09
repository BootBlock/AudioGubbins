/**
 * The project system over storage in memory, for testing the project commands,
 * the stores and the surfaces that draw them.
 *
 * A world is one browser profile: one storage tree and one lease coordinator,
 * which every window made in it shares, as the tabs of a browser share the
 * private file system and Web Locks. Each window is a whole shell context with
 * a storage worker of its own: the worker's own composition, served over an
 * in-process port pair that clones every message as the browser does, and the
 * page's end connected as the application connects it, so every operation the
 * stores ask crosses the port. Its project stores are made by the composition
 * root's own `createProjectStores`, so what a test drives is what the
 * application runs. A test prepares or looks into the storage through the
 * world's own services over the same tree, as another window of the profile
 * would: the world owns both ends of every port. Nothing reaches the real
 * machine: the digest is the environment's Web Crypto, each window's
 * identifiers are drawn from a seed of its own, the clock steps, and every file
 * the person would be asked for is scripted.
 */

import { webDigest } from '@audiogubbins/browser-storage';
import {
  commandId,
  createCommandBus,
  createCommandRegistry,
  type CommandInvocation,
  type ExecutionResult,
} from '@audiogubbins/commands';
import { MemoryStorageTree, memorySource } from '@audiogubbins/media-store/testing';
import type { DirectoryReader, DirectoryWriter } from '@audiogubbins/storage';
import { MemoryLeaseCoordinator, memorySink, type MemorySink } from '@audiogubbins/storage/testing';
import { connectStorage, type PageFile } from '@audiogubbins/storage-runtime';
import type { StorageEstimate } from '@audiogubbins/recording';
import {
  memoryHostServices,
  portPair,
  serveMemoryStorage,
  steppingClock,
  type CatalogueSource,
  type HostServices,
} from '@audiogubbins/storage-runtime/testing';

import { shellCommands } from '../commands/shell-commands.js';
import type { ShellContext } from '../commands/shell-context.js';
import type { BackupFolderPort } from '../io/backup-folder.js';
import type { ChosenBundle, SaveTarget, TransferFiles } from '../io/transfer-files.js';
import type { ProjectServices } from '../storage/project-services.js';
import { abandonment } from '../state/abandoning.js';
import { createModelAvailabilityStore } from '../ml/model-availability.js';
import { modelGates } from '../ml/model-words.js';
import { followProjectAssets } from '../state/project-catalogue.js';
import { createProjectStores, type ProjectStores } from '../state/project-stores.js';
import type { LocalDetectionWorker } from '@audiogubbins/detection-runtime/testing';
import { PINNED_RUNTIME_SHA256 } from '@audiogubbins/processors';

import type { FakePlayback } from './audio-fakes.js';
import type { RecordingFakes } from './recording-fakes.js';
import { libraryChannel } from '../io/library-channel.js';
import type { PackManager } from '../ml/pack-manager.js';
import { packManagerOver } from './pack-managers.js';
import { ScriptedLinkedFiles } from './scripted-linked-files.js';
import { ScriptedPage } from './scripted-page.js';
import { wordChannels, type WordChannels } from './word-channels.js';
import { StorageRoot } from '../state/storage-root-store.js';
import { DESCRIPTORS, buildShellContext } from './shell-context.js';

/** A file saved, as the person would have been given it. */
export interface SavedFile {
  readonly name: string;
  readonly mediaType: string;
  readonly sink: MemorySink;
  finished: boolean;
}

/** The files a window passes to and from the person, each answer scripted by the test. */
export interface ScriptedFiles extends TransferFiles {
  /** Every file saved, in order. */
  readonly saved: SavedFile[];

  /** What the next chooser answers; nothing, as a dismissed one does, once it runs out. */
  readonly bundles: ChosenBundle[];
  readonly foldersToRead: DirectoryReader[];
  readonly foldersToWrite: DirectoryWriter[];
  readonly mediaFiles: PageFile[];

  /** Whether the next save is dismissed. */
  dismissSave: boolean;
}

/** What every folder the person chooses to write into is called. */
export const CHOSEN_FOLDER_NAME = 'Sounds';

/** Files scripted by the test, with the folder picker where `canWriteFolders`. */
export function scriptedFiles(canWriteFolders = true): ScriptedFiles {
  const files: ScriptedFiles = {
    saved: [],
    bundles: [],
    foldersToRead: [],
    foldersToWrite: [],
    mediaFiles: [],
    dismissSave: false,
    save: (name, mediaType) => {
      if (files.dismissSave) return Promise.resolve(undefined);
      const saved: SavedFile = { name, mediaType, sink: memorySink(), finished: false };
      files.saved.push(saved);
      const target: SaveTarget = {
        sink: saved.sink,
        name,
        finish: () => {
          saved.finished = true;
        },
      };
      return Promise.resolve(target);
    },
    chooseBundle: () => Promise.resolve(files.bundles.shift()),
    chooseFolderToRead: () => {
      const reader = files.foldersToRead.shift();
      return Promise.resolve(reader === undefined ? undefined : { kind: 'reader', reader });
    },
    chooseFolderToWrite: canWriteFolders
      ? () => {
          const writer = files.foldersToWrite.shift();
          return Promise.resolve(
            writer === undefined ? undefined : { writer, name: CHOSEN_FOLDER_NAME },
          );
        }
      : undefined,
    chooseMediaFile: () => Promise.resolve(files.mediaFiles.shift()),
  };
  return files;
}

/** A bundle saved by one window, as the person would choose it to bring in. */
export function bundleFrom(saved: SavedFile): ChosenBundle {
  return { name: saved.name, bytes: { kind: 'source', source: memorySource(saved.sink.bytes()) } };
}

/** One window of the world: its shell context, its project stores, and how it is driven. */
export interface ProjectWindow {
  readonly context: ShellContext;
  readonly projects: ProjectStores;
  readonly root: StorageRoot;
  readonly files: ScriptedFiles;

  /** What the window's page keeps projects with: its client of its storage worker. */
  readonly services: ProjectServices;

  /** The world's own services over its storage, for a test to prepare or look into it. */
  readonly storage: HostServices;

  /** The audio engine the window plays through, which a test reads what it was given from. */
  readonly audio: { readonly playback: FakePlayback };

  /** The browser's input and the capture behind the window's recording part. */
  readonly recording: RecordingFakes;

  /** The detection workers the window made, in order, which a test reads what it asked of. */
  readonly detectionWorkers: readonly LocalDetectionWorker[];

  /** The window's page, which a test hides and shows as the person leaves it and comes back. */
  readonly page: ScriptedPage;

  /** The window's model packs, over its storage worker's installer. */
  readonly packs: PackManager;

  /** Runs a shell command as the interface runs one. */
  run(id: string, args?: CommandInvocation['arguments']): ExecutionResult<ShellContext>;

  /** Everything the window said, in order. */
  readonly said: readonly string[];

  /** Settles once the window says something more than it has said so far. */
  nextSaid(): Promise<string>;

  /** Runs a command and settles with what the operation it started comes to say. */
  runAndHear(id: string, args?: CommandInvocation['arguments']): Promise<string>;

  /**
   * Takes the window's project system down, as the application does as the
   * page goes, giving up the work it started in the storage worker.
   */
  takeDown(): void;
}

/** A browser profile of windows sharing one storage and one set of leases. */
export interface ProjectWorld {
  readonly tree: MemoryStorageTree;
  readonly coordinator: MemoryLeaseCoordinator;

  /** The world's own services over its storage, as another window of the profile holds them. */
  readonly storage: HostServices;

  /** The broadcast channels the profile's windows share. */
  readonly words: WordChannels;

  /**
   * A page joined to a storage worker of its own over the world's storage,
   * for a test that composes the project system itself.
   */
  page(context: ShellContext): ProjectServices;

  /**
   * Opens a window: its storage root is opened and its list read, and its
   * backups folder looked for, as the application starts.
   */
  window(options?: {
    readonly canWriteFolders?: boolean;
    readonly backupFolder?: BackupFolderPort;
    readonly linkedFiles?: ScriptedLinkedFiles;
    /** The storage estimate the window's storage worker reads: none where not given. */
    readonly estimate?: () => Promise<StorageEstimate | undefined>;
  }): Promise<ProjectWindow>;
}

/**
 * A storage whose root was written by an earlier version, of the schema before
 * this build's, with a checksum of its body so only the schema is wrong.
 */
export async function olderStorage(): Promise<MemoryStorageTree> {
  const tree = new MemoryStorageTree();
  const body = '{"writtenBy":"0.0.9"}';
  const checksum = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
  const root = `{"body":${body},"checksum":"${checksum}","kind":"storage-root","schemaVersion":0}`;
  await tree.writeFile('storage.json', new TextEncoder().encode(root));
  return tree;
}

/** How far apart the seeds of two windows' identifiers are, each with another window's beside it. */
const SEED_STRIDE = 10_000;

/**
 * A window's page, joined to a storage worker of its own over the world's
 * storage, its identifiers drawn from the seed of window `number`.
 */
function pageOf(
  world: Pick<ProjectWorld, 'tree' | 'coordinator'>,
  clock: ReturnType<typeof steppingClock>,
  context: ShellContext,
  number: number,
  packSource: CatalogueSource | undefined,
  estimate?: () => Promise<StorageEstimate | undefined>,
): ProjectServices {
  const pair = portPair();
  serveMemoryStorage(pair.worker, {
    ...(packSource === undefined ? {} : { packSource }),
    ...(estimate === undefined ? {} : { estimate }),
    tree: world.tree,
    coordinator: world.coordinator,
    clock,
    tab: {
      name: `window-${String(number)}`,
      seed: 29 + SEED_STRIDE * number,
      label: `the tab opened at 10:0${String(number)}:00`,
    },
  });
  return {
    client: connectStorage(pair.page, context.diagnostics),
    keeper: undefined,
    digest: webDigest(crypto.subtle),
    logger: context.diagnostics.loggerFor('projects'),
  };
}

/**
 * A world of windows over a new storage, or over `tree` where a test prepared
 * one, whose storage workers download a catalogue's packs from `packSource`,
 * where a test gives one, and from nowhere otherwise.
 */
export function projectWorld(
  tree = new MemoryStorageTree(),
  packSource?: CatalogueSource,
): ProjectWorld {
  const clock = steppingClock();
  const words = wordChannels();
  const coordinator = new MemoryLeaseCoordinator();
  const storage = memoryHostServices({
    tree,
    coordinator,
    clock,
    tab: { name: 'the test', seed: 7 },
  });
  let windows = 0;
  const page = (
    context: ShellContext,
    estimate?: () => Promise<StorageEstimate | undefined>,
  ): ProjectServices => {
    windows += 1;
    return pageOf(world, clock, context, windows, packSource, estimate);
  };
  const world: ProjectWorld = {
    tree,
    coordinator,
    storage,
    words,
    page,
    window: async (options = {}) => {
      const built = buildShellContext();
      const services = page(built.context, options.estimate);
      const files = scriptedFiles(options.canWriteFolders);
      const lifetime = new AbortController();
      const root = new StorageRoot(services.client.root, lifetime.signal);
      const projects = createProjectStores(
        services,
        built.storage,
        {
          files,
          canLink: true,
          backupFolder: options.backupFolder,
          linkedFiles: options.linkedFiles ?? new ScriptedLinkedFiles(),
          libraryChanges: libraryChannel(
            words.open,
            built.context.diagnostics.loggerFor('projects'),
          ),
        },
        lifetime.signal,
      );
      const takeDown = (): void => {
        lifetime.abort(abandonment('The test took the window down.'));
        projects.project.dispose();
      };
      return await windowOver(
        built.context,
        {
          services,
          storage,
          root,
          projects,
          files,
          takeDown,
          audio: built.audio,
          recording: built.recording,
          detectionWorkers: built.detectionWorkers,
        },
        lifetime.signal,
      );
    },
  };
  return world;
}

/** The runtime a window's build ships: the one every model processor is pinned to. */
const TEST_RUNTIME = {
  name: 'onnxruntime-web',
  version: '1.30.0',
  webAssemblySha256: PINNED_RUNTIME_SHA256,
};

/** A device that offers local inference everything it prefers. */
const EVERY_INFERENCE_CAPABILITY = {
  status: 'full',
  explanation: '',
  missingRequired: [],
  missingPreferred: [],
} as const;

/** A window of the world, started as the application starts it. */
async function windowOver(
  base: ShellContext,
  parts: Pick<
    ProjectWindow,
    | 'services'
    | 'storage'
    | 'root'
    | 'projects'
    | 'files'
    | 'takeDown'
    | 'audio'
    | 'recording'
    | 'detectionWorkers'
  >,
  lifetime: AbortSignal,
): Promise<ProjectWindow> {
  const { root, projects } = parts;
  const availability = createModelAvailabilityStore({
    packs: parts.services.client.packs,
    runtime: () => Promise.resolve(TEST_RUNTIME),
    device: () => EVERY_INFERENCE_CAPABILITY,
    unknown: (reason) => {
      throw new Error(`Which model packs can run could not be read: ${reason}`);
    },
  });
  const modelGate = modelGates(availability);
  const packs = packManagerOver(
    parts.services.client.packs,
    availability,
    () => projects.files.chooseFolderToRead(),
    lifetime,
  );
  const page = new ScriptedPage();
  projects.savedProcessing.follow(page, (error) => {
    throw error;
  });
  const context: ShellContext = { ...base, storageRoot: root, projects, modelGate, packs };
  followProjectAssets(projects, context.assets, modelGate);
  const registry = createCommandRegistry<ShellContext>();
  for (const command of shellCommands(DESCRIPTORS)) registry.register(command);
  const bus = createCommandBus(registry, context.diagnostics.loggerFor('commands'));

  const said: string[] = [];
  const waiting: ((text: string) => void)[] = [];
  let heardUpTo = 0;
  context.interaction.subscribe(() => {
    const announcement = context.interaction.get().announcement;
    if (announcement === undefined || announcement.sequence <= heardUpTo) return;
    heardUpTo = announcement.sequence;
    said.push(announcement.text);
    for (const settle of waiting.splice(0)) settle(announcement.text);
  });
  const nextSaid = (): Promise<string> =>
    new Promise((resolve) => {
      waiting.push(resolve);
    });
  const run = (id: string, args?: CommandInvocation['arguments']) =>
    bus.execute(context, {
      commandId: commandId(id),
      ...(args === undefined ? {} : { arguments: args }),
    });

  await root.open();
  await projects.library.refresh();
  await projects.backupFolder.start();
  return {
    ...parts,
    context,
    page,
    packs,
    run,
    said,
    nextSaid,
    runAndHear: async (id, args) => {
      const heard = nextSaid();
      const ran = run(id, args);
      if (ran.kind === 'refused') throw new Error(`${id} was refused: ${ran.failures[0].summary}`);
      return await heard;
    },
  };
}
