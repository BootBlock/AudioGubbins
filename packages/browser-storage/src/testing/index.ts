/**
 * What another package's tests may take from the browser storage's test
 * support: the file and folder handles Chromium's pickers hand over, put in
 * place of the browser's own, and IndexedDB in memory, so a test delivers an
 * export into a folder, or keeps one trusted, without a browser.
 */

export { FakeDirectoryHandle, FakeFileHandle, installFakeHandles } from './file-handles.js';
export { MemoryDatabases } from './memory-indexed-db.js';
