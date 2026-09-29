/**
 * The project system over storage in memory, for testing the project commands,
 * the stores and the surfaces that draw them.
 *
 * A world is one browser profile: one storage tree and one lease coordinator,
 * which every window made in it shares, as the tabs of a browser share the
 * private file system and Web Locks. Each window is a whole shell context, its
 * project stores made by the composition root's own `createProjectStores`, so
 * what a test drives is what the application runs. Nothing reaches the real
 * machine: the digest is the environment's Web Crypto, the identifiers are
 * seeded, the clock steps, and every file the person would be asked for is
 * scripted.
 */

import { webDigest } from '@audiogubbins/browser-storage';
import {
  commandId,
  createCommandBus,
  createCommandRegistry,
  type CommandInvocation,
  type ExecutionResult,
} from '@audiogubbins/commands';
import type { Clock } from '@audiogubbins/diagnostics';
import { createDeterministicIdGenerator } from '@audiogubbins/domain';
import { MediaObjectStore, type ExternalFile } from '@audiogubbins/media-store';
import { MemoryStorageTree, countingTokens, memorySource } from '@audiogubbins/media-store/testing';
import { projectCommands } from '@audiogubbins/project-commands';
import type { ProjectState } from '@audiogubbins/project-format';
import {
  CacheStore,
  MEDIA_DIRECTORY,
  ProjectRepository,
  mediaSharingOf,
  type DirectoryReader,
  type DirectoryWriter,
} from '@audiogubbins/storage';
import { MemoryLeaseCoordinator, memorySink, type MemorySink } from '@audiogubbins/storage/testing';

import { shellCommands } from '../commands/shell-commands.js';
import type { ShellContext } from '../commands/shell-context.js';
import type { ChosenBundle, SaveTarget, TransferFiles } from '../io/transfer-files.js';
import type { ProjectServices } from '../storage/project-services.js';
import { createProjectStores, type ProjectStores } from '../state/project-stores.js';
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
  readonly mediaFiles: ExternalFile[];

  /** Whether the next save is dismissed. */
  dismissSave: boolean;
}

/** Files scripted by the test, with the folder picker where `canWriteFolders`. */
function scriptedFiles(canWriteFolders = true): ScriptedFiles {
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
        finish: () => {
          saved.finished = true;
        },
      };
      return Promise.resolve(target);
    },
    chooseBundle: () => Promise.resolve(files.bundles.shift()),
    chooseFolderToRead: () => Promise.resolve(files.foldersToRead.shift()),
    chooseFolderToWrite: canWriteFolders
      ? () => Promise.resolve(files.foldersToWrite.shift())
      : undefined,
    chooseMediaFile: () => Promise.resolve(files.mediaFiles.shift()),
  };
  return files;
}

/** A bundle saved by one window, as the person would choose it to bring in. */
export function bundleFrom(saved: SavedFile): ChosenBundle {
  return { name: saved.name, source: memorySource(saved.sink.bytes()) };
}

/** One window of the world: its shell context, its project stores, and how it is driven. */
export interface ProjectWindow {
  readonly context: ShellContext;
  readonly projects: ProjectStores;
  readonly root: StorageRoot;
  readonly files: ScriptedFiles;

  /** What the window keeps projects with, for a test to prepare storage through. */
  readonly services: ProjectServices;

  /** Runs a shell command as the interface runs one. */
  run(id: string, args?: CommandInvocation['arguments']): ExecutionResult<ShellContext>;

  /** Everything the window said, in order. */
  readonly said: readonly string[];

  /** Settles once the window says something more than it has said so far. */
  nextSaid(): Promise<string>;

  /** Runs a command and settles with what the operation it started comes to say. */
  runAndHear(id: string, args?: CommandInvocation['arguments']): Promise<string>;
}

/** A browser profile of windows sharing one storage and one set of leases. */
export interface ProjectWorld {
  readonly tree: MemoryStorageTree;
  readonly coordinator: MemoryLeaseCoordinator;

  /** Opens a window: its storage root is opened and its list read, as the application starts. */
  window(options?: { readonly canWriteFolders?: boolean }): Promise<ProjectWindow>;
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

/** The first moment of a test world, in milliseconds since the epoch. */
const EPOCH = 1_790_000_000_000;

/** A clock that moves on a second each time it is read. */
function steppingClock(): Clock {
  let now = EPOCH;
  return {
    now: () => {
      now += 1_000;
      return now;
    },
  };
}

/** The services one window keeps projects with, over the world's storage. */
function servicesOf(
  world: ProjectWorld,
  context: ShellContext,
  shared: {
    readonly clock: Clock;
    readonly ids: ReturnType<typeof createDeterministicIdGenerator>;
  },
  number: number,
): ProjectServices {
  const { tree, coordinator } = world;
  const digest = webDigest(crypto.subtle);
  const owner = {
    instance: `window-${String(number)}`,
    label: `the tab opened at 10:0${String(number)}:00`,
  };
  const registry = createCommandRegistry<ProjectState>();
  for (const command of projectCommands()) registry.register(command);
  const { clock, ids } = shared;
  const logger = context.diagnostics.loggerFor('projects');
  return {
    tree,
    digest,
    clock,
    ids,
    owner,
    coordinator,
    bus: createCommandBus(registry, context.diagnostics.loggerFor('project-commands')),
    logger,
    store: new MediaObjectStore({
      tree,
      root: MEDIA_DIRECTORY,
      digest,
      nextToken: countingTokens(),
      sharing: mediaSharingOf(coordinator),
    }),
    caches: new CacheStore(tree, digest),
    repository: new ProjectRepository({ tree, digest, clock, ids, owner, coordinator }),
    keeper: undefined,
    yieldToHost: () => Promise.resolve(),
  };
}

/** A world of windows over a new storage, or over `tree` where a test prepared one. */
export function projectWorld(tree = new MemoryStorageTree()): ProjectWorld {
  const shared = { clock: steppingClock(), ids: createDeterministicIdGenerator(29) };
  let windows = 0;
  const world: ProjectWorld = {
    tree,
    coordinator: new MemoryLeaseCoordinator(),
    window: async (options = {}) => {
      windows += 1;
      const built = buildShellContext();
      const services = servicesOf(world, built.context, shared, windows);
      const files = scriptedFiles(options.canWriteFolders);
      const root = new StorageRoot(services);
      const projects = createProjectStores(services, built.storage, files, true);
      return await windowOver(built.context, services, root, projects, files);
    },
  };
  return world;
}

/** A window of the world, started as the application starts it. */
async function windowOver(
  base: ShellContext,
  services: ProjectServices,
  root: StorageRoot,
  projects: ProjectStores,
  files: ScriptedFiles,
): Promise<ProjectWindow> {
  const context: ShellContext = { ...base, storageRoot: root, projects };
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
  return {
    context,
    projects,
    root,
    files,
    services,
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
