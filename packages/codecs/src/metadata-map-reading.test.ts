import { readValue } from '@audiogubbins/domain';
import { describe, expect, it } from 'vitest';

import { MAXIMUM_LOOPS, MAXIMUM_PICTURE_BYTES } from './metadata-limits.js';
import type { MetadataMap, MetadataPart } from './metadata-map.js';
import { metadataMapOf, metadataPartOf } from './metadata-map-reading.js';
import { frames, fullMetadata } from './testing/index.js';

/** Every part a map holds. */
const WHOLE: MetadataMap = {
  ...fullMetadata(),
  broadcast: {
    description: 'Take 3',
    originator: 'Recorder',
    originatorReference: 'REF',
    originationDate: '2026-10-10',
    originationTime: '01:02:03',
    timeReference: frames(48_000),
    codingHistory: 'A=PCM,F=48000\r\n',
  },
  cues: [{ position: frames(10), name: 'Attack' }],
  loops: [
    { start: frames(1), length: frames(4), playCount: 'endless', direction: 'forward', name: 'l' },
    { start: frames(2), length: frames(2), playCount: 3, direction: 'alternating' },
  ],
  tuning: { unityNote: 60, fineTuneCents: -12.5 },
};

/** Why `value` is refused as a map, or `undefined` where it is read. */
function refusal(value: unknown): string | undefined {
  const read = readValue(value, 'test.malformed', (map) => metadataMapOf(map, 'metadata'));
  return read.ok ? undefined : read.failures[0].summary;
}

describe('a metadata map that crossed a thread', () => {
  it('reads every part back as it was sent', () => {
    expect(metadataMapOf(structuredClone(WHOLE), 'metadata')).toEqual(WHOLE);
    expect(metadataMapOf({}, 'metadata')).toEqual({});
  });

  it('refuses a key no typed field has, and values of the wrong kind or range', () => {
    expect(refusal({ text: { mood: 'Calm' } })).toContain('metadata.text.mood');
    expect(refusal({ loops: [{ ...WHOLE.loops?.[0], direction: 'sideways' }] })).toContain(
      'metadata.loops[0].direction',
    );
    expect(refusal({ loops: [{ ...WHOLE.loops?.[0], playCount: -1 }] })).toContain(
      'metadata.loops[0].playCount',
    );
    expect(refusal({ tuning: { unityNote: 128, fineTuneCents: 0 } })).toContain(
      'metadata.tuning.unityNote',
    );
    expect(refusal({ tuning: { unityNote: 60, fineTuneCents: 51 } })).toContain(
      'metadata.tuning.fineTuneCents',
    );
    expect(refusal({ cues: [{ position: 1.5, name: '' }] })).toContain('metadata.cues[0].position');
    expect(
      refusal({ coverArt: { mediaType: 'image/png', description: '', bytes: [1] } }),
    ).toContain('metadata.coverArt.bytes');
  });

  it('refuses lists and values past the bounds the readers keep', () => {
    const loop = WHOLE.loops?.[0];
    expect(refusal({ loops: Array.from({ length: MAXIMUM_LOOPS + 1 }, () => loop) })).toContain(
      'metadata.loops',
    );
    expect(refusal({ text: { title: 'x'.repeat(2_049) } })).toContain('metadata.text.title');
    expect(refusal({ text: { title: 'x'.repeat(2_048) } })).toBeUndefined();
    const picture = new Uint8Array(MAXIMUM_PICTURE_BYTES + 1);
    expect(
      refusal({ coverArt: { mediaType: 'image/png', description: '', bytes: picture } }),
    ).toContain('metadata.coverArt.bytes');
  });

  it('reads the parts a writer dropped', () => {
    const parts: readonly MetadataPart[] = [
      { kind: 'text', key: 'isrc' },
      { kind: 'foreign', scheme: 'riff', key: 'iXML' },
      { kind: 'loops' },
      { kind: 'coverArt' },
    ];
    expect(parts.map((part) => metadataPartOf(structuredClone(part), 'part'))).toEqual(parts);
    const read = readValue({ kind: 'colour' }, 'test.malformed', (part) =>
      metadataPartOf(part, 'part'),
    );
    expect(read.ok ? undefined : read.failures[0].summary).toContain('part.kind');
  });
});
