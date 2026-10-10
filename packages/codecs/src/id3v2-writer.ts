/**
 * An ID3v2.4 tag of a map, for the head of an MP3 file (ADR-0093).
 *
 * Every text is UTF-8 (encoding 3) and no frame is unsynchronised, which
 * version 2.4 allows of any player that reads it. The tag carries `TIT2`,
 * `TPE1`, `TALB`, `TPE2`, `TRCK` and `TPOS` as `n/m`, `TDRC`, `TCON`, `COMM`
 * with no description, `TCOP`, `TSSE`, `TSRC`, the cover as an `APIC` front
 * cover, the loop as `TXXX` `LOOPSTART` and `LOOPLENGTH`, and foreign fields as
 * their own text frame where the key names a text frame the writer does not
 * write itself, and as `TXXX` with the key as its description otherwise. A date
 * that is not the ISO 8601 form `TDRC` requires is reported rather than
 * written, as is a total with no number to go with it.
 */

import { ByteWriter, concatenate } from './byte-writer.js';
import { writableMediaType } from './flac-picture.js';
import { NUMBER_FRAMES, TEXT_FRAMES, WRITTEN_FRAMES } from './id3v2-frames.js';
import { LOOP_LENGTH_TAG, LOOP_START_TAG, loopTagPart, taggedLoop } from './loop-tags.js';
import type { CoverArt, MetadataMap, MetadataPart } from './metadata-map.js';
import { ALL_TEXT_KEYS, partsNotHeld } from './metadata-parts.js';
import { encodeLatin1, encodeUtf8 } from './metadata-text.js';

const UTF8 = 3;

/** The front cover, in `APIC`'s numbering. */
const FRONT_COVER = 3;

/** The language of a comment whose language is not stated: ISO 639-2's undetermined. */
const UNKNOWN_LANGUAGE = 'und';

/** The timestamps `TDRC` holds: a year, then month, day, hour, minute and second, as far as known. */
const ID3_TIMESTAMP = /^\d{4}(-\d{2}(-\d{2}(T\d{2}(:\d{2}(:\d{2})?)?)?)?)?$/;

/** A text frame id a foreign key may name: T and three capitals or digits. */
const TEXT_FRAME_ID = /^T[A-Z0-9]{3}$/;

/** The largest frame or tag a synchsafe size states. */
const LARGEST_SYNCHSAFE = 2 ** 28 - 1;

/** A format holding no part of a map. */
const NOTHING_HELD = {
  text: new Set<never>(),
  broadcast: false,
  cues: false,
  tuning: false,
  coverArt: false,
};

/** A synchsafe integer of four bytes. */
function synchsafe(writer: ByteWriter, value: number): ByteWriter {
  return writer
    .u8((value >> 21) & 0x7f)
    .u8((value >> 14) & 0x7f)
    .u8((value >> 7) & 0x7f)
    .u8(value & 0x7f);
}

const frame = (id: string, body: Uint8Array): Uint8Array =>
  concatenate([synchsafe(new ByteWriter().latin1(id), body.length).u16(0).toBytes(), body]);

const textFrame = (id: string, value: string): Uint8Array =>
  frame(id, concatenate([Uint8Array.of(UTF8), encodeUtf8(value)]));

const userText = (description: string, value: string): Uint8Array =>
  frame(
    'TXXX',
    concatenate([
      Uint8Array.of(UTF8),
      encodeUtf8(description),
      Uint8Array.of(0),
      encodeUtf8(value),
    ]),
  );

/** An ID3v2.4 tag written, and the parts of the map it could not hold. */
export interface WrittenId3v2 {
  readonly bytes: Uint8Array;
  readonly dropped: readonly MetadataPart[];
}

/** The ID3v2.4 tag of `map`, or no bytes where the map holds nothing the tag carries. */
export function encodeId3v2(map: MetadataMap): WrittenId3v2 {
  const { frames, dropped } = textFrames(map);

  const { loop, partial } = taggedLoop(map.loops);
  if (loop !== undefined) {
    frames.push(
      userText(LOOP_START_TAG, String(loop.start)),
      userText(LOOP_LENGTH_TAG, String(loop.length)),
    );
  }
  if (partial) dropped.push({ kind: 'loops' });

  for (const field of map.foreign ?? []) {
    if (field.key === '' || loopTagPart(field.key) !== undefined || field.key.includes('\0')) {
      dropped.push({ kind: 'foreign', scheme: field.scheme, key: field.key });
    } else if (TEXT_FRAME_ID.test(field.key) && !WRITTEN_FRAMES.has(field.key)) {
      frames.push(textFrame(field.key, field.value));
    } else {
      frames.push(userText(field.key, field.value));
    }
  }

  let size = frames.reduce((sum, one) => sum + one.length, 0);
  if (map.coverArt !== undefined) {
    const picture = pictureFrame(map.coverArt);
    // A picture past what a synchsafe size states has no place in the tag.
    if (picture === undefined || size + picture.length > LARGEST_SYNCHSAFE) {
      dropped.push({ kind: 'coverArt' });
    } else {
      frames.push(picture);
      size += picture.length;
    }
  }
  if (frames.length === 0) return { bytes: new Uint8Array(), dropped };
  // Text alone this large has no tag to go in: nothing of the map is written.
  if (size > LARGEST_SYNCHSAFE) return { bytes: new Uint8Array(), dropped: everyPart(map) };
  const header = synchsafe(new ByteWriter().latin1('ID3').u8(4).u8(0).u8(0), size).toBytes();
  return { bytes: concatenate([header, ...frames]), dropped };
}

/** The frames of the map's text, and the text keys they cannot hold, with every part no frame holds. */
function textFrames(map: MetadataMap): { frames: Uint8Array[]; dropped: MetadataPart[] } {
  const dropped: MetadataPart[] = partsNotHeld(map, {
    text: ALL_TEXT_KEYS,
    broadcast: false,
    cues: false,
    tuning: false,
    coverArt: true,
  });
  const frames: Uint8Array[] = [];
  const text = map.text ?? {};
  const present = (value: string | undefined): value is string =>
    value !== undefined && value !== '';

  for (const [key, id] of TEXT_FRAMES) {
    const value = text[key];
    if (!present(value)) continue;
    if (key === 'date' && !ID3_TIMESTAMP.test(value)) dropped.push({ kind: 'text', key });
    else frames.push(textFrame(id, value));
  }
  for (const [id, [numberKey, totalKey]] of Object.entries(NUMBER_FRAMES)) {
    const number = text[numberKey];
    const total = text[totalKey];
    if (present(number)) frames.push(textFrame(id, present(total) ? `${number}/${total}` : number));
    else if (present(total)) dropped.push({ kind: 'text', key: totalKey });
  }
  if (present(text.comment)) {
    const language = encodeLatin1(UNKNOWN_LANGUAGE) ?? new Uint8Array(3);
    const body = [Uint8Array.of(UTF8), language, Uint8Array.of(0), encodeUtf8(text.comment)];
    frames.push(frame('COMM', concatenate(body)));
  }
  return { frames, dropped };
}

/** The cover as an `APIC` front cover, or `undefined` where its media type is not printable ASCII. */
function pictureFrame(cover: CoverArt): Uint8Array | undefined {
  const mediaType = writableMediaType(cover.mediaType) ? encodeLatin1(cover.mediaType) : undefined;
  if (mediaType === undefined) return undefined;
  return frame(
    'APIC',
    concatenate([
      Uint8Array.of(UTF8),
      mediaType,
      Uint8Array.of(0, FRONT_COVER),
      encodeUtf8(cover.description),
      Uint8Array.of(0),
      cover.bytes,
    ]),
  );
}

/** Every part of the map, as a tag that writes none of it reports them. */
function everyPart(map: MetadataMap): MetadataPart[] {
  return [
    ...partsNotHeld(map, NOTHING_HELD),
    ...((map.loops?.length ?? 0) > 0 ? [{ kind: 'loops' } as const] : []),
    ...(map.foreign ?? []).map(
      (field) => ({ kind: 'foreign', scheme: field.scheme, key: field.key }) as const,
    ),
  ];
}
