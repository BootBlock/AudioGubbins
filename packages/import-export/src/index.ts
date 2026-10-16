/**
 * The public contract of AudioGubbins import and export (ADR-0090, ADR-0092).
 *
 * Import and export as values: the typed export settings of every format and
 * their validation against a codec's descriptor, the presets and the
 * highest-quality defaults, the plan of an export's files with the graph
 * each renders through, the dither and quantisation, the metadata a file
 * carries, the collision rules of a destination, and the export, batch and
 * import jobs as state machines.
 *
 * Portable: no browser or Node global, so the codec worker, the storage
 * worker, the page and a test run the same rules. The registry reaches it
 * through an injected lookup, and the workers that do the work report it as
 * events.
 */

export {
  type AacEncoding,
  type AifcEncoding,
  type AiffEncoding,
  type ChannelConversion,
  type CodedPcm,
  type CommonExportSettings,
  type DitherSettings,
  type ExportFormat,
  type ExportRange,
  type ExportSettings,
  type ExportSettingsOf,
  type FlacEncoding,
  type FloatPcm,
  type FormatEncoding,
  type FormatEncodingOf,
  type FormatEncodings,
  type IntegerPcm,
  type MetadataEdit,
  type MetadataPolicy,
  type MetadataSettings,
  type Mp3Encoding,
  type NoiseShaping,
  type OpusApplication,
  type OpusEncoding,
  type OpusFrameDuration,
  type VorbisEncoding,
  type WavEncoding,
} from './export-settings.js';

export {
  type CodecLookup,
  type ExportContext,
  type ExportSource,
  type ExportableAudio,
  type ExportableRegion,
  type SourcePrecision,
} from './export-context.js';

export { type ExportTarget, exportTarget, formatName } from './export-formats.js';
export { validateExportSettings } from './settings-validation.js';
export { defaultDither, defaultExportSettings } from './default-settings.js';
export {
  BUILT_IN_PRESETS,
  type ExportPreset,
  type PresetChoices,
  resolvePreset,
} from './export-presets.js';

export { type PlannedFile, planExport } from './export-plan.js';
export { type ExportSpan } from './export-range.js';
export { type ExportRenderPlan } from './export-render-plan.js';
export { type ExportClock, dateOf } from './file-name-template.js';
export {
  type ExportFileName,
  type FolderSegmentProblem,
  folderSegmentProblem,
  safeFileName,
  safeFolderName,
} from './file-name-safety.js';
export {
  type TemplatePart,
  type TemplateVocabulary,
  escapeTemplateText,
  readTemplate,
} from './template-grammar.js';

export { type EncodingFacts, encodingProblems } from './encoding-rules.js';
export { offeredBitRates } from './offered-bit-rates.js';
export { bitRatesWords } from './bit-rate-words.js';

export { Quantiser, type QuantiserSettings } from './quantiser.js';
export { type MetadataRates, exportMetadata } from './export-metadata.js';

export {
  type AnsweredDecision,
  type CollisionAnswer,
  type CollisionDecision,
  type CollisionPolicy,
  type CollisionQuery,
  type ExportedFileRecord,
  type ListedFileContent,
  type TrustedFolder,
  answerCollision,
  decideCollision,
} from './collision-policy.js';

export {
  type DeliveryTarget,
  type ExportJob,
  type ExportJobEvent,
  type ExportJobState,
  type ExportStage,
  type StagedFile,
  nextExportJob,
  plannedExport,
} from './export-job.js';

export {
  type BatchProgress,
  type ExportBatch,
  batchProgress,
  cancelExportBatch,
  exportBatch,
  nextExportBatch,
  nextJobToStart,
  rememberCollisionAnswer,
} from './export-batch.js';

export {
  type ImportEntry,
  type ImportFile,
  type ImportFileEvent,
  type ImportFileState,
  type ImportJob,
  type ImportProgress,
  type ImportRoomNeeded,
  type ImportStage,
  cancelImport,
  importJob,
  importProgress,
  nextImportJob,
} from './import-job.js';

export {
  type DecodedStreamDescription,
  type DecodedStreamMessage,
  type EncodedStreamMessage,
  type RenderedStreamMessage,
  type StreamReceiverMessage,
} from './stream-messages.js';

export {
  readDecodedStreamMessage,
  readEncodedStreamMessage,
  readRenderedStreamMessage,
  readStreamReceiverMessage,
} from './stream-message-reading.js';
