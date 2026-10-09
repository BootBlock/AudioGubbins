import { describe, expect, it } from 'vitest';

import {
  createDeterministicIdGenerator,
  instantiateProcessor,
  type IdGenerator,
  type LibraryContent,
  type LibraryEntry,
} from '@audiogubbins/domain';
import { TEST_LIMITER, expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import { canonicalJson, writeLibraryEntry, type StorageTree } from '@audiogubbins/project-format';
import {
  CHAIN_SHAPES_CATALOGUE,
  everyChainShape,
  fullySetProcessor,
} from '@audiogubbins/project-format/testing';

import { CheckedRecords, RecordKind } from './checked-records.js';
import type { ListedEntry } from './library-entry-files.js';
import { ProcessingLibraryStore } from './processing-library-store.js';
import { sweepCrashes } from './testing/crash-sweep.js';
import { MemoryLeaseCoordinator } from './testing/memory-leases.js';
import { nodeDigest } from './testing/node-services.js';

/**
 * The person's library of saved chains and presets, kept in the storage tree
 * (ADR-0060, REQ-AUDIO-017): every chain shape given back as saved, names
 * unique within a kind as a reader hears them, an entry this build cannot
 * use listed with the reason rather than dropped, everything kept across a
 * reopened store, and no crash leaving an entry lost or half changed.
 */

const START = 1_790_000_000_000;

/** A clock that moves on a second each time it is read. */
function steppingClock(): { now: () => number } {
  let now = START;
  return {
    now: () => {
      now += 1_000;
      return now;
    },
  };
}

interface Library {
  readonly store: ProcessingLibraryStore;
  readonly tree: StorageTree;
  readonly coordinator: MemoryLeaseCoordinator;
}

/** A library over `tree`, one window of a profile whose leases are `coordinator`. */
function libraryOver(
  tree: StorageTree = new MemoryStorageTree(),
  coordinator = new MemoryLeaseCoordinator(),
  seed = 1,
): Library {
  return {
    tree,
    coordinator,
    store: new ProcessingLibraryStore({
      tree,
      digest: nodeDigest,
      clock: steppingClock(),
      ids: createDeterministicIdGenerator(seed),
      catalogue: CHAIN_SHAPES_CATALOGUE,
      coordinator,
    }),
  };
}

const ids: IdGenerator = createDeterministicIdGenerator(900);

/** Content of a chain of every shape, or of a fully set processor as a preset. */
const content = {
  chain: (): LibraryContent => ({ kind: 'chain', chain: everyChainShape(ids) }),
  preset: (): LibraryContent => ({ kind: 'preset', processor: fullySetProcessor(ids) }),
};

function usable(listed: ListedEntry | undefined): LibraryEntry {
  if (listed?.kind !== 'usable')
    throw new Error(`Expected a usable entry, not ${String(listed?.kind)}.`);
  return listed.entry;
}

/** The text an entry is kept as, which a round trip must give back. */
function textOf(entry: LibraryEntry): string {
  return canonicalJson(writeLibraryEntry(entry));
}

describe('saving to and listing the library', () => {
  it('gives back a chain of every shape and a preset as saved, to the bit', async () => {
    const { store } = libraryOver();
    const chain = content.chain();
    const preset = content.preset();

    const savedChain = expectSuccess(await store.save('  Dialogue clean-up ', chain));
    const savedPreset = expectSuccess(await store.save('Gentle low-pass', preset));

    expect(savedChain).toMatchObject({ name: 'Dialogue clean-up', content: chain });
    expect(savedChain.savedAt).toBeGreaterThan(START);
    const listed = expectSuccess(await store.list());
    const back = listed.map(usable);
    expect(back.map((entry) => entry.id).sort()).toEqual([savedChain.id, savedPreset.id].sort());
    for (const saved of [savedChain, savedPreset]) {
      const found = back.find((entry) => entry.id === saved.id);
      expect(found).toEqual(saved);
      expect(found === undefined ? undefined : textOf(found)).toBe(textOf(saved));
    }
  });

  it('keeps everything across a store opened again over the same storage', async () => {
    const first = libraryOver();
    const saved = expectSuccess(await first.store.save('Warm vocal', content.chain()));
    const renamed = expectSuccess(await first.store.rename(saved.id, 'Warmer vocal'));
    const tree = first.tree instanceof MemoryStorageTree ? first.tree.restarted() : first.tree;

    const reopened = libraryOver(tree, new MemoryLeaseCoordinator(), 2);

    expect(expectSuccess(await reopened.store.list()).map(usable)).toEqual([renamed]);
    expect(usable(expectSuccess(await reopened.store.entry(saved.id)))).toEqual(renamed);
  });

  it('refuses a name an entry of its kind has as a reader hears it, and allows it for the other kind', async () => {
    const { store } = libraryOver();
    expectSuccess(await store.save('Warm vocal', content.chain()));

    expect(expectFailureCode(await store.save('warm  VOCAL', content.chain()))).toBe(
      'library.name-taken',
    );
    expectSuccess(await store.save('Warm vocal', content.preset()));
    expect(expectSuccess(await store.list())).toHaveLength(2);
  });

  it('refuses a rename onto another entry’s name, and allows one onto its own in other case', async () => {
    const { store } = libraryOver();
    const warm = expectSuccess(await store.save('Warm vocal', content.chain()));
    const bright = expectSuccess(await store.save('Bright vocal', content.chain()));

    expect(expectFailureCode(await store.rename(bright.id, 'WARM VOCAL'))).toBe(
      'library.name-taken',
    );
    const recased = expectSuccess(await store.rename(warm.id, 'warm vocal'));
    expect(recased).toEqual({ ...warm, name: 'warm vocal' });
  });

  it('replaces an entry’s content under its name and identifier, saying when', async () => {
    const { store } = libraryOver();
    const saved = expectSuccess(await store.save('Warm vocal', content.chain()));
    const other = content.chain();

    const replaced = expectSuccess(await store.replace(saved.id, other));

    expect(replaced).toMatchObject({ id: saved.id, name: 'Warm vocal', content: other });
    expect(replaced.savedAt).toBeGreaterThan(saved.savedAt);
    expect(expectSuccess(await store.list()).map(usable)).toEqual([replaced]);
    expect(expectFailureCode(await store.replace(saved.id, content.preset()))).toBe(
      'library.kind-mismatch',
    );
  });

  it('removes an entry, and refuses one it does not have', async () => {
    const { store } = libraryOver();
    const saved = expectSuccess(await store.save('Warm vocal', content.chain()));

    expectSuccess(await store.remove(saved.id));

    expect(expectSuccess(await store.list())).toEqual([]);
    expect(expectFailureCode(await store.remove(saved.id))).toBe('library.entry-unknown');
    expect(expectFailureCode(await store.entry(saved.id))).toBe('library.entry-unknown');
  });

  it('refuses to save content naming a processor this build lacks, saying why', async () => {
    const { store } = libraryOver();
    const stranger = {
      ...instantiateProcessor(ids.next<'ProcessorId'>(), TEST_LIMITER),
      typeKey: 'tape-saturator',
    };

    const refused = await store.save('Tape', { kind: 'preset', processor: stranger });

    expect(expectFailureCode(refused)).toBe('effect-chain.unknown-processor-type');
    expect(expectSuccess(await store.list())).toEqual([]);
  });
});

describe('an entry this build cannot use', () => {
  /** Saves an entry, then rewrites its record as another build would have written it. */
  async function rewritten(
    library: Library,
    change: (document: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<LibraryEntry> {
    const saved = expectSuccess(await library.store.save('Warm vocal', content.chain()));
    const records = new CheckedRecords(library.tree, nodeDigest);
    expectSuccess(
      await records.write(`library/${saved.id}/entry-1.json`, RecordKind.LibraryEntry, {
        generation: 2,
        entry: JSON.parse(JSON.stringify(change(writeLibraryEntry(saved)))) as never,
      }),
    );
    return saved;
  }

  it('is listed as unusable with the reason when another schema version wrote it, never dropped', async () => {
    const library = libraryOver();
    const saved = await rewritten(library, (document) => ({ ...document, schemaVersion: 2 }));
    const kept = expectSuccess(await library.store.save('Bright vocal', content.chain()));

    const listed = expectSuccess(await library.store.list());

    const unusable = listed.find((one) => one.kind === 'unusable');
    expect(unusable).toMatchObject({
      kind: 'unusable',
      id: saved.id,
      reason: { code: 'format.schema-incompatible' },
    });
    expect(unusable?.entry).toBeUndefined();
    expect(listed.filter((one) => one.kind === 'usable').map(usable)).toEqual([kept]);
    expect(expectFailureCode(await library.store.rename(saved.id, 'Other'))).toBe(
      'format.schema-incompatible',
    );
    expectSuccess(await library.store.remove(saved.id));
    expect(expectSuccess(await library.store.list()).map(usable)).toEqual([kept]);
  });

  it('is listed as unusable, with what it holds, where it names a processor version this build lacks', async () => {
    const library = libraryOver();
    const saved = await rewritten(library, (document) => {
      const chain = document['chain'] as { slots: { version: { implementation: number } }[] };
      const [first] = chain.slots;
      if (first !== undefined) first.version.implementation = 99;
      return document;
    });

    const [listed] = expectSuccess(await library.store.list());

    expect(listed).toMatchObject({
      kind: 'unusable',
      id: saved.id,
      reason: { code: 'processor.version-unknown' },
      entry: { id: saved.id, name: 'Warm vocal' },
    });
    // Its name is still its own: another is refused it, and it can be renamed.
    expect(expectFailureCode(await library.store.save('Warm vocal', content.chain()))).toBe(
      'library.name-taken',
    );
    const renamed = expectSuccess(await library.store.rename(saved.id, 'Old warm vocal'));
    const [after] = expectSuccess(await library.store.list());
    expect(after).toMatchObject({ kind: 'unusable', entry: renamed });
  });

  it('is listed as damaged where neither record of its pair reads', async () => {
    const library = libraryOver();
    const saved = expectSuccess(await library.store.save('Warm vocal', content.chain()));
    await library.tree.writeFile(`library/${saved.id}/entry-0.json`, Uint8Array.from([123, 34]));

    const [listed] = expectSuccess(await library.store.list());

    expect(listed).toMatchObject({
      kind: 'unusable',
      id: saved.id,
      reason: { code: 'library.entry-damaged' },
    });
  });
});

describe('changing the library from two windows', () => {
  it('lets one window take a name at a time, so two saves of one name cannot both succeed', async () => {
    const tree = new MemoryStorageTree();
    const coordinator = new MemoryLeaseCoordinator();
    const a = libraryOver(tree, coordinator, 1);
    const b = libraryOver(tree, coordinator, 2);

    const outcomes = await Promise.all([
      a.store.save('Warm vocal', content.chain()),
      b.store.save('Warm vocal', content.chain()),
    ]);

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.flatMap((outcome) => (outcome.ok ? [] : [outcome.failures[0].code]))).toEqual([
      'library.name-taken',
    ]);
    expect(expectSuccess(await a.store.list())).toHaveLength(1);
  });

  it('changes nothing where the platform refuses the library’s lock, saying why', async () => {
    const { store } = libraryOver(
      new MemoryStorageTree(),
      new MemoryLeaseCoordinator({ refuses: true }),
    );

    expect(expectFailureCode(await store.save('Warm vocal', content.chain()))).toBe(
      'library.lock-unavailable',
    );
    expect(expectSuccess(await store.list())).toEqual([]);
  });
});

describe('a change of the library cut short by a crash', () => {
  it('leaves a renamed or replaced entry as it was or as it became, never lost', async () => {
    const from = new MemoryStorageTree();
    const setup = libraryOver(from);
    const saved = expectSuccess(await setup.store.save('Warm vocal', content.chain()));
    const replacement = content.chain();

    const operations = await sweepCrashes({
      from,
      run: async (tree) => {
        const { store } = libraryOver(tree, new MemoryLeaseCoordinator(), 3);
        expectSuccess(await store.rename(saved.id, 'Warmer vocal'));
        return expectSuccess(await store.replace(saved.id, replacement));
      },
      check: async (found, crash) => {
        const { store } = libraryOver(found, new MemoryLeaseCoordinator(), 4);
        const listed = expectSuccess(await store.list()).map(usable);
        expect(listed).toHaveLength(1);
        const [entry] = listed;
        expect(entry?.id).toBe(saved.id);
        expect([saved.content, replacement]).toContainEqual(entry?.content);
        expect(['Warm vocal', 'Warmer vocal']).toContain(entry?.name);
        if (crash.outcome !== undefined) expect(entry).toEqual(crash.outcome);
      },
      tornWrites: ['short', 'full-length'],
    });

    expect(operations).toBeGreaterThan(4);
  });

  it('leaves a removed entry kept as it was, or gone', async () => {
    const from = new MemoryStorageTree();
    const setup = libraryOver(from);
    const saved = expectSuccess(await setup.store.save('Warm vocal', content.chain()));
    const renamed = expectSuccess(await setup.store.rename(saved.id, 'Warmer vocal'));

    await sweepCrashes({
      from,
      run: async (tree) => {
        const { store } = libraryOver(tree, new MemoryLeaseCoordinator(), 3);
        expectSuccess(await store.remove(saved.id));
      },
      check: async (found) => {
        const { store } = libraryOver(found, new MemoryLeaseCoordinator(), 4);
        const listed = expectSuccess(await store.list());
        expect(listed.map(usable)).toEqual(listed.length === 0 ? [] : [renamed]);
      },
    });
  });
});
