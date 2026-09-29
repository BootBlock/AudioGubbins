/**
 * A small project state for the tests of each command: the fixtures package's
 * sample project, with a source attached to each asset and one more asset, so
 * there is an asset of every kind a command treats differently.
 *
 * The test passes the sample project in, because only a test may take the
 * fixtures package. Its assets are keyed `fixture:...`, which no source gives,
 * so each key is derived from the source attached by the format's own state
 * builder, never written by hand.
 */

import { AssetOrigin, StandardLayouts, type Asset } from '@audiogubbins/domain';
import {
  SourceChangePolicy,
  type AssetSource,
  type ProjectState,
} from '@audiogubbins/project-format';
import {
  contentIdOfDigit,
  withSources,
  type SampleProject,
} from '@audiogubbins/project-format/testing';

/** The assets of {@link referenceState}, by what each is for. */
export interface ReferenceAssets {
  /** Managed, with provenance, and used by two clips. */
  readonly footstep: Asset;

  /** Linked through a kept handle and path, retained as the content it names. */
  readonly forest: Asset;

  /** Linked by nothing but its name, with no retained copy. */
  readonly rain: Asset;
}

/** The reference state and its assets, built from the sample project. */
export function referenceState(fixture: SampleProject): {
  readonly state: ProjectState;
  readonly assets: ReferenceAssets;
} {
  const { project } = fixture;
  const rain: Asset = {
    id: fixture.ids.next<'AssetId'>(),
    displayName: 'Rain',
    origin: AssetOrigin.Imported,
    sampleRate: project.settings.sampleRate,
    channelLayout: StandardLayouts.stereo,
    length: fixture.assets.ambience.length,
    // Replaced by the key the asset's source gives.
    storageKey: '',
  };

  const sources = new Map<Asset['id'], AssetSource>([
    [
      fixture.assets.footstep.id,
      {
        media: {
          kind: 'managed',
          contentId: contentIdOfDigit('a'),
          byteLength: 48_044,
          mediaType: 'audio/wav',
        },
        provenance: {
          originalFileName: 'Gravel footstep.wav',
          importedAt: 1_790_000_000_000,
          byteLength: 48_044,
          mediaType: 'audio/wav',
          originProjectId: project.id,
          bitDepth: 16,
        },
      },
    ],
    [
      fixture.assets.ambience.id,
      {
        media: {
          kind: 'external',
          identity: {
            handleKey: 'handle-0001',
            fileName: 'Forest ambience.flac',
            relativePath: 'Ambience/Forest ambience.flac',
            byteLength: 1_234_567,
            lastModified: 1_780_000_000_000,
            mediaType: 'audio/flac',
            signature: '664c6143',
            fastFingerprint: 'b'.repeat(64),
            contentId: contentIdOfDigit('c'),
          },
          policy: SourceChangePolicy.Prompt,
          retainedCopy: contentIdOfDigit('c'),
        },
      },
    ],
    [
      rain.id,
      {
        media: {
          kind: 'external',
          identity: {
            fileName: 'Rain.wav',
            byteLength: 96_000,
            lastModified: 1_780_000_500_000,
            mediaType: 'audio/wav',
            signature: '52494646',
            fastFingerprint: 'd'.repeat(64),
          },
          policy: SourceChangePolicy.Prompt,
        },
      },
    ],
  ]);

  const state = withSources(
    { ...project, assets: new Map(project.assets).set(rain.id, rain) },
    (asset) => sourceOf(sources, asset),
  );
  return {
    state,
    assets: {
      footstep: assetOf(state, fixture.assets.footstep),
      forest: assetOf(state, fixture.assets.ambience),
      rain: assetOf(state, rain),
    },
  };
}

function sourceOf(sources: ReadonlyMap<Asset['id'], AssetSource>, asset: Asset): AssetSource {
  const source = sources.get(asset.id);
  if (source === undefined) throw new Error('The sample project has an asset the test lacks.');
  return source;
}

/** The asset as the state holds it, keyed as its source gives. */
function assetOf(state: ProjectState, asset: Asset): Asset {
  const keyed = state.project.assets.get(asset.id);
  if (keyed === undefined) throw new Error('The reference state lost an asset.');
  return keyed;
}
