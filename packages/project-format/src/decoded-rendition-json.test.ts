import { describe, expect, it } from 'vitest';

import { StandardLayouts, derivedSampleCount, sampleRate, type Asset } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { sampleProject } from '@audiogubbins/test-fixtures';

import type { DecodedRendition } from './project-state.js';
import { keptMetadata, MAXIMUM_KEPT_FOREIGN_FIELDS, type KeptMetadata } from './kept-metadata.js';
import { readProjectDocument, writeProjectDocument } from './project-json.js';
import type {
  AssetSource,
  ExternalSourceIdentity,
  ProjectState,
  SourceAudioShape,
} from './project-state.js';
import { ProvenanceLevel, stripAssetProvenance } from './provenance-stripping.js';
import { contentIdOfDigit, withSources } from './testing/project-states.js';

const FIXTURE = sampleProject();

const METADATA: KeptMetadata = {
  text: { title: 'Rain on a tin roof', artist: 'Field recordist', comment: 'Line one\nLine two' },
  foreign: [{ scheme: 'vorbis-comment', key: 'MOOD', value: 'calm' }],
  cues: [{ position: derivedSampleCount(1_200), name: 'Thunder' }],
  loops: [
    {
      start: derivedSampleCount(4_800),
      length: derivedSampleCount(9_600),
      playCount: 'endless',
      direction: 'forward',
      name: 'Body',
    },
  ],
  tuning: { unityNote: 60, fineTuneCents: -12.5 },
  coverArt: { mediaType: 'image/jpeg', description: 'Front cover', byteLength: 20_480 },
};

/** The compressed file `asset` is decoded from, agreeing with it, kept as `kept` says. */
function renditionOf(asset: Asset, kept: DecodedRendition['kept']): DecodedRendition {
  return {
    container: 'ogg',
    codec: 'vorbis',
    sampleRate: asset.sampleRate,
    layout: asset.channelLayout,
    frames: asset.length,
    statedFrames: asset.length,
    bitRate: 192_000,
    leadingFrames: derivedSampleCount(0),
    decoder: { implementation: 'codec-module', name: 'symphonia-codec-vorbis', version: '0.5.4' },
    kept,
  };
}

const LINKED_IDENTITY: ExternalSourceIdentity = {
  handleKey: 'handle-0042',
  fileName: 'Rain.ogg',
  relativePath: 'Weather/Rain.ogg',
  byteLength: 812_000,
  lastModified: 1_780_000_000_000,
  mediaType: 'audio/ogg',
  signature: '4f676753',
  fastFingerprint: 'd'.repeat(64),
};

const LINKED: DecodedRendition['kept'] = {
  kind: 'linked',
  identity: LINKED_IDENTITY,
  retainedCopy: contentIdOfDigit('e'),
};

/** What a test changes of each asset's source: its media, its rendition, an audio shape beside it. */
interface SourceChange {
  readonly media?: AssetSource['media'];
  readonly rendition?: (asset: Asset) => DecodedRendition;
  readonly audio?: (asset: Asset) => SourceAudioShape;
}

/** The sample project with every asset a rendition of `kept`, as `change` alters it. */
function renditionState(kept: DecodedRendition['kept'], change: SourceChange = {}): ProjectState {
  return withSources(FIXTURE.project, (asset) => ({
    media: change.media ?? {
      kind: 'managed',
      contentId: contentIdOfDigit('a'),
      byteLength: 100,
      mediaType: 'audio/wav',
    },
    provenance: {
      originalFileName: 'Rain.ogg',
      importedAt: 1_790_000_000_000,
      byteLength: 812_000,
      mediaType: 'audio/ogg',
      originProjectId: FIXTURE.project.id,
      rendition: change.rendition?.(asset) ?? renditionOf(asset, kept),
      metadata: METADATA,
      ...(change.audio === undefined ? {} : { audio: change.audio(asset) }),
    },
  }));
}

/** The codes a state's document is refused with, or none where it reads back. */
function refusals(state: ProjectState): readonly string[] {
  const read = readProjectDocument(writeProjectDocument(state));
  return read.ok ? [] : read.failures.map((problem) => problem.code);
}

describe('a decoded rendition in provenance (ADR-0090)', () => {
  it('reads back with its compressed file copied or linked, and the file’s metadata', () => {
    for (const kept of [{ kind: 'copied', contentId: contentIdOfDigit('f') } as const, LINKED]) {
      const state = renditionState(kept);
      expect(expectSuccess(readProjectDocument(writeProjectDocument(state)))).toEqual(state);
    }
  });

  it('is refused where the asset is not what was decoded into it', () => {
    const otherRate = expectSuccess(sampleRate(22_050));
    const changed = (alter: (rendition: DecodedRendition, asset: Asset) => DecodedRendition) =>
      refusals(
        renditionState(LINKED, {
          rendition: (asset) => alter(renditionOf(asset, LINKED), asset),
        }),
      );
    const each = (code: string) => [...FIXTURE.project.assets.keys()].map(() => code);
    expect(changed((rendition) => ({ ...rendition, sampleRate: otherRate }))).toEqual(
      each('source.rendition-rate-mismatch'),
    );
    expect(
      changed((rendition, asset) => ({
        ...rendition,
        frames: derivedSampleCount(asset.length + 1),
      })),
    ).toEqual(each('source.rendition-length-mismatch'));
    expect(
      changed((rendition, asset) => ({
        ...rendition,
        layout:
          asset.channelLayout.roles.length === 1 ? StandardLayouts.stereo : StandardLayouts.mono,
      })),
    ).toEqual(each('source.rendition-layout-mismatch'));
  });

  it('is refused beside external media or another record of how the audio was read', () => {
    expect(
      refusals(
        renditionState(LINKED, {
          media: { kind: 'external', identity: LINKED_IDENTITY, policy: 'prompt' },
        }),
      ),
    ).toContain('source.rendition-not-managed');
    expect(
      refusals(
        renditionState(LINKED, {
          audio: (asset) => ({
            container: 'wav',
            sampleRate: asset.sampleRate,
            encoding: { kind: 'float', bits: 32, byteOrder: 'little' },
            frames: asset.length,
            declaredFrames: asset.length,
          }),
        }),
      ),
    ).toContain('source.rendition-beside-shape');
  });

  it('strips the metadata and the linked file’s location below full provenance', () => {
    const state = renditionState(LINKED);
    const minimal = stripAssetProvenance(state, ProvenanceLevel.Minimal);
    for (const source of minimal.sources.values()) {
      expect(source.provenance?.metadata).toBeUndefined();
      expect(source.provenance?.rendition?.kept).toEqual({
        kind: 'linked',
        identity: {
          byteLength: 812_000,
          lastModified: 1_780_000_000_000,
          mediaType: 'audio/ogg',
          signature: '4f676753',
          fastFingerprint: 'd'.repeat(64),
        },
        retainedCopy: contentIdOfDigit('e'),
      });
    }
    expect(expectSuccess(readProjectDocument(writeProjectDocument(minimal)))).toEqual(minimal);
    // Stripped once, a state is at its level, so stripping it again gives it back.
    expect(stripAssetProvenance(minimal, ProvenanceLevel.Minimal)).toBe(minimal);
  });
});

describe('a file’s metadata as provenance keeps it (ADR-0093)', () => {
  it('describes an embedded picture rather than holding its bytes', () => {
    const kept = keptMetadata({
      text: { title: 'Rain' },
      coverArt: { mediaType: 'image/png', description: '', bytes: new Uint8Array(3_000) },
    });
    expect(kept).toEqual({
      text: { title: 'Rain' },
      coverArt: { mediaType: 'image/png', description: '', byteLength: 3_000 },
    });
  });

  it('keeps the foreign fields up to the most a document lists, in the file’s order', () => {
    const foreign = Array.from({ length: MAXIMUM_KEPT_FOREIGN_FIELDS + 5 }, (_, index) => ({
      scheme: 'id3v2',
      key: 'TXXX',
      value: String(index),
    }));
    const kept = keptMetadata({ foreign });
    expect(kept.foreign).toHaveLength(MAXIMUM_KEPT_FOREIGN_FIELDS);
    expect(kept.foreign?.at(-1)?.value).toBe(String(MAXIMUM_KEPT_FOREIGN_FIELDS - 1));
  });
});

describe('an audio shape read in place (ADR-0090)', () => {
  it('records the compressed code its samples are stored in', () => {
    for (const encoding of [
      { kind: 'g711-alaw' },
      { kind: 'g711-ulaw' },
      { kind: 'ima-adpcm', framesPerBlock: 505 },
      { kind: 'ms-adpcm', framesPerBlock: 500 },
    ] as const) {
      const state = withSources(FIXTURE.project, (asset) => ({
        media: {
          kind: 'managed',
          contentId: contentIdOfDigit('a'),
          byteLength: 1,
          mediaType: 'audio/wav',
        },
        provenance: {
          importedAt: 1,
          byteLength: 1,
          mediaType: 'audio/wav',
          originProjectId: FIXTURE.project.id,
          audio: {
            container: 'wav',
            sampleRate: asset.sampleRate,
            encoding,
            frames: asset.length,
            declaredFrames: asset.length,
          },
        },
      }));
      expect(expectSuccess(readProjectDocument(writeProjectDocument(state)))).toEqual(state);
    }
  });
});
