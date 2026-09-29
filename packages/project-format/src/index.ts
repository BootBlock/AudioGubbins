/**
 * The public contract of the AudioGubbins project format.
 *
 * The authoritative, versioned project (ADR-0020): the aggregate
 * {@link ProjectState}, the identity of content and of states, the documents a
 * project is written as, and the one rule of schema compatibility. What is
 * persisted is converted field by field and validated when read
 * (REQ-EXEC-136.12), so a change to a domain value is never silently a change
 * to users' stored projects (ADR-0015, REQ-STOR-052).
 *
 * The package is pure. It reaches no browser or Node global: bytes arrive
 * through {@link ByteSource} and leave through {@link ByteSink}, the digest is
 * injected as {@link Digest}, and UTF-8 and JSON are its own, so the storage
 * packages above it decide where everything is kept and the tests here run
 * without a browser.
 *
 * The helpers for reading and writing a document are offered with the
 * documents, so every document of the format is read and refused the same way.
 * Everything absent from this list is internal and may change without being a
 * contract change (REQ-REPO-186).
 */

export { decodeUtf8, encodeUtf8 } from './utf8.js';

export {
  type CanonicalJson,
  type JsonArray,
  type JsonObject,
  type JsonValue,
  canonicalJson,
  compareCodeUnits,
  isJsonArray,
  isJsonObject,
  memberOf,
  prettyCanonicalJson,
} from './canonical-json.js';

export { type JsonLimits, parseJson } from './json-parsing.js';

export { type ByteSink, type ByteSource, type Digest } from './byte-ports.js';

export {
  type StorageTree,
  type TreeEntry,
  TreeFailure,
  TreeFailureKind,
  isTreePath,
  isTreeSegment,
} from './storage-tree.js';

export {
  type ContentId,
  DIGEST_HEX,
  type StateFingerprint,
  contentIdFrom,
  hexOf,
  isContentId,
  isStateFingerprint,
  stateFingerprintFrom,
} from './content-identity.js';

export {
  CONTENT_CHUNK_BYTES,
  type ContentHasher,
  type ContentIdentity,
  type HashingOptions,
  contentIdOf,
  createContentHasher,
  fingerprintOf,
} from './content-hashing.js';

export {
  type AssetProvenance,
  type AssetSource,
  DEFAULT_SOURCE_CHANGE_POLICY,
  type ExternalMedia,
  type ExternalSourceIdentity,
  type ManagedMedia,
  type MediaSource,
  type ProjectState,
  SourceChangePolicy,
  emptyProjectState,
  storageKeyOf,
} from './project-state.js';

export {
  ExportDestinationKind,
  type ExportDestination,
  type ExportOutput,
  type ExportRecipeReference,
  type ExportRecord,
  type ExportRecordId,
  ExportStatus,
  type GodotLinkage,
} from './export-provenance.js';

export {
  ProvenanceLevel,
  stripAssetProvenance,
  stripExportRecords,
} from './provenance-stripping.js';

export {
  type Converter,
  type ProblemDetails,
  type Reading,
  anyObjectOf,
  checkMembers,
  entitiesOf,
  listConverter,
  listOf,
  objectOf,
  optional,
  pathOf,
  required,
  startReading,
} from './document-reading.js';
export {
  type TextRule,
  asBoolean,
  asContentId,
  asId,
  integerConverter,
  numberConverter,
  oneOfConverter,
  textConverter,
} from './scalar-reading.js';

export { presentMembers, sortedBy } from './document-writing.js';

export {
  type Compatibility,
  type FormatHeader,
  compatibilityOf,
  readCompatibleHeader,
  readFormatHeader,
} from './compatibility.js';

export {
  PROJECT_DOCUMENT_FORMAT,
  parseProjectDocument,
  readProjectDocument,
  serialiseProjectDocument,
  stateFingerprintOf,
  writeProjectDocument,
} from './project-json.js';

export { type AssetRecord, readAssetRecord, writeAssetRecord } from './asset-record-json.js';
export { readExternalIdentity, readMediaSource } from './source-reading.js';
export { writeExternalIdentity, writeMediaSource } from './project-writing.js';
export { isFileName, isHandleKey, isRelativePath } from './source-rules.js';
export { LONGEST_NAME, isMediaType, isWholeQuantity } from './value-reading.js';

export { readExportRecord, writeExportRecord } from './export-record-json.js';

export {
  type ZipEntryInput,
  type ZipWritingOptions,
  type ZipWritten,
  writeZip,
} from './zip-writing.js';
export {
  type VerifiedReadingOptions,
  type ZipArchive,
  type ZipEntry,
  type ZipReadingOptions,
  openZip,
  readVerified,
} from './zip-reading.js';
export { type ZipLimits } from './zip-end-records.js';

export {
  type AffectedEntities,
  type ChangeNodeRecord,
  DEFAULT_RETENTION_POLICY,
  type HistoryLabel,
  type HistoryNodeId,
  type HistoryNodeRecord,
  type HistoryRecord,
  type InvocationRecord,
  type NamedSnapshot,
  type OriginNodeRecord,
  type ProjectOrigin,
  type RetentionPolicy,
  type RetentionRule,
  type SnapshotId,
  type SnapshotKind,
  historyLabelFrom,
} from './history-record.js';
export {
  LONGEST_CHANGE_DESCRIPTION,
  readHistoryNodeRecord,
  writeHistoryNodeRecord,
} from './history-node-json.js';
export { readHistoryLabel, readSnapshotRecord, writeSnapshotRecord } from './snapshot-json.js';
export { readHistoryRecord, writeHistoryRecord } from './history-json.js';
export { readRetentionPolicy, writeRetentionPolicy } from './retention-json.js';

export {
  type ProjectTreeContent,
  type ProjectTreeFile,
  type ProjectTreeHistory,
  type ProjectTreeScope,
  type TreeCache,
  type TreeFileBody,
  type TreeMedia,
  projectTree,
} from './project-tree-writing.js';
export { isProjectTreePath, isWithinProjectTree } from './project-tree-layout.js';
export { type ProjectTreeListing, type TreeListedFile } from './project-tree-files.js';
export { readProjectTree } from './project-tree-reading.js';
export {
  BUNDLE_MANIFEST_PATH,
  type BundleManifest,
  type ManifestEntry,
  readBundleManifest,
  writeBundleManifest,
} from './bundle-manifest.js';
