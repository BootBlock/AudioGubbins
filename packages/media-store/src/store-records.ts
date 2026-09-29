/**
 * The two small records the media store writes beside its objects: the seal
 * that makes an object trusted, and the intent that names the object a
 * multi-step change is working on (REQ-STOR-099, REQ-EXEC-136.15).
 *
 * The storage tree has no atomic write (ADR-0020), so each record is one line
 * of text ending in the SHA-256 of what precedes it. A torn record fails its
 * check and reads as no record at all, which the store's protocol treats as the
 * safe case: an object without a seal is never trusted, and an intent that
 * cannot be read was torn before the change it announces began.
 *
 * The leading word and `1` say what the line is and which construction wrote
 * it. The whole media layout, these records included, is versioned by the
 * storage root's `projectStorage` schema, so a build never meets a record of
 * another construction; a line of any other form is not a record.
 */

import { unsafeBrandId } from '@audiogubbins/domain';
import {
  decodeUtf8,
  encodeUtf8,
  hexOf,
  type ContentId,
  type Digest,
} from '@audiogubbins/project-format';

/** What a seal says: the object of this identity is whole, at this length. */
export interface SealRecord {
  readonly contentId: ContentId;
  readonly byteLength: number;
}

const SEAL = /^audiogubbins-media-seal 1 (c1-[0-9a-f]{64}) (0|[1-9][0-9]{0,15})$/u;
const INTENT = /^audiogubbins-media-intent 1 (c1-[0-9a-f]{64})$/u;

/** A line and its check: the text, a space, 64 hexadecimal digits, a newline. */
const CHECKED_LINE = /^([^\n]+) ([0-9a-f]{64})\n$/u;

/** The bytes of a seal for an object. */
export async function sealBytes(
  record: SealRecord,
  digest: Digest,
): Promise<Uint8Array<ArrayBuffer>> {
  return await checkedLine(
    `audiogubbins-media-seal 1 ${record.contentId} ${String(record.byteLength)}`,
    digest,
  );
}

/** The seal the bytes hold, or `undefined` where they are torn or not a seal. */
export async function readSeal(bytes: Uint8Array, digest: Digest): Promise<SealRecord | undefined> {
  const body = await checkedBody(bytes, digest);
  const match = body === undefined ? null : SEAL.exec(body);
  if (match === null) return undefined;
  const [, contentId = '', length = ''] = match;
  const byteLength = Number(length);
  return Number.isSafeInteger(byteLength)
    ? { contentId: contentIdOfMatch(contentId), byteLength }
    : undefined;
}

/** The bytes of an intent naming the object a change is working on. */
export async function intentBytes(
  contentId: ContentId,
  digest: Digest,
): Promise<Uint8Array<ArrayBuffer>> {
  return await checkedLine(`audiogubbins-media-intent 1 ${contentId}`, digest);
}

/** The object an intent names, or `undefined` where it is torn or not an intent. */
export async function readIntent(
  bytes: Uint8Array,
  digest: Digest,
): Promise<ContentId | undefined> {
  const body = await checkedBody(bytes, digest);
  const match = body === undefined ? null : INTENT.exec(body);
  const contentId = match?.[1];
  return contentId === undefined ? undefined : contentIdOfMatch(contentId);
}

async function checkedLine(body: string, digest: Digest): Promise<Uint8Array<ArrayBuffer>> {
  return encodeUtf8(`${body} ${hexOf(await digest(encodeUtf8(body)))}\n`);
}

async function checkedBody(bytes: Uint8Array, digest: Digest): Promise<string | undefined> {
  const text = decodeUtf8(bytes);
  const match = text.ok ? CHECKED_LINE.exec(text.value) : null;
  if (match === null) return undefined;
  const [, body = '', check = ''] = match;
  return hexOf(await digest(encodeUtf8(body))) === check ? body : undefined;
}

/**
 * A content identifier the record patterns have already matched.
 *
 * Minted here rather than read through `contentIdFrom`, whose refusal could
 * never happen: both patterns hold the identifier to exactly its shape.
 */
function contentIdOfMatch(text: string): ContentId {
  return unsafeBrandId<'ContentId'>(text);
}
