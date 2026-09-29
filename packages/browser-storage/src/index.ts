/**
 * The public contract of AudioGubbins' browser storage: the storage ports
 * implemented over what the browser offers (ADR-0020).
 *
 * The storage tree over the origin-private file system, through one dedicated
 * worker writing with synchronous access handles; the kept handles of linked
 * files in IndexedDB, and finding them again; the pickers and the page's file
 * input, as files the media store takes; sinks over a file or folder the user
 * chose and over a download; the digest; and giving the page a turn. The
 * platform objects are read by the capabilities package and passed in, so
 * nothing here reaches a global (REQ-EXEC-136.4), and each one's absence is a
 * decision of whoever passes it (REQ-EXEC-216). Everything absent from this
 * list is internal (REQ-REPO-186).
 */

export { type TreeWorker } from './worker-channel.js';

export { startOriginPrivateTree } from './origin-private-tree.js';

export { type TreeWorkerScope, serveOriginPrivateTree } from './serve-tree.js';

export {
  FileHandleKeeper,
  type HandleDatabase,
  type HandleDatabaseFactory,
  type HandleObjectStore,
  type HandleOpenRequest,
  type HandleRequest,
  type HandleTransaction,
} from './file-handle-keeper.js';

export { type KeptFileAccess, reopenKeptFile, requestKeptFileAccess } from './kept-files.js';

export {
  type Picked,
  type Picker,
  type PickerFileType,
  filesInDirectory,
  pickDirectory,
  pickFiles,
  pickSaveFile,
} from './file-pickers.js';

export { filesFromInput } from './external-files.js';

export {
  type FileWriteStream,
  type WritableDirectory,
  type WritableFile,
  openFileSink,
  openFileSinkIn,
} from './file-stream-sink.js';

export { BlobSink } from './blob-sink.js';

export { webDigest } from './web-digest.js';

export { randomTokens } from './random-tokens.js';

export { type HostYieldingMethod, yieldToHost } from './host-yielding.js';
