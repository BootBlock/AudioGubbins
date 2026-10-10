/**
 * Vorbis comments on their own: the names other taggers write that the reader
 * accepts, the loop variants, repeated fields, the picture field, and the keys
 * the writer cannot write.
 */

import { expect, describe, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { ByteWriter } from './byte-writer.js';
import { MetadataGathering } from './metadata-gathering.js';
import { encodeUtf8 } from './metadata-text.js';
import { frames, fullMetadata } from './testing/index.js';
import { decodeVorbisComment, encodeVorbisComment } from './vorbis-comment.js';

/** A comment block of these comments, as another tagger might write it. */
function block(comments: readonly string[], vendor = 'other tagger'): Uint8Array {
  const vendorBytes = encodeUtf8(vendor);
  const writer = new ByteWriter()
    .u32(vendorBytes.length, true)
    .bytes(vendorBytes)
    .u32(comments.length, true);
  for (const comment of comments) {
    const bytes = encodeUtf8(comment);
    writer.u32(bytes.length, true).bytes(bytes);
  }
  return writer.toBytes();
}

const read = (bytes: Uint8Array) => {
  const gathering = new MetadataGathering();
  expectSuccess(decodeVorbisComment(bytes, gathering));
  return gathering.toMap();
};

describe('Vorbis comments', () => {
  it('round-trips every field with the picture carried as METADATA_BLOCK_PICTURE', () => {
    const written = encodeVorbisComment(fullMetadata(), {
      vendor: 'AudioGubbins',
      pictureField: true,
    });
    expect(written.dropped).toEqual([]);
    expect(read(written.bytes)).toEqual(fullMetadata());
  });

  it('reads the other names taggers write, without regard to case', () => {
    expect(
      read(
        block([
          'title=lower',
          'Description=A description',
          'ALBUM ARTIST=Spaced',
          'TRACKNUMBER=3/12',
          'DISCNUMBER=1',
          'TOTALDISCS=2',
          'ARTIST=One',
          'ARTIST=Two',
          'no separator',
          '=no key',
        ]),
      ),
    ).toEqual({
      text: {
        title: 'lower',
        comment: 'A description',
        albumArtist: 'Spaced',
        artist: 'One; Two',
        discTotal: '2',
        trackNumber: '3',
        trackTotal: '12',
        discNumber: '1',
      },
    });
  });

  it('reads LOOP_START with LOOPEND, the end the first frame after the loop', () => {
    expect(read(block(['LOOP_START=100', 'LOOPEND=400'])).loops).toEqual([
      { start: 100, length: 300, playCount: 'endless', direction: 'forward' },
    ]);
    expect(read(block(['loopstart=7', 'Loop_Length=9'])).loops).toEqual([
      { start: 7, length: 9, playCount: 'endless', direction: 'forward' },
    ]);
  });

  it('keeps loop tags that state no loop as the fields they are', () => {
    expect(read(block(['LOOPSTART=100']))).toEqual({
      foreign: [{ scheme: 'vorbis-comment', key: 'LOOPSTART', value: '100' }],
    });
    expect(read(block(['LOOPSTART=soon', 'LOOPLENGTH=5']))).toEqual({
      foreign: [
        { scheme: 'vorbis-comment', key: 'LOOPSTART', value: 'soon' },
        { scheme: 'vorbis-comment', key: 'LOOPLENGTH', value: '5' },
      ],
    });
  });

  it('reports loops past the one the tags hold, keys it cannot write, and the cues and tuning', () => {
    const written = encodeVorbisComment(
      {
        loops: [
          { start: frames(0), length: frames(10), playCount: 'endless', direction: 'forward' },
          { start: frames(20), length: frames(10), playCount: 'endless', direction: 'forward' },
        ],
        foreign: [
          { scheme: 'riff-info', key: 'ICMT=', value: 'x' },
          { scheme: 'id3v2', key: 'TÉMPO', value: 'x' },
          { scheme: 'ilst', key: 'title', value: 'shadow' },
          { scheme: 'ilst', key: 'MOODY', value: 'ok' },
        ],
        cues: [{ position: frames(5), name: 'x' }],
        tuning: { unityNote: 60, fineTuneCents: 0 },
      },
      { vendor: 'v', pictureField: false },
    );
    expect(written.dropped).toEqual([
      { kind: 'cues' },
      { kind: 'tuning' },
      { kind: 'loops' },
      { kind: 'foreign', scheme: 'riff-info', key: 'ICMT=' },
      { kind: 'foreign', scheme: 'id3v2', key: 'TÉMPO' },
      { kind: 'foreign', scheme: 'ilst', key: 'title' },
    ]);
    expect(read(written.bytes)).toEqual({
      foreign: [{ scheme: 'vorbis-comment', key: 'MOODY', value: 'ok' }],
      loops: [{ start: 0, length: 10, playCount: 'endless', direction: 'forward' }],
    });
  });

  it('keeps a front cover over a picture of another kind, whichever comes first', () => {
    const picture = (type: number, byte: number) => {
      const body = new ByteWriter()
        .u32(type)
        .u32(9)
        .latin1('image/png')
        .u32(0)
        .zeros(16)
        .u32(1)
        .u8(byte)
        .toBytes();
      let text = '';
      // Base64 of the body, written here so the test does not lean on the module it checks.
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      for (let at = 0; at < body.length; at += 3) {
        const triple = ((body[at] ?? 0) << 16) | ((body[at + 1] ?? 0) << 8) | (body[at + 2] ?? 0);
        const left = body.length - at;
        text += alphabet.charAt(triple >> 18) + alphabet.charAt((triple >> 12) & 63);
        text += left > 1 ? alphabet.charAt((triple >> 6) & 63) : '=';
        text += left > 2 ? alphabet.charAt(triple & 63) : '=';
      }
      return `METADATA_BLOCK_PICTURE=${text}`;
    };
    expect(read(block([picture(4, 1), picture(3, 2), picture(3, 3)])).coverArt?.bytes).toEqual(
      Uint8Array.of(2),
    );
    expect(read(block([picture(4, 1), picture(5, 2)])).coverArt?.bytes).toEqual(Uint8Array.of(1));
    expect(read(block(['METADATA_BLOCK_PICTURE=not base64!']))).toEqual({});
  });

  it('refuses a block whose lengths run past it', () => {
    const whole = block(['TITLE=x']);
    for (const cut of [2, 6, whole.length - 1]) {
      const gathering = new MetadataGathering();
      expect(expectFailureCode(decodeVorbisComment(whole.subarray(0, cut), gathering))).toBe(
        'codecs.malformed',
      );
    }
  });
});
