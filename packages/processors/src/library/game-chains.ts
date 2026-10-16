/**
 * The processing library's built-in entries: the game-oriented processing
 * presets `REQ-GAME-023` names, as saved chains every person's library lists
 * before their own (ADR-0060, ADR-0101). They are values of this build, not
 * of any stored library, so a change to one is a change of its entry here.
 *
 * Each is built from the catalogue's own descriptors, by parameter key, so an
 * entry names only processors and parameters this build has, at values in
 * their ranges, and every identifier is fixed, so an entry is the same in
 * every library and every session and a project that copied one can say so.
 */

import {
  instantiateProcessor,
  unsafeBrandId,
  type EffectChain,
  type LibraryEntry,
  type ParameterValue,
  type ProcessorInstance,
} from '@audiogubbins/domain';

import { PROCESSOR_CATALOGUE } from '../catalogue.js';

/** When these entries' values were decided: what each lists as its saving. */
const DECIDED_AT = Date.UTC(2026, 9, 15);

/**
 * One processor of a built-in chain: the type's defaults with `values`, by
 * parameter key, in their place. A type or a key the catalogue lacks is a
 * fault in this file, which its test finds before any build ships it.
 */
function processor(
  id: string,
  typeKey: string,
  values: Readonly<Record<string, ParameterValue>> = {},
): ProcessorInstance {
  const descriptor = PROCESSOR_CATALOGUE.get(typeKey);
  if (descriptor === undefined) throw new Error(`The catalogue has no processor "${typeKey}".`);
  const made = instantiateProcessor(unsafeBrandId<'ProcessorId'>(id), descriptor);
  const set = new Map(made.values);
  for (const [key, value] of Object.entries(values)) {
    const parameter = descriptor.parameters.find((one) => one.key === key);
    if (parameter === undefined) throw new Error(`"${typeKey}" has no parameter "${key}".`);
    set.set(parameter.id, value);
  }
  return { ...made, values: set };
}

/** A built-in entry `name`, numbered `entry`, whose chain is `slots` in signal order. */
function builtIn(
  entry: number,
  name: string,
  slots: readonly ((at: string) => ProcessorInstance)[],
): LibraryEntry {
  const base = `9a3e${String(entry).padStart(4, '0')}`;
  const chain: EffectChain = {
    id: unsafeBrandId<'EffectChainId'>(`${base}-c000`),
    slots: slots.map((make, index) => make(`${base}-c${String(index + 1).padStart(3, '0')}`)),
  };
  return {
    id: unsafeBrandId<'LibraryEntryId'>(`${base}-0000`),
    name,
    savedAt: DECIDED_AT,
    content: { kind: 'chain', chain },
  };
}

const dcOffset = (at: string) => processor(at, 'dc-offset-removal');

const highPass = (cutoff: number) => (at: string) =>
  processor(at, 'filter', { mode: 'high-pass', cutoff });

/** Loudness normalisation to `target` LUFS, its true peak held at `ceiling` dBTP. */
const loudness = (target: number, ceiling: number) => (at: string) =>
  processor(at, 'loudness-normalisation', { target, 'limit-true-peak': true, ceiling });

/** The built-in entries, in the order the library lists them. */
export const BUILT_IN_LIBRARY: readonly LibraryEntry[] = [
  builtIn(1, 'Game SFX, −16 LUFS', [dcOffset, highPass(30), loudness(-16, -1)]),
  builtIn(2, 'UI sound, −18 LUFS', [dcOffset, highPass(80), loudness(-18, -1)]),
  builtIn(3, 'Dialogue, −23 LUFS', [
    highPass(80),
    (at) => processor(at, 'de-esser'),
    (at) => processor(at, 'compressor', { ratio: 3, threshold: -24 }),
    loudness(-23, -2),
  ]),
  builtIn(4, 'Ambience loop, −24 LUFS', [dcOffset, loudness(-24, -2)]),
  builtIn(5, 'Footstep / impact, peak −1 dB', [
    dcOffset,
    highPass(40),
    (at) => processor(at, 'peak-normalisation', { target: -1, detection: 'true-peak' }),
  ]),
];
