/**
 * Reading a project document's sources: where each asset's bytes are kept, how
 * an external file is known again, and how each asset was imported
 * (REQ-STOR-099, REQ-STOR-104, REQ-STOR-053, REQ-STOR-166, REQ-EXEC-136.12).
 *
 * An external identity with no length or fast fingerprint is refused: a file
 * known only by its name or path cannot be told from another file put in its
 * place (REQ-STOR-104). The aggregate's own invariants are checked here too:
 * one source for every asset, one asset for every source, and each asset's
 * storage key derived from its source.
 */

import type { Asset, AssetId } from '@audiogubbins/domain';

import type { JsonObject, JsonValue } from './canonical-json.js';
import { DIGEST_HEX } from './content-identity.js';
import {
  anyObjectOf,
  checkMembers,
  listOf,
  objectOf,
  optional,
  pathOf,
  required,
  type Converter,
  type Reading,
} from './document-reading.js';
import {
  asContentId,
  asId,
  integerConverter,
  oneOfConverter,
  textConverter,
} from './scalar-reading.js';
import {
  SourceChangePolicy,
  storageKeyOf,
  type AssetProvenance,
  type AssetSource,
  type ExternalMedia,
  type ExternalSourceIdentity,
  type ManagedMedia,
  type MediaSource,
} from './project-state.js';
import { MAXIMUM_ENTITIES, NAME_RULE, asMediaType, asWholeQuantity } from './value-reading.js';

const SOURCE_MEMBERS: ReadonlySet<string> = new Set(['assetId', 'media', 'provenance']);
const MANAGED_MEMBERS: ReadonlySet<string> = new Set([
  'kind',
  'contentId',
  'byteLength',
  'mediaType',
]);
const EXTERNAL_MEMBERS: ReadonlySet<string> = new Set([
  'kind',
  'identity',
  'policy',
  'retainedCopy',
]);
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
const PROVENANCE_MEMBERS: ReadonlySet<string> = new Set([
  'originalFileName',
  'importedAt',
  'sourceContentId',
  'sourceFingerprint',
  'byteLength',
  'mediaType',
  'originProjectId',
  'bitDepth',
]);

const asMediaKind = oneOfConverter(['managed', 'external'] as const);
const asPolicy = oneOfConverter(Object.values(SourceChangePolicy));
const asDigestHex = textConverter({
  maximumLength: 64,
  pattern: DIGEST_HEX,
  shape: '64 lower-case hexadecimal digits',
});

/** A kept handle's token: never a path, so no separator of any kind. */
const asHandleKey = textConverter({
  maximumLength: 128,
  pattern: /^[A-Za-z0-9._:-]+$/u,
  shape: 'a token of letters, digits and . _ : -',
});

/** A file's own name, with no separator: a name is never a path. */
const asFileName = textConverter({
  ...NAME_RULE,
  pattern: /^[^/\\\p{Cc}]+$/u,
  shape: 'a file name without a path',
});

/** The first bytes of a file, up to 16, as lower-case hexadecimal. */
const asSignature = textConverter({
  maximumLength: 32,
  pattern: /^(?:[0-9a-f]{2}){0,16}$/u,
  shape: 'up to 16 bytes in lower-case hexadecimal',
});

/** Bits per sample, as a container states them. */
const asBitDepth = integerConverter(1, 64);

/**
 * A path inside a directory the user granted: segments joined by `/`, none
 * empty, none `.` or `..`, and no backslash, colon or control character, so it
 * can never climb out of the directory or name a drive.
 */
const RELATIVE_PATH = /^(?:[^/\\:\p{Cc}]+\/)*[^/\\:\p{Cc}]+$/u;
const DOT_SEGMENT = /(?:^|\/)\.{1,2}(?:\/|$)/u;

const asPathText = textConverter({ maximumLength: 4_096 });

const asRelativePath: Converter<string> = (reading, value, parent, key) => {
  const text = asPathText(reading, value, parent, key);
  if (text === undefined) return undefined;
  if (!RELATIVE_PATH.test(text) || DOT_SEGMENT.test(text)) {
    reading.refuse(
      'schema.text-malformed',
      'The text is not a relative path inside the granted directory.',
      pathOf(parent, key),
    );
    return undefined;
  }
  return text;
};

/**
 * A converter reading the sources, checked against the project's assets where
 * those could be read.
 */
export function sourcesConverter(
  assets: ReadonlyMap<AssetId, Asset> | undefined,
): Converter<ReadonlyMap<AssetId, AssetSource>> {
  return (reading, value, parent, key) => {
    const list = listOf(reading, value, parent, key, MAXIMUM_ENTITIES);
    if (list === undefined) return undefined;
    const at = pathOf(parent, key);

    const sources = new Map<AssetId, AssetSource>();
    let whole = true;
    for (const [index, item] of list.entries()) {
      const read = readSource(reading, item, at, index);
      if (read === undefined) {
        whole = false;
        continue;
      }
      const [assetId, source] = read;
      const itemAt = pathOf(at, index);
      if (sources.has(assetId)) {
        reading.refuse(
          'schema.duplicate-id',
          'Another source belongs to the same asset.',
          pathOf(itemAt, 'assetId'),
        );
        continue;
      }
      sources.set(assetId, source);
      checkAgainstAsset(reading, assetId, source, assets, itemAt);
    }

    if (assets !== undefined) {
      for (const assetId of assets.keys()) {
        if (!sources.has(assetId)) {
          reading.refuse('source.missing', 'An asset has no source.', at, { assetId });
        }
      }
    }
    return whole ? sources : undefined;
  };
}

/** Checks a source against the asset it belongs to. */
function checkAgainstAsset(
  reading: Reading,
  assetId: AssetId,
  source: AssetSource,
  assets: ReadonlyMap<AssetId, Asset> | undefined,
  at: string,
): void {
  if (assets === undefined) return;
  const asset = assets.get(assetId);
  if (asset === undefined) {
    reading.refuse(
      'source.unknown-asset',
      'The source belongs to an asset the project does not have.',
      pathOf(at, 'assetId'),
    );
  } else if (asset.storageKey !== storageKeyOf(assetId, source.media)) {
    reading.refuse(
      'source.storage-key-mismatch',
      "The asset's storage key is not the one its source gives.",
      pathOf(at, 'media'),
      {
        assetId,
      },
    );
  }
}

/** Reads one source and the asset it belongs to. */
function readSource(
  reading: Reading,
  value: JsonValue,
  parent: string,
  key: number,
): readonly [AssetId, AssetSource] | undefined {
  const object = objectOf(reading, value, parent, key, SOURCE_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);

  const assetId = required(reading, object, at, 'assetId', asId<'AssetId'>);
  const media = required(reading, object, at, 'media', asMedia);
  const provenance = optional(reading, object, at, 'provenance', asProvenance);
  if (assetId === undefined || media === undefined) return undefined;
  return [assetId, { media, ...(provenance === undefined ? {} : { provenance }) }];
}

const asMedia: Converter<MediaSource> = (reading, value, parent, key) => {
  const object = anyObjectOf(reading, value, parent, key);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);

  const kind = required(reading, object, at, 'kind', asMediaKind);
  if (kind === 'managed') {
    checkMembers(reading, object, at, MANAGED_MEMBERS);
    return readManaged(reading, object, at);
  }
  if (kind === 'external') {
    checkMembers(reading, object, at, EXTERNAL_MEMBERS);
    return readExternal(reading, object, at);
  }
  return undefined;
};

function readManaged(reading: Reading, object: JsonObject, at: string): ManagedMedia | undefined {
  const contentId = required(reading, object, at, 'contentId', asContentId);
  const byteLength = required(reading, object, at, 'byteLength', asWholeQuantity);
  const mediaType = required(reading, object, at, 'mediaType', asMediaType);
  return contentId === undefined || byteLength === undefined || mediaType === undefined
    ? undefined
    : { kind: 'managed', contentId, byteLength, mediaType };
}

function readExternal(reading: Reading, object: JsonObject, at: string): ExternalMedia | undefined {
  const identity = required(reading, object, at, 'identity', asIdentity);
  const policy = required(reading, object, at, 'policy', asPolicy);
  const retainedCopy = optional(reading, object, at, 'retainedCopy', asContentId);

  if (policy === SourceChangePolicy.Freeze && retainedCopy === undefined) {
    reading.refuse(
      'source.freeze-without-retained-copy',
      'A frozen source keeps a copy of the version it froze.',
      pathOf(at, 'policy'),
    );
  }
  if (identity === undefined || policy === undefined) return undefined;
  return {
    kind: 'external',
    identity,
    policy,
    ...(retainedCopy === undefined ? {} : { retainedCopy }),
  };
}

const asIdentity: Converter<ExternalSourceIdentity> = (reading, value, parent, key) => {
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

const asProvenance: Converter<AssetProvenance> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, PROVENANCE_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);

  const originalFileName = optional(reading, object, at, 'originalFileName', asFileName);
  const importedAt = required(reading, object, at, 'importedAt', asWholeQuantity);
  const sourceContentId = optional(reading, object, at, 'sourceContentId', asContentId);
  const sourceFingerprint = optional(reading, object, at, 'sourceFingerprint', asDigestHex);
  const byteLength = required(reading, object, at, 'byteLength', asWholeQuantity);
  const mediaType = required(reading, object, at, 'mediaType', asMediaType);
  const originProjectId = required(reading, object, at, 'originProjectId', asId<'ProjectId'>);
  const bitDepth = optional(reading, object, at, 'bitDepth', asBitDepth);

  if (
    importedAt === undefined ||
    byteLength === undefined ||
    mediaType === undefined ||
    originProjectId === undefined
  ) {
    return undefined;
  }
  return {
    ...(originalFileName === undefined ? {} : { originalFileName }),
    importedAt,
    ...(sourceContentId === undefined ? {} : { sourceContentId }),
    ...(sourceFingerprint === undefined ? {} : { sourceFingerprint }),
    byteLength,
    mediaType,
    originProjectId,
    ...(bitDepth === undefined ? {} : { bitDepth }),
  };
};
