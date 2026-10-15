import { describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  checkProcessors,
  chainOutputLayout,
  isWellFormedId,
  processorsOf,
  validateChainShape,
  type LibraryEntry,
  type ParameterValue,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { PROCESSOR_CATALOGUE } from '../catalogue.js';
import { TEST_RATE } from '../testing/processor-run.js';
import { BUILT_IN_LIBRARY } from './game-chains.js';

/**
 * The game processing presets as this phase decided them (`REQ-GAME-023`):
 * each entry's processors in signal order, each with the values decided for
 * it by parameter key; every other parameter keeps its type's default.
 */
const DECIDED: readonly (readonly [
  string,
  readonly (readonly [string, Record<string, ParameterValue>])[],
])[] = [
  [
    'Game SFX, −16 LUFS',
    [
      ['dc-offset-removal', {}],
      ['filter', { mode: 'high-pass', cutoff: 30 }],
      ['loudness-normalisation', { target: -16, 'limit-true-peak': true, ceiling: -1 }],
    ],
  ],
  [
    'UI sound, −18 LUFS',
    [
      ['dc-offset-removal', {}],
      ['filter', { mode: 'high-pass', cutoff: 80 }],
      ['loudness-normalisation', { target: -18, 'limit-true-peak': true, ceiling: -1 }],
    ],
  ],
  [
    'Dialogue, −23 LUFS',
    [
      ['filter', { mode: 'high-pass', cutoff: 80 }],
      ['de-esser', {}],
      ['compressor', { ratio: 3, threshold: -24 }],
      ['loudness-normalisation', { target: -23, 'limit-true-peak': true, ceiling: -2 }],
    ],
  ],
  [
    'Ambience loop, −24 LUFS',
    [
      ['dc-offset-removal', {}],
      ['loudness-normalisation', { target: -24, 'limit-true-peak': true, ceiling: -2 }],
    ],
  ],
  [
    'Footstep / impact, peak −1 dB',
    [
      ['dc-offset-removal', {}],
      ['filter', { mode: 'high-pass', cutoff: 40 }],
      ['peak-normalisation', { target: -1, detection: 'true-peak' }],
    ],
  ],
];

/**
 * Each processor of `entry`'s chain: its type, and its value of each key
 * `decided` names for it, where it holds the type's default for every other.
 */
function decidedOf(
  entry: LibraryEntry,
  decided: readonly (readonly [string, Record<string, ParameterValue>])[],
): (readonly [string, Record<string, ParameterValue>])[] {
  if (entry.content.kind !== 'chain') throw new Error('A built-in entry is a chain.');
  return [...processorsOf(entry.content.chain.slots)].map((processor, index) => {
    const named = decided[index]?.[1] ?? {};
    const set: Record<string, ParameterValue> = {};
    for (const parameter of PROCESSOR_CATALOGUE.get(processor.typeKey)?.parameters ?? []) {
      const value = processor.values.get(parameter.id);
      const fallback = parameter.kind === 'choice' ? parameter.defaultKey : parameter.defaultValue;
      if (value === undefined) continue;
      if (parameter.key in named || value !== fallback) set[parameter.key] = value;
    }
    return [processor.typeKey, set] as const;
  });
}

describe('the built-in game chains of the processing library', () => {
  it('holds the chains this phase decided, by name, in the order the library lists them', () => {
    expect(
      BUILT_IN_LIBRARY.map((entry, index) => [
        entry.name,
        decidedOf(entry, DECIDED[index]?.[1] ?? []),
      ]),
    ).toEqual(DECIDED);
  });

  it('is valid against the catalogue, each chain running on mono and stereo', () => {
    for (const entry of BUILT_IN_LIBRARY) {
      if (entry.content.kind !== 'chain') throw new Error('A built-in entry is a chain.');
      const { chain } = entry.content;
      expectSuccess(validateChainShape(chain));
      expectSuccess(checkProcessors(chain.slots, PROCESSOR_CATALOGUE));
      for (const layout of [StandardLayouts.mono, StandardLayouts.stereo]) {
        expect(
          expectSuccess(chainOutputLayout(chain, PROCESSOR_CATALOGUE, layout, TEST_RATE)),
        ).toEqual(layout);
      }
    }
  });

  it('gives every entry, chain and processor its own well-formed identifier', () => {
    const ids = BUILT_IN_LIBRARY.flatMap((entry) =>
      entry.content.kind === 'chain'
        ? [
            entry.id,
            entry.content.chain.id,
            ...[...processorsOf(entry.content.chain.slots)].map((one) => one.id),
          ]
        : [entry.id],
    );
    expect(ids.every((id) => isWellFormedId(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps its identifiers and names fixed, so every library lists the same entries', () => {
    expect(BUILT_IN_LIBRARY.map((entry) => entry.id)).toEqual([
      '9a3e0001-0000',
      '9a3e0002-0000',
      '9a3e0003-0000',
      '9a3e0004-0000',
      '9a3e0005-0000',
    ]);
    expect(new Set(BUILT_IN_LIBRARY.map((entry) => entry.name)).size).toBe(BUILT_IN_LIBRARY.length);
  });
});
