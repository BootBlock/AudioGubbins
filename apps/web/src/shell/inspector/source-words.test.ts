import { describe, expect, it } from 'vitest';

import { StandardLayouts, derivedSampleCount } from '@audiogubbins/domain';
import type { AssetSource, DecodedRendition, KeptMetadata } from '@audiogubbins/project-format';
import { contentIdOfDigit } from '@audiogubbins/project-format/testing';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { metadataFacts } from './metadata-words.js';
import { sourceFacts, type SourceFact } from './source-words.js';

const { ambience } = sampleProject().assets;

/** An Ogg Vorbis file decoded into a rendition, as its provenance records it. */
const RENDITION: DecodedRendition = {
  container: 'ogg',
  codec: 'vorbis',
  sampleRate: ambience.sampleRate,
  layout: StandardLayouts.stereo,
  frames: ambience.length,
  statedFrames: derivedSampleCount(480_200),
  bitRate: 160_250,
  leadingFrames: derivedSampleCount(576),
  decoder: { implementation: 'codec-module', name: 'Symphonia', version: '0.6.1' },
  kept: {
    kind: 'linked',
    identity: {
      handleKey: 'forest-key',
      fileName: 'Forest.ogg',
      byteLength: 412_000,
      lastModified: 1_789_000_000_000,
      mediaType: 'audio/ogg',
      signature: '4f676753',
      fastFingerprint: 'f'.repeat(64),
    },
    retainedCopy: contentIdOfDigit('b'),
  },
};

function decodedSource(metadata?: KeptMetadata): AssetSource {
  return {
    media: {
      kind: 'managed',
      contentId: contentIdOfDigit('a'),
      byteLength: 3_840_044,
      mediaType: 'audio/wav',
    },
    provenance: {
      originalFileName: 'Forest.ogg',
      importedAt: 1_790_000_000_000,
      byteLength: 412_000,
      mediaType: 'audio/ogg',
      originProjectId: sampleProject().project.id,
      rendition: RENDITION,
      ...(metadata === undefined ? {} : { metadata }),
    },
  };
}

function asWords(facts: readonly SourceFact[]): readonly string[] {
  return facts.map(({ term, detail }) => `${term}: ${detail}`);
}

describe('an asset’s source in the Inspector (REQ-EDIT-072, REQ-STOR-166)', () => {
  it('states the compressed file a rendition was decoded from, the decoder and how the file is kept', () => {
    expect(asWords(sourceFacts(decodedSource(), ambience))).toEqual([
      'Kept: Decoded once into the project',
      'File: Forest.ogg',
      'Format: Ogg, Vorbis',
      'Sample rate: 48 kHz',
      'Channels: 2 channels: Left, Right',
      'Duration: 10.000 s, 480000 frames',
      'Bit rate: 160 kbit/s on average',
      'Stated length: The file says it holds 480200 frames, and 480000 frames were decoded.',
      'Priming: 576 frames the encoder put before the sound were left out.',
      'Decoded by: Symphonia 0.6.1, in AudioGubbins’s codec module',
      'Compressed file: Linked to “Forest.ogg”, with a copy kept in the project',
    ]);
  });

  it('leaves out what the file did not state, and a copied file says so', () => {
    const source = decodedSource();
    const plain: AssetSource = {
      ...source,
      provenance: {
        ...source.provenance,
        originalFileName: 'Forest.ogg',
        importedAt: 1,
        byteLength: 1,
        mediaType: 'audio/ogg',
        originProjectId: sampleProject().project.id,
        rendition: {
          container: RENDITION.container,
          codec: RENDITION.codec,
          sampleRate: RENDITION.sampleRate,
          layout: RENDITION.layout,
          frames: RENDITION.frames,
          leadingFrames: derivedSampleCount(0),
          decoder: RENDITION.decoder,
          kept: { kind: 'copied', contentId: contentIdOfDigit('c') },
        },
      },
    };
    expect(asWords(sourceFacts(plain, ambience)).slice(6)).toEqual([
      'Decoded by: Symphonia 0.6.1, in AudioGubbins’s codec module',
      'Compressed file: Copied into the project',
    ]);
  });

  it('sums up the file’s metadata: its text by name, then what else it holds, counted', () => {
    const metadata: KeptMetadata = {
      text: { title: 'Dawn chorus', artist: 'Field recordist', comment: '', isrc: 'GBAAA2600001' },
      foreign: [{ scheme: 'vorbis-comment', key: 'MOOD', value: 'calm' }],
      cues: [{ position: derivedSampleCount(1_200), name: 'Wren' }],
      loops: [
        {
          start: derivedSampleCount(0),
          length: derivedSampleCount(4_800),
          playCount: 'endless',
          direction: 'forward',
        },
        {
          start: derivedSampleCount(9_600),
          length: derivedSampleCount(4_800),
          playCount: 2,
          direction: 'alternating',
        },
      ],
      tuning: { unityNote: 60, fineTuneCents: -12 },
      coverArt: { mediaType: 'image/png', description: 'Front', byteLength: 2_048 },
    };

    expect(asWords(metadataFacts(metadata))).toEqual([
      'Title: Dawn chorus',
      'Artist: Field recordist',
      'ISRC: GBAAA2600001',
      'Cue points: 1 cue point',
      'Loops: 2 loops',
      'Tuning: Unity note 60, -12 cents fine',
      'Picture: image/png, 2 kB, “Front”',
      'Other fields: 1 field',
    ]);
    expect(metadataFacts({})).toEqual([]);
  });
});
