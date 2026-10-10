/**
 * The page's export as a test of the Export dialog and its commands drives
 * it: a control that records each export it is asked to start and answers as
 * the test says, the context planned from the asset as the project holds it,
 * the codecs as an environment the test sets decides them, and destinations
 * whose dialogs answer as the test scripts them.
 */

import {
  codecCapability,
  codecDescriptor,
  type CodecEnvironment,
  type CodecId,
} from '@audiogubbins/codecs';
import { fail, failure, FailureKind, succeed, type DomainResult } from '@audiogubbins/domain';
import type { ExportContext, ExportableRegion } from '@audiogubbins/import-export';
import type { ProjectState } from '@audiogubbins/project-format';
import type { RemoteProjectSession } from '@audiogubbins/storage-runtime';

import type { EditorAsset } from '../assets/editor-asset.js';
import type { CodecServices } from '../codecs/codec-services.js';
import type {
  ExportControl,
  ExportRunState,
  ExportServices,
  ExportStart,
  TrustedFolderEntry,
} from '../export/export-types.js';
import { observable, type MutableObservable } from '../state/observable.js';

/** Every module loaded and nothing the browser codes: what an environment offers before a test changes it. */
export const LOADED_CODECS: CodecEnvironment = {
  webAssembly: true,
  codecModule: 'loaded',
  prebuiltModules: new Map<CodecId, 'loaded'>([
    ['mp3', 'loaded'],
    ['vorbis', 'loaded'],
  ]),
  browserDecoders: new Set(),
  browserEncoders: new Set(),
};

/** The page's export as a test drives it, and what it recorded. */
export interface ScriptedExport {
  readonly services: ExportServices;

  /** Each export started, in order, with the session it was started in. */
  readonly started: { readonly session: RemoteProjectSession; readonly start: ExportStart }[];

  /** The run state the control shows, which a test sets. */
  readonly run: MutableObservable<ExportRunState>;

  /** The codecs' environment, which a test changes. */
  readonly environment: MutableObservable<CodecEnvironment>;

  /** The folders kept trusted, which a test sets. */
  readonly trusted: MutableObservable<readonly TrustedFolderEntry[]>;

  /** What the next save dialogs answer, in order; dismissed once they run out. */
  readonly files: FileSystemFileHandle[];

  /** What the next folder dialogs answer, in order; dismissed once they run out. */
  readonly folders: FileSystemDirectoryHandle[];

  /** The names each save dialog suggested, in order. */
  readonly suggested: string[];
}

/** The regions of `asset` the project holds, in the asset's frames, described as an export sees them. */
function regionsOf(asset: EditorAsset, state: ProjectState): readonly ExportableRegion[] {
  if (asset.owner.kind !== 'project') return [];
  const owner = asset.owner.asset.id;
  const regions = [...state.project.regions.values()].filter((region) => region.assetId === owner);
  return asset.regions
    .filter((placed) => regions.some((region) => region.id === placed.id))
    .map((placed) => ({
      id: placed.id,
      name: placed.displayName,
      start: placed.start,
      length: placed.length,
      sampleRate: asset.sampleRate,
      layout: asset.layout,
      precision: { kind: 'float' },
    }));
}

/** What an export of `asset` is planned against: the asset as it is heard, with the registry's codecs. */
function contextOf(asset: EditorAsset, state: ProjectState): DomainResult<ExportContext> {
  if (asset.owner.kind === 'session') {
    return fail(failure('test.not-of-the-project', FailureKind.Rejected, asset.owner.reason));
  }
  return succeed({
    source: {
      name: state.project.displayName,
      sampleRate: asset.sampleRate,
      layout: asset.layout,
      precision: { kind: 'float' },
      length: asset.length,
      regions: regionsOf(asset, state),
    },
    codecs: codecDescriptor,
  });
}

/** The page's export, scripted (see the module comment); `dialogs` says whether the browser gives dialogs. */
export function scriptedExport(
  answer: DomainResult<string> = succeed('The export is done.'),
  dialogs = true,
): ScriptedExport {
  const started: ScriptedExport['started'] = [];
  const run = observable<ExportRunState>({ kind: 'idle' });
  const environment = observable(LOADED_CODECS);
  const trusted = observable<readonly TrustedFolderEntry[]>([]);
  const files: FileSystemFileHandle[] = [];
  const folders: FileSystemDirectoryHandle[] = [];
  const suggested: string[] = [];

  const control: ExportControl = {
    get: run.get,
    subscribe: run.subscribe,
    start: (session, start) => {
      started.push({ session, start });
      return Promise.resolve(answer);
    },
    cancel: () => false,
    answerCollision: () => false,
    retry: () => Promise.resolve(answer),
    deliverElsewhere: () => Promise.resolve(answer),
  };

  const codecs: CodecServices = {
    environment,
    capability: (codec, use) => codecCapability(environment.get(), codec, use),
    ready: () => Promise.resolve(succeed(undefined)),
    analyse: () => Promise.reject(new Error('The Export dialog analyses nothing.')),
    encode: () => Promise.reject(new Error('The Export dialog encodes nothing.')),
  };

  return {
    services: {
      control,
      contextOf,
      codecs,
      destinations: {
        dialogs,
        trusted,
        chooseFile: (name) => {
          suggested.push(name);
          return Promise.resolve(succeed(files.shift()));
        },
        chooseFolder: () => Promise.resolve(succeed(folders.shift())),
      },
    },
    started,
    run,
    environment,
    trusted,
    files,
    folders,
    suggested,
  };
}
