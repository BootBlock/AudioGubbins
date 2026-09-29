/**
 * A small project state for the tests of each command: the fixtures package's
 * sample project, with a source attached to each asset and one more asset, so
 * there is an asset of every kind a command treats differently.
 *
 * The test passes the sample project in, because only a test may take the
 * fixtures package. Its assets are keyed `fixture:...`, which no source gives,
 * so each key is derived here from the source attached, never written by hand.
 */

import {
  AssetOrigin,
  StandardLayouts,
  type Asset,
  type AssetId,
  type IdGenerator,
  type Project,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  SourceChangePolicy,
  contentIdFrom,
  storageKeyOf,
  type AssetSource,
  type ContentId,
  type ProjectState,
} from '@audiogubbins/project-format';

/** The assets of {@link referenceState}, by what each is for. */
export interface ReferenceAssets {
  /** Managed, with provenance, and used by two clips. */
  readonly footstep: Asset;

  /** Linked through a kept handle and path, retained as the content it names. */
  readonly forest: Asset;

  /** Linked by nothing but its name, with no retained copy. */
  readonly rain: Asset;
}

/** What the reference state is built from: the fixtures' sample project. */
export interface SampleProject {
  readonly project: Project;
  readonly ids: IdGenerator;
  readonly assets: { readonly footstep: Asset; readonly ambience: Asset };
}

/** A content identifier made of one hexadecimal digit repeated. */
export function contentIdOfDigit(digit: string): ContentId {
  return expectSuccess(contentIdFrom(`c1-${digit.repeat(64)}`));
}

/** The reference state and its assets, built from the sample project. */
export function referenceState(fixture: SampleProject): {
  readonly state: ProjectState;
  readonly assets: ReferenceAssets;
} {
  const { project } = fixture;

  const footstepSource: AssetSource = {
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
  };
  const forestSource: AssetSource = {
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
  };
  const rainSource: AssetSource = {
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
  };

  const keyed = (asset: Asset, source: AssetSource): Asset => ({
    ...asset,
    storageKey: storageKeyOf(asset.id, source.media),
  });
  const footstep = keyed(fixture.assets.footstep, footstepSource);
  const forest = keyed(fixture.assets.ambience, forestSource);
  const rain = keyed(
    {
      id: fixture.ids.next<'AssetId'>(),
      displayName: 'Rain',
      origin: AssetOrigin.Imported,
      sampleRate: project.settings.sampleRate,
      channelLayout: StandardLayouts.stereo,
      length: forest.length,
      storageKey: '',
    },
    rainSource,
  );

  const state: ProjectState = {
    project: {
      ...project,
      assets: new Map([footstep, forest, rain].map((asset) => [asset.id, asset])),
    },
    sources: new Map<AssetId, AssetSource>([
      [footstep.id, footstepSource],
      [forest.id, forestSource],
      [rain.id, rainSource],
    ]),
  };
  return { state, assets: { footstep, forest, rain } };
}
