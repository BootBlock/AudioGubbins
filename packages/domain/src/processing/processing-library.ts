/**
 * The person's library of saved chains and presets (ADR-0060, REQ-AUDIO-017).
 *
 * Kept outside any project, so a chain made in one project can be applied in
 * another. A saved chain is a chain and a preset a processor, the same values a
 * project holds, written in the chain's one persisted form; applying either
 * copies it into a project under new identifiers (`chain-edits.ts`), so the
 * library and the project never share a value that one could change under the
 * other. A preset names explicit parameter values (REQ-AUDIO-086).
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '../result.js';
import type { EffectChain, ProcessorInstance } from './effect-chain.js';

/** A chain kept in the library under a name the person gave it. */
export interface SavedChain {
  readonly name: string;
  readonly chain: EffectChain;
}

/** A processor's settings kept in the library under a name. */
export interface SavedPreset {
  readonly name: string;
  readonly processor: ProcessorInstance;
}

/** Every saved chain and preset, each list in the order the person keeps it. */
export interface ProcessingLibrary {
  readonly chains: readonly SavedChain[];
  readonly presets: readonly SavedPreset[];
}

/** A library with nothing saved. */
export const EMPTY_LIBRARY: ProcessingLibrary = { chains: [], presets: [] };

/** The longest name a saved chain or preset takes, as a project's names do. */
export const LONGEST_SAVED_NAME = 120;

function refused(code: string, summary: string): DomainResult<never> {
  return fail(failure(`library.${code}`, FailureKind.Rejected, summary));
}

/** The name with its outer spaces removed, where it is one a saved entry takes. */
export function savedName(name: string): DomainResult<string> {
  const trimmed = name.trim();
  if (trimmed.length === 0) return refused('name-empty', 'A saved chain or preset needs a name.');
  if (trimmed.length > LONGEST_SAVED_NAME) {
    return refused(
      'name-too-long',
      `A saved chain or preset's name is at most ${String(LONGEST_SAVED_NAME)} characters.`,
    );
  }
  return succeed(trimmed);
}

/**
 * The entries with `entry` kept under its name: added, or, where `replace`
 * says so, put in place of the entry already saved under that name, which is
 * otherwise refused rather than lost.
 */
export function withSaved<T extends SavedChain | SavedPreset>(
  entries: readonly T[],
  entry: T,
  replace: boolean,
): DomainResult<readonly T[]> {
  const place = entries.findIndex((one) => one.name === entry.name);
  if (place === -1) return succeed([...entries, entry]);
  return replace
    ? succeed(entries.with(place, entry))
    : refused(
        'name-taken',
        'Something is already saved under that name: replace it, or choose another name.',
      );
}

/** The entries without the one named `name`, or why there is none. */
export function withoutSaved<T extends SavedChain | SavedPreset>(
  entries: readonly T[],
  name: string,
): DomainResult<readonly T[]> {
  const place = entries.findIndex((one) => one.name === name);
  return place === -1
    ? refused('entry-unknown', 'The library has nothing saved under that name.')
    : succeed(entries.toSpliced(place, 1));
}
