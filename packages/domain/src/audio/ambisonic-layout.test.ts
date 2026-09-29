import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '../testing/unwrap.js';
import {
  FIRST_ORDER_AMBIX,
  ambisonicChannelCount,
  ambisonicComponentOf,
  ambisonicLayout,
} from './ambisonic-layout.js';
import {
  AmbisonicNormalisation,
  AmbisonicOrdering,
  StandardLayouts,
  channelCount,
  layoutsMatch,
} from './channel-layout.js';

const FIRST_ORDER_FUMA = {
  order: 1,
  ordering: AmbisonicOrdering.FuMa,
  normalisation: AmbisonicNormalisation.FuMa,
};

describe('ambisonicLayout', () => {
  it('holds (order + 1) squared components', () => {
    expect(channelCount(expectSuccess(ambisonicLayout(FIRST_ORDER_AMBIX)))).toBe(4);
    const third = { ...FIRST_ORDER_AMBIX, order: 3 };
    expect(channelCount(expectSuccess(ambisonicLayout(third)))).toBe(16);
  });

  it('accepts the fifteenth order, whose 256 components are the most a layout holds', () => {
    const layout = expectSuccess(ambisonicLayout({ ...FIRST_ORDER_AMBIX, order: 15 }));
    expect(channelCount(layout)).toBe(256);
    expect(ambisonicChannelCount(15)).toBe(256);
  });

  it.each([
    ['past the channel bound', 16],
    ['negative', -1],
    ['fractional', 1.5],
  ])('refuses an order that is %s', (_why, order) => {
    expect(expectFailureCode(ambisonicLayout({ ...FIRST_ORDER_AMBIX, order }))).toBe(
      'channel.ambisonic-order-invalid',
    );
  });

  it('refuses the FuMa order with another scaling, which no format carries', () => {
    const mixed = { ...FIRST_ORDER_FUMA, normalisation: AmbisonicNormalisation.Sn3d };
    expect(expectFailureCode(ambisonicLayout(mixed))).toBe('channel.ambisonic-convention-mixed');
  });

  it('refuses FuMa past the third order, where it is not defined', () => {
    expect(expectFailureCode(ambisonicLayout({ ...FIRST_ORDER_FUMA, order: 4 }))).toBe(
      'channel.ambisonic-fuma-order-too-high',
    );
  });

  it('tells AmbiX from FuMa of the same order, whose channels mean different things', () => {
    const ambix = expectSuccess(ambisonicLayout(FIRST_ORDER_AMBIX));
    const fuma = expectSuccess(ambisonicLayout(FIRST_ORDER_FUMA));
    expect(layoutsMatch(ambix, fuma)).toBe(false);
    expect(layoutsMatch(ambix, expectSuccess(ambisonicLayout(FIRST_ORDER_AMBIX)))).toBe(true);
  });
});

describe('ambisonicComponentOf', () => {
  it('reads ACN channels as their own channel number', () => {
    const layout = expectSuccess(ambisonicLayout({ ...FIRST_ORDER_AMBIX, order: 2 }));
    expect(ambisonicComponentOf(layout, 0)).toEqual({ degree: 0, index: 0, acn: 0 });
    expect(ambisonicComponentOf(layout, 1)).toEqual({ degree: 1, index: -1, acn: 1 });
    expect(ambisonicComponentOf(layout, 8)).toEqual({ degree: 2, index: 2, acn: 8 });
  });

  it('reads FuMa W X Y Z as the ACN components 0, 3, 1 and 2', () => {
    const layout = expectSuccess(ambisonicLayout(FIRST_ORDER_FUMA));
    expect([0, 1, 2, 3].map((channel) => ambisonicComponentOf(layout, channel)?.acn)).toEqual([
      0, 3, 1, 2,
    ]);
  });

  it('reads the third-order FuMa letters to the last, Q, which is ACN 9', () => {
    const layout = expectSuccess(ambisonicLayout({ ...FIRST_ORDER_FUMA, order: 3 }));
    expect(ambisonicComponentOf(layout, 15)).toEqual({ degree: 3, index: -3, acn: 9 });
  });

  it('answers nothing for a speaker layout or a channel past the set', () => {
    expect(ambisonicComponentOf(StandardLayouts.stereo, 0)).toBeUndefined();
    const layout = expectSuccess(ambisonicLayout(FIRST_ORDER_AMBIX));
    expect(ambisonicComponentOf(layout, 4)).toBeUndefined();
  });
});
