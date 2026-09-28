import { describe, expect, it } from 'vitest';

import { createInteractionStore } from './interaction-store.js';

describe('an announcement', () => {
  it('stores an announcement made without either flag with neither flag, for the notice to read', () => {
    // Decided twice, in the store and in the notice, the two could disagree;
    // the notice says what a missing flag means, and the store says nothing.
    const store = createInteractionStore();

    store.announce('The panel is closed.');

    expect(store.get().announcement).toEqual({
      text: 'The panel is closed.',
      urgent: false,
      sequence: 1,
    });
  });

  it('carries whether it is a refusal to the notice, which keeps a refusal longer', () => {
    // A polite refusal was shown for as long as a confirmation, since how long
    // a notice stayed was read from how urgently it was spoken.
    const store = createInteractionStore();

    store.announce('It is already so.', false, { refusal: true });

    expect(store.get().announcement).toMatchObject({ urgent: false, refusal: true });
  });
});
