/**
 * Project states for this package's tests, built so they satisfy the
 * aggregate's invariants: every asset has a source and the storage key its
 * source gives.
 *
 * The fixtures package's sample project holds assets keyed `fixture:...`, which
 * no source gives, so a state is built from it here by attaching a source to
 * each asset and deriving the key, never by writing a key by hand.
 */

import { webcrypto } from 'node:crypto';

import {
  MAIN_OUTPUT,
  StandardLayouts,
  routeToBus,
  type Asset,
  type AssetId,
  type Bus,
  type EffectChain,
  type ParameterId,
  type ParameterValue,
  type Project,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { sampleProject } from '@audiogubbins/test-fixtures';

import type { Digest } from '../byte-ports.js';
import { contentIdFrom, type ContentId } from '../content-identity.js';
import {
  SourceChangePolicy,
  storageKeyOf,
  type AssetSource,
  type ProjectState,
} from '../project-state.js';

/** SHA-256 through Node's Web Crypto, as the browser's would be injected. */
export const nodeDigest: Digest = async (bytes) =>
  new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes));

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
 * The sample project with one of every kind of thing a state holds: a bus with
 * an effect chain, a track routed through it, a managed source and an external
 * one frozen on a retained copy, each with its provenance.
 */
export function referenceState(): ProjectState {
  const fixture = sampleProject();
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
              bitDepth: 16,
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
