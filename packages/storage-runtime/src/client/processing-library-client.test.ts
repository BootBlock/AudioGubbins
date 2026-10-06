import { describe, expect, it } from 'vitest';

import {
  SummingLaw,
  createDeterministicIdGenerator,
  instantiateProcessor,
  type EffectChain,
  type ProcessorDescriptor,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import { MemoryLeaseCoordinator } from '@audiogubbins/storage/testing';

import { memoryStorage } from '../testing/memory-storage.js';

/**
 * The person's library, asked of the storage worker (ADR-0060): a chain of
 * the build's own processors crosses the port and comes back as saved, from
 * this tab and from another tab of the profile after it, which shares the
 * storage; and a refusal crosses as the library's reason.
 */

const ids = createDeterministicIdGenerator(404);

function descriptor(typeKey: string): ProcessorDescriptor {
  const found = PROCESSOR_CATALOGUE.get(typeKey);
  if (found === undefined) throw new Error(`The build has no ${typeKey}.`);
  return found;
}

/** A gain, then a compressor alongside a dry path, of the build's own processors. */
function chain(): EffectChain {
  return {
    id: ids.next<'EffectChainId'>(),
    slots: [
      { ...instantiateProcessor(ids.next<'ProcessorId'>(), descriptor('gain')), mix: 0.5 },
      {
        kind: 'group',
        id: ids.next<'ProcessorGroupId'>(),
        enabled: true,
        soloed: false,
        mix: 1,
        summing: SummingLaw.EqualPower,
        branches: [
          { slots: [instantiateProcessor(ids.next<'ProcessorId'>(), descriptor('compressor'))] },
          { slots: [] },
        ],
      },
    ],
  };
}

describe('the library of saved chains and presets, asked of the storage worker', () => {
  it('keeps a saved chain, which another tab of the profile lists as saved', async () => {
    const tree = new MemoryStorageTree();
    const coordinator = new MemoryLeaseCoordinator();
    const first = memoryStorage({ tree, coordinator, tab: { name: 'first', seed: 1 } });
    const saved = chain();

    const entry = expectSuccess(
      await first.client.processingLibrary.save('Parallel squeeze', {
        kind: 'chain',
        chain: saved,
      }),
    );

    const second = memoryStorage({ tree, coordinator, tab: { name: 'second', seed: 2 } });
    const listed = expectSuccess(await second.client.processingLibrary.list());
    expect(listed).toEqual([{ kind: 'usable', entry }]);
    expect(entry).toMatchObject({
      name: 'Parallel squeeze',
      content: { kind: 'chain', chain: saved },
    });
    expect(expectSuccess(await second.client.processingLibrary.entry(entry.id))).toEqual({
      kind: 'usable',
      entry,
    });
  });

  it('answers a refusal as the reason the library gave', async () => {
    const { client } = memoryStorage();
    expectSuccess(await client.processingLibrary.save('Warm', { kind: 'chain', chain: chain() }));

    const refused = await client.processingLibrary.save('WARM', { kind: 'chain', chain: chain() });

    expect(expectFailureCode(refused)).toBe('library.name-taken');
  });

  it('renames, replaces and removes an entry', async () => {
    const { client } = memoryStorage();
    const library = client.processingLibrary;
    const saved = expectSuccess(await library.save('Warm', { kind: 'chain', chain: chain() }));

    const renamed = expectSuccess(await library.rename(saved.id, 'Warmer'));
    const other = chain();
    const replaced = expectSuccess(
      await library.replace(saved.id, { kind: 'chain', chain: other }),
    );
    expect(replaced).toMatchObject({ id: saved.id, name: renamed.name, content: { chain: other } });

    expectSuccess(await library.remove(saved.id));
    expect(expectSuccess(await library.list())).toEqual([]);
  });
});
