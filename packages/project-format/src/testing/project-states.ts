/**
 * Project states for tests, built so they satisfy the aggregate's invariants:
 * every asset has a source and the storage key its source gives.
 *
 * The fixtures package's sample project holds assets keyed `fixture:...`, which
 * no source gives, so a state is built from it by attaching a source to each
 * asset and deriving the key, never by writing a key by hand. The test passes
 * the sample project in, because only a test may take the fixtures package.
 */

import {
  FadeDirection,
  FadeShape,
  MAIN_OUTPUT,
  StandardLayouts,
  assetPlan,
  derivedSampleCount,
  routeToBus,
  slicePlan,
  type Asset,
  type AssetId,
  type Bus,
  type EditOperation,
  type EditRange,
  type EffectChain,
  type IdGenerator,
  type ParameterId,
  type ParameterValue,
  type Project,
  type Region,
  type RegionOperation,
  type Track,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { contentIdFrom, type ContentId } from '../content-identity.js';
import {
  SourceChangePolicy,
  storageKeyOf,
  type AssetSource,
  type ProjectState,
} from '../project-state.js';

/** A content identifier made of one hexadecimal digit repeated. */
export function contentIdOfDigit(digit: string): ContentId {
  return expectSuccess(contentIdFrom(`c1-${digit.repeat(64)}`));
}

/** The project with a source attached to each asset and its storage key derived. */
export function withSources(
  project: Project,
  sourceOf: (asset: Asset, index: number) => AssetSource,
): ProjectState {
  const assets = new Map<AssetId, Asset>();
  const sources = new Map<AssetId, AssetSource>();
  [...project.assets.values()].forEach((asset, index) => {
    const source = sourceOf(asset, index);
    assets.set(asset.id, { ...asset, storageKey: storageKeyOf(asset.id, source.media) });
    sources.set(asset.id, source);
  });
  return { project: { ...project, assets }, sources };
}

/**
 * What a reference state is built from: the fixtures package's sample project,
 * its identifier generator, and the assets and tracks it names.
 */
export interface SampleProject {
  readonly project: Project;
  readonly ids: IdGenerator;
  readonly assets: { readonly footstep: Asset; readonly ambience: Asset };
  readonly tracks: { readonly foley: Track; readonly background: Track };
}

/**
 * The sample project with one of every kind of thing a state holds: a bus with
 * an effect chain, a track routed through it, a managed source and an external
 * one frozen on a retained copy, each with its provenance.
 */
export function referenceState(fixture: SampleProject): ProjectState {
  const { ids, project } = fixture;

  const chain: EffectChain = {
    id: ids.next<'EffectChainId'>(),
    processors: [
      {
        id: ids.next<'ProcessorId'>(),
        typeKey: 'parametric-eq',
        enabled: true,
        soloed: false,
        values: new Map<ParameterId, ParameterValue>([
          [ids.next<'ParameterId'>(), 0.5],
          [ids.next<'ParameterId'>(), 'low-shelf'],
          [ids.next<'ParameterId'>(), true],
        ]),
      },
    ],
  };
  const bus: Bus = {
    id: ids.next<'BusId'>(),
    displayName: 'Reverb send',
    channelLayout: StandardLayouts.stereo,
    gain: 0.8,
    muted: false,
    output: MAIN_OUTPUT,
    effectChainId: chain.id,
  };
  const background = { ...fixture.tracks.background, output: routeToBus(bus.id) };

  return withSources(
    {
      ...project,
      tracks: new Map([
        [fixture.tracks.foley.id, fixture.tracks.foley],
        [background.id, background],
      ]),
      buses: new Map([[bus.id, bus]]),
      effectChains: new Map([[chain.id, chain]]),
    },
    (asset) =>
      asset.id === fixture.assets.footstep.id
        ? {
            media: {
              kind: 'managed',
              contentId: contentIdOfDigit('a'),
              byteLength: 48_044,
              mediaType: 'audio/wav',
            },
            provenance: {
              originalFileName: 'Gravel footstep.wav',
              importedAt: 1_790_000_000_000,
              sourceContentId: contentIdOfDigit('a'),
              byteLength: 48_044,
              mediaType: 'audio/wav',
              originProjectId: project.id,
              audio: {
                container: 'wav',
                sampleRate: asset.sampleRate,
                encoding: 'integer',
                bitDepth: 16,
                byteOrder: 'little',
                frames: asset.length,
                declaredFrames: asset.length,
              },
            },
          }
        : {
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
              },
              policy: SourceChangePolicy.Freeze,
              retainedCopy: contentIdOfDigit('c'),
            },
            provenance: {
              originalFileName: 'Forest ambience.flac',
              importedAt: 1_790_000_100_000,
              sourceFingerprint: 'b'.repeat(64),
              byteLength: 1_234_567,
              mediaType: 'audio/flac',
              originProjectId: project.id,
            },
          },
  );
}

function span(start: number, end: number): EditRange {
  return { start: derivedSampleCount(start), end: derivedSampleCount(end) };
}

/**
 * The reference state with the edit model in it (ADR-0051): the footstep
 * carries a chain of every kind of operation, among them a paste whose plan
 * holds a gain stage and a conversion from mono to stereo, and the region on
 * it carries processing placed before and after that conversion.
 */
export function editedReferenceState(fixture: SampleProject): ProjectState {
  const state = referenceState(fixture);
  const { ids } = fixture;
  const footstep = state.project.assets.get(fixture.assets.footstep.id);
  if (footstep === undefined) throw new Error('The reference state has no footstep.');

  const louder: EditOperation = {
    id: ids.next<'EditOperationId'>(),
    kind: 'process',
    range: span(0, 12_000),
    channels: [0],
    edit: { kind: 'gain', gain: 0.5 },
  };
  const copied = slicePlan(assetPlan({ ...footstep, edits: [louder] }), 6_000, 18_000);
  if (!copied.ok) throw new Error('The footstep could not be copied.');
  const edits: EditOperation[] = [
    louder,
    {
      id: ids.next<'EditOperationId'>(),
      kind: 'insert',
      at: derivedSampleCount(24_000),
      payload: copied.value,
      convertRate: false,
    },
    {
      id: ids.next<'EditOperationId'>(),
      kind: 'convert-layout',
      layout: StandardLayouts.stereo,
      matrix: [[1], [-0.5]],
    },
    {
      id: ids.next<'EditOperationId'>(),
      kind: 'process',
      range: span(0, 2_400),
      edit: { kind: 'fade', direction: FadeDirection.In, shape: FadeShape.SCurve },
    },
    { id: ids.next<'EditOperationId'>(), kind: 'reverse', range: span(100, 200) },
    { id: ids.next<'EditOperationId'>(), kind: 'delete', range: span(30_000, 31_000) },
  ];
  const edited: Asset = { ...footstep, edits };

  const processing: RegionOperation[] = [
    {
      id: ids.next<'EditOperationId'>(),
      basis: 0,
      range: span(0, 1_000),
      edit: { kind: 'invert' },
    },
    {
      id: ids.next<'EditOperationId'>(),
      basis: 4,
      range: span(500, 1_500),
      edit: { kind: 'swap-channels', first: 0, second: 1 },
    },
    {
      id: ids.next<'EditOperationId'>(),
      basis: 5,
      range: span(0, 600),
      channels: [1],
      edit: { kind: 'gain', gain: 2 },
    },
    {
      id: ids.next<'EditOperationId'>(),
      basis: 6,
      range: span(0, 100),
      edit: { kind: 'channel-gains', gains: [1, 0.25] },
    },
  ];
  const regions = new Map(
    [...state.project.regions].map(([id, region]): [Region['id'], Region] => [
      id,
      region.assetId === footstep.id ? { ...region, operations: processing } : region,
    ]),
  );
  return {
    ...state,
    project: {
      ...state.project,
      assets: new Map([...state.project.assets, [footstep.id, edited]]),
      regions,
    },
  };
}
