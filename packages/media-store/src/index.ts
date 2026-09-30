/**
 * The public contract of the AudioGubbins media store.
 *
 * Source media by content (ADR-0020): the object store every project's managed
 * media shares, kept once by its content identity and trusted only once sealed
 * (REQ-STOR-099); bringing a file in by copy or by reference (REQ-STOR-025);
 * the identity an external file is recognised by, taken at once and completed
 * in the background (REQ-STOR-104); what became of an external source and what
 * its change policy offers or does (REQ-STOR-053); and reachability with a
 * collection that is planned first and carried out only on confirmation
 * (REQ-STOR-102, REQ-STOR-106).
 *
 * The package is pure. Files arrive as byte sources through the platform
 * adapter, the store keeps its objects through the storage tree, and the
 * digest, the tokens and the yielding to the host are injected, so every rule
 * here is tested without a browser. No media file is ever whole in memory
 * (REQ-EXEC-216), and every failure the platform can cause is a designed one
 * (REQ-EXEC-136.15). Everything absent from this list is internal and may
 * change without being a contract change (REQ-REPO-186).
 */

export { type ExternalFile } from './external-file.js';

export {
  type MediaSharing,
  MediaObjectStore,
  type MediaStoreServices,
  type PutOutcome,
  type RecoveryReport,
  type StoredObject,
  type TokenSource,
} from './object-store.js';

export { type PutOptions, type StoreProgress } from './object-writing.js';

export {
  type ImportChoice,
  type ImportRequest,
  type ImportServices,
  type ImportedMedia,
  importMedia,
} from './media-import.js';

export { type YieldToHost } from './progressive-hashing.js';

export {
  type CompletionServices,
  completeIdentity,
  examineFile,
  observeFile,
} from './source-observation.js';

export {
  type AbsenceReason,
  type MatchConfidence,
  type SignalEvidence,
  type SignalMatch,
  type SourceClassification,
  type SourceObservation,
  classifySource,
} from './source-classification.js';

export {
  type ResolutionChoice,
  type ResolutionKind,
  type ResolutionPlan,
  type UnavailableReason,
  resolutionsFor,
} from './source-resolution.js';

export {
  type CollectionPlan,
  type CollectionReport,
  type ContentRoots,
  type PurgeConfirmation,
  collect,
  contentReferencedBy,
  planCollection,
} from './collection.js';
