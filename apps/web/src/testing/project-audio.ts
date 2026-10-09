/**
 * Audio imported into a project, as a test of the editor makes it: a window of
 * a world with a project open to change, a WAV file imported into it through
 * the storage worker as the person imports one, its markers and regions added
 * by the project's own commands, and the asset open in an editor view once the
 * page holds its file.
 *
 * jsdom's `File` and `Blob` clone to plain objects across a port, where a
 * browser clones them whole, so a test using this holds the platform's own
 * (`holdPlatformFiles`).
 */

import { Blob as PlatformBlob, File as PlatformFile } from 'node:buffer';
import { afterEach, beforeEach, expect, vi } from 'vitest';

import {
  instantiateProcessor,
  sampleCount,
  type AssetId,
  type EffectChain,
  type SampleCount,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { SourceHandling } from '@audiogubbins/media-store';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import {
  addMarkerInvocation,
  addRegionInvocation,
  setRackInvocation,
} from '@audiogubbins/project-commands';
import type { RemoteProjectSession } from '@audiogubbins/storage-runtime';
import { sine, stereo, wavFile, type SignalFixture } from '@audiogubbins/test-fixtures';

import type { EditorAsset } from '../assets/editor-asset.js';
import { assetEntryId } from '../assets/project-entry.js';
import { projectWorld, type ProjectWindow, type ProjectWorld } from './project-context.js';

/** When every import here happens. */
const IMPORTED_AT = 1_790_000_000_000;

/** Holds the platform's own `File` and `Blob` for every test of the file it is called in. */
export function holdPlatformFiles(): void {
  beforeEach(() => {
    vi.stubGlobal('File', PlatformFile);
    vi.stubGlobal('Blob', PlatformBlob);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
}

/** Six seconds of stereo at 48 kHz, as the loop the editor's tests mark. */
function sixSecondsOfStereo(): SignalFixture {
  const length = 6 * 48_000;
  return stereo(sine(375, { length, amplitude: 0.5 }), sine(750, { length, amplitude: 0.4 }));
}

/** A window with audio imported into its project, and what a test reads of it. */
export interface AudioWindow {
  readonly window: ProjectWindow;
  readonly session: RemoteProjectSession;
  readonly assetId: AssetId;
  /** The identity a view names the asset by. */
  readonly entry: string;
  /** The asset as a view opens it now. */
  asset(): EditorAsset;
  /** Settles once the asset a view opens is no longer `before`, as a change makes it. */
  changed(before: EditorAsset): Promise<EditorAsset>;
}

/** The asset of `entry`, once the page holds every file it reads. */
async function opened(window: ProjectWindow, entry: string): Promise<EditorAsset> {
  await expect.poll(() => window.context.assets.find(entry), { timeout: 5000 }).toBeDefined();
  const asset = window.context.assets.find(entry);
  if (asset === undefined) throw new Error(`${entry} did not open.`);
  return asset;
}

/**
 * A window of `world` with a project named "Harbour" open to change, `fixture`
 * imported into it as `name`, and `markers` and `regions` added to it.
 */
export async function windowWithAudio(
  options: {
    readonly world?: ProjectWorld;
    readonly fixture?: SignalFixture;
    readonly name?: string;
    readonly markers?: readonly { readonly name: string; readonly at: number }[];
    readonly regions?: readonly {
      readonly name: string;
      readonly start: number;
      readonly end: number;
    }[];
  } = {},
): Promise<AudioWindow> {
  const world = options.world ?? projectWorld();
  const window = await world.window();
  await window.runAndHear('file.create-project', { name: 'Harbour' });
  const session = window.projects.project.session();
  if (session === undefined) throw new Error('The project did not open to change.');
  const name = options.name ?? 'Loop';
  const imported = await window.services.client.media.importFile(session, {
    file: {
      bytes: {
        kind: 'file',
        file: new File([wavFile(options.fixture ?? sixSecondsOfStereo())], `${name}.wav`),
      },
      fileName: `${name}.wav`,
      mediaType: 'audio/wav',
      lastModified: IMPORTED_AT,
    },
    choice: { mode: SourceHandling.Copy },
    assetId: window.storage.ids.next<'AssetId'>(),
    importedAt: IMPORTED_AT,
  });
  const assetId = expectSuccess(imported).asset.id;
  const at = (frames: number): SampleCount => expectSuccess(sampleCount(frames));
  for (const marker of options.markers ?? []) {
    expectSuccess(
      await session.run(
        addMarkerInvocation({
          id: window.storage.ids.next<'MarkerId'>(),
          assetId,
          displayName: marker.name,
          basis: 0,
          position: at(marker.at),
        }),
      ),
    );
  }
  for (const region of options.regions ?? []) {
    expectSuccess(
      await session.run(
        addRegionInvocation({
          id: window.storage.ids.next<'RegionId'>(),
          assetId,
          displayName: region.name,
          basis: 0,
          start: at(region.start),
          end: at(region.end),
          tags: [],
          operations: [],
        }),
      ),
    );
  }
  const entry = assetEntryId(assetId);
  await opened(window, entry);
  return {
    window,
    session,
    assetId,
    entry,
    asset: () => {
      const asset = window.context.assets.find(entry);
      if (asset === undefined) throw new Error(`${entry} is not open.`);
      return asset;
    },
    changed: async (before) => {
      await expect
        .poll(() => window.context.assets.find(entry) !== before, { timeout: 5000 })
        .toBe(true);
      return await opened(window, entry);
    },
  };
}

/** `audio`'s sound, racked with DeepFilterNet 3, on or bypassed, and the rack. */
export async function rackedWithDeepFilterNet(
  audio: AudioWindow,
  options: { readonly enabled: boolean } = { enabled: true },
): Promise<EffectChain> {
  const descriptor = PROCESSOR_CATALOGUE.get('deepfilternet-3');
  if (descriptor === undefined) throw new Error('The catalogue lists DeepFilterNet 3.');
  const { context } = audio.window;
  const rack: EffectChain = {
    id: context.ids.next<'EffectChainId'>(),
    slots: [
      {
        ...instantiateProcessor(context.ids.next<'ProcessorId'>(), descriptor),
        enabled: options.enabled,
      },
    ],
  };
  const asset = audio.session.getSnapshot().model.state.project.assets.get(audio.assetId);
  if (asset === undefined) throw new Error('The sound is in the project.');
  await audio.session.run(setRackInvocation({ kind: 'asset', asset }, rack));
  return rack;
}
