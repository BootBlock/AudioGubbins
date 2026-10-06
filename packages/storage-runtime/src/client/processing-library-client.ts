/**
 * The person's library of saved chains and presets, as the page asks the
 * storage worker for it (ADR-0060, REQ-AUDIO-017): every entry listed, usable
 * or not, and the changes to it, each refused with the library's reason.
 */

import type {
  DomainResult,
  LibraryContent,
  LibraryEntry,
  LibraryEntryId,
} from '@audiogubbins/domain';
import type { ListedEntry } from '@audiogubbins/storage';

import type { ClientChannel } from '../protocol/storage-operations.js';

/** The saved chains and presets, and the changes to them. */
export interface ProcessingLibraryClient {
  /** Every entry, those this build cannot use among them with the reason. */
  list(signal?: AbortSignal): Promise<DomainResult<readonly ListedEntry[]>>;

  /** One entry as it is kept now, or why there is none. */
  entry(id: LibraryEntryId, signal?: AbortSignal): Promise<DomainResult<ListedEntry>>;

  /** Saves `content` as a new entry, refused where its kind has `name` already. */
  save(
    name: string,
    content: LibraryContent,
    signal?: AbortSignal,
  ): Promise<DomainResult<LibraryEntry>>;

  /** Replaces an entry's content with content of its kind, keeping its name. */
  replace(
    id: LibraryEntryId,
    content: LibraryContent,
    signal?: AbortSignal,
  ): Promise<DomainResult<LibraryEntry>>;

  /** Gives an entry another name, refused where another of its kind has it. */
  rename(
    id: LibraryEntryId,
    name: string,
    signal?: AbortSignal,
  ): Promise<DomainResult<LibraryEntry>>;

  /** Removes an entry, usable or not. */
  remove(id: LibraryEntryId, signal?: AbortSignal): Promise<DomainResult<void>>;
}

/** The library, over the page's end of the port. */
export function processingLibraryClient(channel: ClientChannel): ProcessingLibraryClient {
  return {
    list: (signal) => channel.call('processingLibrary.list', undefined, { signal }),
    entry: (id, signal) => channel.call('processingLibrary.entry', id, { signal }),
    save: (name, content, signal) =>
      channel.call('processingLibrary.save', { name, content }, { signal }),
    replace: (id, content, signal) =>
      channel.call('processingLibrary.replace', { entry: id, content }, { signal }),
    rename: (id, name, signal) =>
      channel.call('processingLibrary.rename', { entry: id, name }, { signal }),
    remove: (id, signal) => channel.call('processingLibrary.remove', id, { signal }),
  };
}
