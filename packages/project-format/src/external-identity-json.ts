/**
 * Writing and reading what an external file was known by when it was last
 * seen (REQ-STOR-104, REQ-EXEC-136.12), by one rule wherever it is kept: a
 * linked asset's media, a command's argument, and the compressed file a
 * rendition was decoded from.
 *
 * An identity with no length or fast fingerprint is refused: a file known only
 * by its name or path cannot be told from another file put in its place.
 */

import type { JsonObject } from './canonical-json.js';
import { DIGEST_HEX } from './content-identity.js';
import { objectOf, optional, pathOf, required, type Converter } from './document-reading.js';
import { presentMembers } from './document-writing.js';
import type { ExternalSourceIdentity } from './project-state.js';
import { asContentId, textConverter } from './scalar-reading.js';
import { asFileName, asHandleKey, asRelativePath } from './source-rules.js';
import { asMediaType, asWholeQuantity } from './value-reading.js';

const IDENTITY_MEMBERS: ReadonlySet<string> = new Set([
  'handleKey',
  'fileName',
  'relativePath',
  'byteLength',
  'lastModified',
  'mediaType',
  'signature',
  'fastFingerprint',
  'contentId',
]);

/** A digest in hexadecimal, as a fingerprint is written. */
export const asDigestHex = textConverter({
  maximumLength: 64,
  pattern: DIGEST_HEX,
  shape: '64 lower-case hexadecimal digits',
});

/** The first bytes of a file, up to 16, as lower-case hexadecimal. */
const asSignature = textConverter({
  maximumLength: 32,
  pattern: /^(?:[0-9a-f]{2}){0,16}$/u,
  shape: 'up to 16 bytes in lower-case hexadecimal',
});

/** Reads what an external file was known by when it was last seen. */
export const readExternalIdentity: Converter<ExternalSourceIdentity> = (
  reading,
  value,
  parent,
  key,
) => {
  const object = objectOf(reading, value, parent, key, IDENTITY_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);

  const handleKey = optional(reading, object, at, 'handleKey', asHandleKey);
  const fileName = optional(reading, object, at, 'fileName', asFileName);
  const relativePath = optional(reading, object, at, 'relativePath', asRelativePath);
  const byteLength = required(reading, object, at, 'byteLength', asWholeQuantity);
  const lastModified = required(reading, object, at, 'lastModified', asWholeQuantity);
  const mediaType = required(reading, object, at, 'mediaType', asMediaType);
  const signature = required(reading, object, at, 'signature', asSignature);
  const fastFingerprint = required(reading, object, at, 'fastFingerprint', asDigestHex);
  const contentId = optional(reading, object, at, 'contentId', asContentId);

  if (
    byteLength === undefined ||
    lastModified === undefined ||
    mediaType === undefined ||
    signature === undefined ||
    fastFingerprint === undefined
  ) {
    return undefined;
  }
  return {
    ...(handleKey === undefined ? {} : { handleKey }),
    ...(fileName === undefined ? {} : { fileName }),
    ...(relativePath === undefined ? {} : { relativePath }),
    byteLength,
    lastModified,
    mediaType,
    signature,
    fastFingerprint,
    ...(contentId === undefined ? {} : { contentId }),
  };
};

/** Writes what an external file was known by when it was last seen. */
export function writeExternalIdentity(identity: ExternalSourceIdentity): JsonObject {
  return presentMembers({
    handleKey: identity.handleKey,
    fileName: identity.fileName,
    relativePath: identity.relativePath,
    byteLength: identity.byteLength,
    lastModified: identity.lastModified,
    mediaType: identity.mediaType,
    signature: identity.signature,
    fastFingerprint: identity.fastFingerprint,
    contentId: identity.contentId,
  });
}
