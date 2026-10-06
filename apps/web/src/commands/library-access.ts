/**
 * What the commands of the person's library of saved chains and presets
 * share (ADR-0060): reaching the library and the project open to change, the
 * entry and the processor an invocation names, and an entry read from the
 * library as one this build can use, of the kind a command applies.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import {
  FailureKind,
  fail,
  failure,
  findSlot,
  succeed,
  type DomainResult,
  type LibraryContent,
  type LibraryEntryKind,
  type ProcessorInstance,
} from '@audiogubbins/domain';
import type { ProjectState } from '@audiogubbins/project-format';
import type { ListedEntry } from '@audiogubbins/storage';
import type { RemoteProjectSession } from '@audiogubbins/storage-runtime';
import { quoted } from '@audiogubbins/text';

import type { SavedProcessingStore } from '../state/saved-processing-store.js';
import { editorTarget } from './editor-target.js';
import { idArgument, readyProjects, sessionOf } from './project-access.js';
import { textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The library, and the session of the project open to change. */
export interface LibrarySession {
  readonly library: SavedProcessingStore;
  readonly session: RemoteProjectSession;
}

/** What each kind of entry is called in a sentence. */
export const KIND_NAMES: Readonly<Record<LibraryEntryKind, string>> = {
  chain: 'chain',
  preset: 'preset',
};

/** A refusal of a library command, for the reason given. */
export function refused(summary: string): DomainResult<never> {
  return fail(failure('library.refused', FailureKind.Rejected, summary));
}

/** The library and the project session, where both can be reached, or why not. */
export function librarySession(context: ShellContext): LibrarySession | string {
  const stores = readyProjects(context);
  if (typeof stores === 'string') return stores;
  const session = sessionOf(context);
  return typeof session === 'string' ? session : { library: stores.savedProcessing, session };
}

/** The entry an invocation names, as its identifier, or why it names none. */
export function entryArgument(invocation: CommandInvocation) {
  return idArgument<'LibraryEntryId'>(invocation, 'entry', 'saved chain or preset');
}

/** Content of one kind of entry. */
type ContentOf<TKind extends LibraryEntryKind> = Extract<LibraryContent, { readonly kind: TKind }>;

function isOfKind<TKind extends LibraryEntryKind>(
  content: LibraryContent,
  kind: TKind,
): content is ContentOf<TKind> {
  return content.kind === kind;
}

/**
 * The name and content of the entry `listed` holds where this build can use
 * it and it is of `kind`, or why it cannot be applied.
 */
export function usableOf<TKind extends LibraryEntryKind>(
  listed: ListedEntry,
  kind: TKind,
): DomainResult<{ readonly name: string; readonly content: ContentOf<TKind> }> {
  if (listed.kind === 'unusable') {
    const name = listed.entry === undefined ? 'That entry' : quoted(listed.entry.name);
    return refused(`${name} cannot be used in this version: ${listed.reason.summary}`);
  }
  const { name, content } = listed.entry;
  return isOfKind(content, kind)
    ? succeed({ name, content })
    : refused(`${quoted(name)} is not a ${KIND_NAMES[kind]}.`);
}

/** The processor `id` among the project's chains, or `undefined`. */
export function processorIn(state: ProjectState, id: string): ProcessorInstance | undefined {
  for (const chain of state.project.effectChains.values()) {
    const slot = findSlot(chain, id)?.slot;
    if (slot !== undefined) return slot.kind === 'processor' ? slot : undefined;
  }
  return undefined;
}

/**
 * The processor an invocation names by `processorId`, or the one processor
 * selected in the editor in use, as its identifier, or `undefined`.
 */
export function processorArgument(
  context: ShellContext,
  invocation: CommandInvocation,
): string | undefined {
  const named = textArgument(invocation, 'processorId');
  if (named !== undefined) return named;
  const view = editorTarget(context, invocation);
  if (typeof view === 'string') return undefined;
  const objects = context.selections.of(view.asset.id).objects;
  return objects?.kind === 'processors' && objects.ids.length === 1 ? objects.ids[0] : undefined;
}
