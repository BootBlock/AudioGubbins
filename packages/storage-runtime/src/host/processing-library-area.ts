/**
 * The person's library of saved chains and presets, served to the page:
 * listing it, reading one entry, and saving, replacing, renaming and removing
 * one (ADR-0060, REQ-AUDIO-017). Each is the library store's own, so what it
 * refuses crosses as the reason it gave.
 */

import type { AreaHandlers } from '../protocol/storage-operations.js';
import type { HostServices } from './host-services.js';

/** The library's operations, over the worker's library store. */
export function processingLibraryHandlers({
  processingLibrary,
}: HostServices): AreaHandlers<'processingLibrary'> {
  return {
    'processingLibrary.list': (_nothing, { signal }) => processingLibrary.list(signal),
    'processingLibrary.entry': (entry, { signal }) => processingLibrary.entry(entry, signal),
    'processingLibrary.save': ({ name, content }, { signal }) =>
      processingLibrary.save(name, content, signal),
    'processingLibrary.replace': ({ entry, content }, { signal }) =>
      processingLibrary.replace(entry, content, signal),
    'processingLibrary.rename': ({ entry, name }, { signal }) =>
      processingLibrary.rename(entry, name, signal),
    'processingLibrary.remove': (entry, { signal }) => processingLibrary.remove(entry, signal),
  };
}
