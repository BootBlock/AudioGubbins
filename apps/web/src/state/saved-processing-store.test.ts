import { describe, expect, it } from 'vitest';

import {
  createDeterministicIdGenerator,
  instantiateProcessor,
  type LibraryContent,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';

import { projectWorld, type ProjectWindow } from '../testing/project-context.js';

/**
 * The person's library as each tab lists it (ADR-0060): the library is theirs,
 * so another tab's change reaches this one, said on the library's channel by
 * the tab that made it, and a tab the person comes back to reads it again in
 * case a word was missed. The list is brought up to date in place.
 */

const IDS = createDeterministicIdGenerator(5_000);

/** A chain of one gain, as a saved chain holds one. */
function gainChain(): LibraryContent {
  const gain = PROCESSOR_CATALOGUE.get('gain');
  if (gain === undefined) throw new Error('The build has a gain.');
  return {
    kind: 'chain',
    chain: { id: IDS.next<'EffectChainId'>(), slots: [instantiateProcessor(IDS.next(), gain)] },
  };
}

/** The names a window's library lists, in its order. */
function namesIn(window: ProjectWindow): readonly string[] {
  return window.projects.savedProcessing
    .get()
    .entries.map((listed) => (listed.kind === 'usable' ? listed.entry.name : listed.id));
}

describe('the library as a tab lists it', { timeout: 30_000 }, () => {
  it('reads the list again when another tab says it changed the library', async () => {
    const world = projectWorld();
    const first = await world.window();
    const second = await world.window();

    expectSuccess(await first.projects.savedProcessing.save('Warm vocal', gainChain()));

    await expect.poll(() => namesIn(second)).toEqual(['Warm vocal']);
    expect(world.words.posted).toEqual([['audiogubbins.processing-library', 'changed']]);
  });

  it('says nothing to the other tabs of a change the library refused', async () => {
    const world = projectWorld();
    const first = await world.window();
    expectSuccess(await first.projects.savedProcessing.save('Warm vocal', gainChain()));

    const refused = await first.projects.savedProcessing.save('Warm vocal', gainChain());

    expect(refused.ok).toBe(false);
    expect(world.words.posted).toHaveLength(1);
  });

  it('reads the list again when the person comes back to the tab, where no word reached it', async () => {
    const world = projectWorld();
    const window = await world.window();
    // Saved by another window of the profile, which says nothing on the channel.
    expectSuccess(await world.storage.processingLibrary.save('Bright', gainChain()));
    window.page.hide();
    await Promise.resolve();
    expect(namesIn(window)).toEqual([]);

    window.page.show();

    await expect.poll(() => namesIn(window)).toEqual(['Bright']);
  });

  it('keeps every entry a reading finds unchanged as the value it was, and tells no one of a reading that changes nothing', async () => {
    const world = projectWorld();
    const window = await world.window();
    const library = window.projects.savedProcessing;
    const kept = expectSuccess(await library.save('Warm vocal', gainChain()));
    expectSuccess(await library.save('Bright', gainChain()));
    const named = (name: string) =>
      library
        .get()
        .entries.find((listed) => listed.kind === 'usable' && listed.entry.name === name);
    const warm = named('Warm vocal');
    const bright = named('Bright');
    expectSuccess(await world.storage.processingLibrary.rename(kept.id, 'Warmer'));

    expectSuccess(await library.refresh());

    expect(named('Warmer')).toBeDefined();
    expect(named('Warmer')).not.toBe(warm);
    expect(named('Bright')).toBe(bright);
    let told = 0;
    const stop = library.subscribe(() => {
      told += 1;
    });
    const list = library.get().entries;
    expectSuccess(await library.refresh());
    stop();
    expect(told).toBe(0);
    expect(library.get().entries).toBe(list);
  });
});
