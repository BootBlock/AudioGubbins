/**
 * The person's library of saved chains and presets (ADR-0060, REQ-AUDIO-017).
 *
 * Kept outside any project, so a chain made in one project can be applied in
 * another. A saved chain is a chain and a preset a processor, the same values a
 * project holds, written in the chain's one persisted form; applying either
 * copies it into a project under new identifiers (`chain-edits.ts`), or takes a
 * preset's settings onto a processor already there, so the library and the
 * project never share a value that one could change under the other. A preset
 * names explicit parameter values (REQ-AUDIO-086).
 */

import type { Branded } from '../identity/branded-id.js';
import { FailureKind, fail, failure, succeed, type DomainResult } from '../result.js';
import type { EffectChain, ProcessorInstance } from './effect-chain.js';

/** Identifies an entry of the library, whatever it is called. */
export type LibraryEntryId = Branded<'LibraryEntryId'>;

/** What an entry keeps: a whole chain, or one processor's settings saved by its type. */
export type LibraryContent =
  | { readonly kind: 'chain'; readonly chain: EffectChain }
  | { readonly kind: 'preset'; readonly processor: ProcessorInstance };

/** The kinds of entry, within each of which names are unique. */
export type LibraryEntryKind = LibraryContent['kind'];

/** A chain or a preset kept in the library under a name the person gave it. */
export interface LibraryEntry {
  readonly id: LibraryEntryId;
  readonly name: string;

  /** When its content was saved, in milliseconds since the Unix epoch. */
  readonly savedAt: number;
  readonly content: LibraryContent;
}

/** The longest name a saved chain or preset takes, in the characters a reader sees. */
export const LONGEST_SAVED_NAME = 120;

/**
 * `instance` with the settings `preset` keeps: its versions, its values and
 * its state, or none where the preset keeps none. Where it sits and how it is
 * heard there, its identifier, bypass, solo and mix, stay the instance's,
 * since a preset is a processor's settings and not its place in a rack. A
 * preset of another type names parameters this processor does not have.
 */
export function withPreset(
  instance: ProcessorInstance,
  preset: ProcessorInstance,
): DomainResult<ProcessorInstance> {
  if (preset.typeKey !== instance.typeKey) {
    return fail(
      failure(
        'library.preset-other-type',
        FailureKind.Rejected,
        'The preset is of another type of processor, so its settings do not fit this one.',
        { details: { preset: preset.typeKey, processor: instance.typeKey } },
      ),
    );
  }
  const { state: _replaced, ...placed } = instance;
  return succeed({
    ...placed,
    version: preset.version,
    values: preset.values,
    ...(preset.state === undefined ? {} : { state: preset.state }),
  });
}
