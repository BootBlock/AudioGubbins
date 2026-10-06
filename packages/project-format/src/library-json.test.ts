import { describe, expect, it } from 'vitest';

import {
  LONGEST_SAVED_NAME,
  createDeterministicIdGenerator,
  unsafeBrandId,
  type LibraryEntry,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { canonicalJson } from './canonical-json.js';
import { writeSlot } from './chain-writing.js';
import { parseJson } from './json-parsing.js';
import {
  LIBRARY_ENTRY_DEPTH,
  readLibraryEntry,
  savedEntryName,
  writeLibraryEntry,
} from './library-json.js';
import { everyChainShape, fullySetProcessor } from './testing/chain-shapes.js';

const ids = createDeterministicIdGenerator(61);
const ID = unsafeBrandId<'LibraryEntryId'>('0123abcd-0001');

function chainEntry(): LibraryEntry {
  return {
    id: ID,
    name: 'Dialogue clean-up',
    savedAt: 1_790_000_000_000,
    content: { kind: 'chain', chain: everyChainShape(ids) },
  };
}

function presetEntry(): LibraryEntry {
  return {
    id: ID,
    name: 'Gentle low-pass',
    savedAt: 1_790_000_001_000,
    content: { kind: 'preset', processor: fullySetProcessor(ids) },
  };
}

/** The entry's text, read back from that text as storage would, and its text again. */
function throughText(entry: LibraryEntry): { text: string; back: LibraryEntry; again: string } {
  const text = canonicalJson(writeLibraryEntry(entry));
  const parsed = expectSuccess(
    parseJson(text, { maximumLength: 2 ** 20, maximumDepth: LIBRARY_ENTRY_DEPTH }),
  );
  const back = expectSuccess(readLibraryEntry(entry.id, parsed));
  return { text, back, again: canonicalJson(writeLibraryEntry(back)) };
}

describe('an entry of the library as a document (ADR-0060)', () => {
  it('gives back a chain of every shape as it was saved, the same text again', () => {
    const entry = chainEntry();

    const { text, back, again } = throughText(entry);

    expect(back).toEqual(entry);
    expect(again).toBe(text);
  });

  it('nests a chain whose groups are as deep as the domain allows exactly as deep as it says', () => {
    const text = canonicalJson(writeLibraryEntry(chainEntry()));
    const within = (maximumDepth: number) =>
      parseJson(text, { maximumLength: 2 ** 20, maximumDepth }).ok;

    expect(within(LIBRARY_ENTRY_DEPTH)).toBe(true);
    expect(within(LIBRARY_ENTRY_DEPTH - 1)).toBe(false);
  });

  it('gives back a preset with its versions, model, values and state', () => {
    const entry = presetEntry();

    const { text, back, again } = throughText(entry);

    expect(back).toEqual(entry);
    expect(again).toBe(text);
  });

  it('refuses an entry of a schema version this build does not know, with no migration', () => {
    const written = { ...writeLibraryEntry(chainEntry()), schemaVersion: 999 };

    expect(expectFailureCode(readLibraryEntry(ID, written))).toBe('format.schema-incompatible');
  });

  it('refuses a document of another format', () => {
    const written = { ...writeLibraryEntry(chainEntry()), format: 'audiogubbins.project' };

    expect(expectFailureCode(readLibraryEntry(ID, written))).toBe('format.unexpected-format');
  });

  it('refuses a member its kind does not hold, so content is never read past', () => {
    const written = {
      ...writeLibraryEntry(chainEntry()),
      processor: writeSlot(fullySetProcessor(ids)),
    };

    expect(readLibraryEntry(ID, written).ok).toBe(false);
  });

  it('refuses a preset that holds a group rather than one processor', () => {
    const chain = everyChainShape(ids);
    const group = chain.slots[2];
    if (group === undefined) throw new Error('The chain has a group.');
    const document = { ...writeLibraryEntry(presetEntry()), processor: writeSlot(group) };

    expect(expectFailureCode(readLibraryEntry(ID, document))).toBe('library.preset-not-processor');
  });

  it('refuses a name kept with the space around it, or blank', () => {
    const untrimmed = { ...writeLibraryEntry(chainEntry()), name: ' Dialogue ' };
    const blank = { ...writeLibraryEntry(chainEntry()), name: '​ ' };

    expect(expectFailureCode(readLibraryEntry(ID, untrimmed))).toBe('library.name-untrimmed');
    expect(expectFailureCode(readLibraryEntry(ID, blank))).toBe('library.name-blank');
  });
});

describe('the name a chain or preset is saved under', () => {
  it('is trimmed, and refused where a reader would see nothing or too much', () => {
    expect(expectSuccess(savedEntryName('  Warm vocal  '))).toBe('Warm vocal');
    expect(expectFailureCode(savedEntryName(' ⁠ '))).toBe('library.name-blank');
    expect(expectFailureCode(savedEntryName(7))).toBe('library.name-blank');
    expect(expectSuccess(savedEntryName('é'.repeat(LONGEST_SAVED_NAME)))).toHaveLength(
      LONGEST_SAVED_NAME,
    );
    expect(expectFailureCode(savedEntryName('a'.repeat(LONGEST_SAVED_NAME + 1)))).toBe(
      'library.name-too-long',
    );
  });
});
