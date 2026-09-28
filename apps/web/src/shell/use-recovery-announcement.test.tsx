import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { buildShellContext } from '../testing/shell-context.js';
import {
  standingRecovery,
  startingRecoveries,
  type Notice,
  type StandingRecovery,
} from '../state/recovery-notices.js';
import { useRecoveryAnnouncement } from './use-recovery-announcement.js';

/**
 * The recovery notice is said, once, as it appears: the status bar is not a
 * live region, so shown there alone it would reach only a user who looked at
 * it.
 */

const KEPT_ASIDE = 'The text that could not be read is kept aside.';

const LAYOUT: Notice = {
  fact: 'The stored workspace could not be read.',
  consequences: KEPT_ASIDE,
  waitsForRoom: false,
};

const COLLECTION: Notice = {
  fact: 'The workspaces you saved could not be read.',
  consequences: KEPT_ASIDE,
  waitsForRoom: false,
};

const PROFILES: Notice = {
  fact: 'The shortcut profiles you made could not be read.',
  consequences: KEPT_ASIDE,
  waitsForRoom: false,
};

/** The notices standing for those each store holds, none of whose text waits for room. */
function standing(
  layout: Notice | undefined,
  collection: Notice | undefined,
  profiles?: Notice,
): StandingRecovery {
  return standingRecovery(
    { recoveries: startingRecoveries(layout, collection), waitsForRoom: false },
    { recovery: profiles, waitsForRoom: false },
  );
}

/** What is announced as the application starts over `raw`, with every store's notices. */
function announcedOver(raw: Parameters<typeof buildShellContext>[0]): unknown {
  const { context } = buildShellContext(raw);
  const announce = vi.fn();
  renderHook(() => {
    useRecoveryAnnouncement(
      standingRecovery(context.workspace.get(), context.shortcuts.get()),
      announce,
    );
  });
  expect(announce).toHaveBeenCalledTimes(1);
  return announce.mock.calls[0]?.[0];
}

/** Storage whose mounted layout, collection and shortcut profiles are none of them JSON. */
function everythingUnreadable() {
  const raw = ephemeralStorage();
  raw.write('audiogubbins.workspace', '{"schemaVersion": 1, "groups": [');
  raw.write('audiogubbins.workspaces', '[{"id": "mine",');
  raw.write('audiogubbins.shortcuts', '{"schemaVersion":1,"selectedId":"mine","profiles":[');
  return raw;
}

/** The facts over {@link everythingUnreadable}, where every text is set aside. */
const FACTS = {
  layout: 'The stored workspace could not be read.',
  collection:
    'The workspaces you saved could not be read, so only the built-in ones and any you have saved since are listed.',
  profiles:
    'The shortcut profiles you made could not be read, so the default shortcuts are in force.',
};

/** Every fact of {@link FACTS}, in the order the notices stand. */
const EVERY_FACT = `${FACTS.layout} ${FACTS.collection} ${FACTS.profiles}`;

/** Storage over `raw` that refuses whatever is written under `keys`, as at the quota. */
function refusingKeys(raw: ReturnType<typeof ephemeralStorage>, ...keys: readonly string[]) {
  return {
    ...raw,
    write: (written: string, value: string) => {
      if (keys.includes(written)) throw new Error('The quota is full.');
      raw.write(written, value);
    },
  };
}

describe('useRecoveryAnnouncement', () => {
  it('says every recovery, urgently, in one announcement', () => {
    const announce = vi.fn();

    renderHook(() => {
      useRecoveryAnnouncement(standing(LAYOUT, COLLECTION), announce);
    });

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(
      'The stored workspace could not be read. The workspaces you saved could not be read. The text that could not be read is kept aside.',
      true,
    );
  });

  it('says it once, however often the shell redraws', () => {
    const announce = vi.fn();

    const { rerender } = renderHook(
      ({ recovery }: { readonly recovery: StandingRecovery }) => {
        useRecoveryAnnouncement(recovery, announce);
      },
      { initialProps: { recovery: standing(LAYOUT, COLLECTION) } },
    );
    // Dismissing one notice hands the hook a new list.
    rerender({ recovery: standing(undefined, COLLECTION) });
    rerender({ recovery: standing(undefined, COLLECTION) });

    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('says the first sentences of a long notice and points at the copy that keeps the rest', () => {
    // The collection damaged with no room to set the text aside, said whole,
    // is over sixty words, said assertively at the moment the user arrives.
    const announce = vi.fn();
    const long: Notice = {
      fact: 'The workspaces you saved could not be read, so only the built-in ones and any you have saved since are listed. The workspaces you save now cannot be kept until there is room.',
      consequences:
        'The text that could not be read is left where it is, and there is no room to set it aside. AudioGubbins tries again each time you change a workspace, and at the next start.',
      waitsForRoom: true,
    };

    renderHook(() => {
      useRecoveryAnnouncement(
        standingRecovery(
          { recoveries: startingRecoveries(undefined, long), waitsForRoom: true },
          { recovery: undefined, waitsForRoom: false },
        ),
        announce,
      );
    });

    const [text] = announce.mock.calls[0] ?? [];
    expect(text).toContain('The workspaces you saved could not be read');
    // The consequence is said, and what AudioGubbins does meanwhile is not.
    expect(text).toContain('The workspaces you save now cannot be kept until there is room.');
    expect(text).not.toContain('tries again');
    expect(text).not.toContain('clearing this site');
    expect(text).toContain('The status bar has the rest.');
    expect(String(text).split(/\s+/).length).toBeLessThan(70);
  });

  it('says a notice of exactly the word bound whole, with nothing to point at', () => {
    // Sixty words, as many as are said before the rest is left to the status
    // bar, so the last sentence ends on the bound and is said with the rest.
    // The collection's notice where its text and a copy's beside it are both
    // set aside, as the custody words it, and one sentence to reach the bound.
    const announce = vi.fn();
    const atTheBound: Notice = {
      fact: '12 of the workspaces you saved could not be read, so they are not listed.',
      consequences: `${KEPT_ASIDE} Some of the workspaces you saved since could not be read either, so they are not listed. What could not be read of them is kept aside. The rest of what you saved is listed.`,
      waitsForRoom: false,
    };
    const whole = `${atTheBound.fact} ${atTheBound.consequences}`;
    expect(whole.split(/\s+/u)).toHaveLength(60);

    renderHook(() => {
      useRecoveryAnnouncement(standing(undefined, atTheBound), announce);
    });

    expect(announce).toHaveBeenCalledWith(whole, true);
  });

  it('points at the status bar while text waits for room, though every notice is said whole', () => {
    // The advice on making room is in the status bar alone.
    const announce = vi.fn();
    const waiting: Notice = {
      fact: `${PROFILES.fact} Changes to your shortcuts cannot be kept until there is room.`,
      consequences:
        'The text that could not be read is left where it is, and there is no room to set it aside.',
      waitsForRoom: true,
    };

    renderHook(() => {
      useRecoveryAnnouncement(
        standingRecovery(
          { recoveries: [], waitsForRoom: false },
          { recovery: waiting, waitsForRoom: true },
        ),
        announce,
      );
    });

    expect(announce).toHaveBeenCalledWith(
      `${waiting.fact} ${waiting.consequences} The status bar has the rest.`,
      true,
    );
  });

  it('says nothing when nothing needed recovering', () => {
    const announce = vi.fn();

    renderHook(() => {
      useRecoveryAnnouncement(standing(undefined, undefined), announce);
    });

    expect(announce).not.toHaveBeenCalled();
  });

  it("says the shortcut profiles' notice after the workspace's, in the same announcement", () => {
    const announce = vi.fn();

    renderHook(() => {
      useRecoveryAnnouncement(standing(LAYOUT, undefined, PROFILES), announce);
    });

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(
      'The stored workspace could not be read. The shortcut profiles you made could not be read. The text that could not be read is kept aside.',
      true,
    );
  });

  it("says the shortcut profiles' notice when it is the only one", () => {
    const announce = vi.fn();

    renderHook(() => {
      useRecoveryAnnouncement(standing(undefined, undefined, PROFILES), announce);
    });

    expect(announce).toHaveBeenCalledWith(
      'The shortcut profiles you made could not be read. The text that could not be read is kept aside.',
      true,
    );
  });

  it("says the fact of every notice first, the layout's, the whole collection's and the profiles', where every text is set aside", () => {
    // Said a notice at a time, the layout's and the collection's took the
    // words, and the profiles' was left out whole.
    expect(announcedOver(everythingUnreadable())).toBe(`${EVERY_FACT} ${KEPT_ASIDE}`);
  });

  it("says the collection's and the profiles' facts while the layout's text waits for room", () => {
    // The layout's consequences take more words than the facts leave, so the
    // workspace on screen not being kept is said in its fact or not at all.
    const refusing = refusingKeys(everythingUnreadable(), 'audiogubbins.workspace.unreadable');

    expect(announcedOver(refusing)).toBe(
      `${FACTS.layout} The workspace on screen cannot be kept until there is room. ${FACTS.collection} ${FACTS.profiles} The status bar has the rest.`,
    );
  });

  it("says changes to the shortcuts cannot be kept while the profiles' text alone waits for room", () => {
    // The profiles' consequences come after the others', past the words the
    // facts leave, so their loss is said in their fact or not at all.
    const refusing = refusingKeys(everythingUnreadable(), 'audiogubbins.shortcuts.unreadable');

    expect(announcedOver(refusing)).toBe(
      `${EVERY_FACT} Changes to your shortcuts cannot be kept until there is room. The status bar has the rest.`,
    );
  });

  it("says every fact whole, past the word bound, while every store's text waits for room", () => {
    // Each fact says what cannot be kept until there is room, so the three
    // come to seventy-eight words, more than the bound, and no consequence is
    // said. The collection waits only once the copy beside it holds unread
    // text too.
    const raw = everythingUnreadable();
    raw.write('audiogubbins.workspaces.recovered', '[{"broken"');
    const refusing = refusingKeys(
      raw,
      'audiogubbins.workspace.unreadable',
      'audiogubbins.workspaces.unreadable',
      'audiogubbins.shortcuts.unreadable',
    );
    const facts = [
      `${FACTS.layout} The workspace on screen cannot be kept until there is room.`,
      `${FACTS.collection} The workspaces you save now cannot be kept until there is room.`,
      `${FACTS.profiles} Changes to your shortcuts cannot be kept until there is room.`,
    ].join(' ');

    expect(announcedOver(refusing)).toBe(`${facts} The status bar has the rest.`);
    expect(facts.split(/\s+/u)).toHaveLength(78);
  });
});
