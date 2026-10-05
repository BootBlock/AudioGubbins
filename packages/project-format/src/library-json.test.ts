import { describe, expect, it } from 'vitest';

import {
  createDeterministicIdGenerator,
  instantiateProcessor,
  type ProcessingLibrary,
} from '@audiogubbins/domain';
import {
  TEST_FILTER,
  TEST_LIMITER,
  expectFailureCode,
  expectSuccess,
} from '@audiogubbins/domain/testing';

import { writeSlot } from './chain-writing.js';
import {
  libraryDocumentText,
  parseLibraryDocument,
  readLibraryDocument,
  writeLibraryDocument,
} from './library-json.js';

const ids = createDeterministicIdGenerator(61);

function library(): ProcessingLibrary {
  const filter = { ...instantiateProcessor(ids.next(), TEST_FILTER), mix: 0.5 };
  const limiter = instantiateProcessor(ids.next(), TEST_LIMITER);
  return {
    chains: [
      {
        name: 'Dialogue clean-up',
        chain: {
          id: ids.next(),
          slots: [
            filter,
            {
              kind: 'group',
              id: ids.next(),
              enabled: true,
              soloed: false,
              mix: 1,
              summing: 'mean',
              branches: [{ slots: [limiter] }, { slots: [] }],
            },
          ],
        },
      },
    ],
    presets: [{ name: 'Gentle low-pass', processor: { ...filter, soloed: true } }],
  };
}

describe('the library document (ADR-0060)', () => {
  it('reads back every saved chain and preset as it was written, the same text again', () => {
    const saved = library();
    const text = expectSuccess(libraryDocumentText(saved));
    const back = expectSuccess(parseLibraryDocument(text));
    expect(back).toEqual(saved);
    expect(expectSuccess(libraryDocumentText(back))).toBe(text);
  });

  it('refuses a document of a schema version this build does not know, with no migration', () => {
    const written = { ...writeLibraryDocument(library()), schemaVersion: 999 };
    expect(expectFailureCode(readLibraryDocument(written))).toBe('format.schema-incompatible');
  });

  it('refuses two saved chains under one name, which would make one of them unreachable', () => {
    const saved = library();
    const first = saved.chains[0];
    if (first === undefined) throw new Error('The library has a chain.');
    const twice = writeLibraryDocument({
      ...saved,
      chains: [first, { ...first, chain: { ...first.chain, id: ids.next() } }],
    });
    expect(readLibraryDocument(twice).ok).toBe(false);
  });

  it('refuses a preset that holds a group rather than one processor', () => {
    const group = library().chains[0]?.chain.slots[1];
    if (group === undefined) throw new Error('The saved chain has a group.');
    const document = {
      ...writeLibraryDocument(library()),
      presets: [{ name: 'Not a processor', processor: writeSlot(group) }],
    };
    expect(expectFailureCode(readLibraryDocument(document))).toBe('library.preset-not-processor');
  });
});
