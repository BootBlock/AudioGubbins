import { afterEach, describe, expect, it, vi } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';

import type * as ChannelNames from './channel-names.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

/** The module as a fresh load reads it, so a constructor stubbed first is the one it meets. */
async function freshlyLoaded(): Promise<typeof ChannelNames> {
  vi.resetModules();
  return await import('./channel-names.js');
}

describe('a channel named by a person', () => {
  it('is found by its name in any case, or by its number from 1', async () => {
    const { channelNamed } = await freshlyLoaded();
    expect(channelNamed(StandardLayouts.stereo, 'right')).toBe(1);
    expect(channelNamed(StandardLayouts.stereo, ' LEFT ')).toBe(0);
    expect(channelNamed(StandardLayouts.stereo, 2)).toBe(1);
    expect(channelNamed(StandardLayouts.stereo, 'Centre')).toBeUndefined();
  });

  it('loads where no collator can be made, so the application still starts, and is then found by its number alone', async () => {
    // A collator made where the module loads threw here, and the whole
    // application stopped before it drew anything.
    vi.spyOn(Intl, 'Collator').mockImplementation(function Collator(): never {
      throw new RangeError('This runtime makes no collator.');
    });
    const { channelNamed } = await freshlyLoaded();
    expect(channelNamed(StandardLayouts.stereo, 2)).toBe(1);
    expect(channelNamed(StandardLayouts.stereo, 'Right')).toBeUndefined();
  });
});
