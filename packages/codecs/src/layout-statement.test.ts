/**
 * Which layouts each format states, and the order a coded format's channels
 * are written in (ADR-0093).
 */

import {
  AmbisonicNormalisation,
  AmbisonicOrdering,
  ChannelRole,
  StandardLayouts,
  ambisonicLayout,
  channelLayout,
  discreteLayout,
  labelledLayout,
  type ChannelLayout,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import type { CodecId, ContainerId } from './codec-descriptor.js';
import { writtenChannelOrder } from './layout-statement.js';

const {
  Left,
  Right,
  Centre,
  LowFrequency,
  SurroundLeft,
  SurroundRight,
  RearLeft,
  RearRight,
  RearCentre,
  FrontLeftOfCentre,
  FrontRightOfCentre,
} = ChannelRole;

const layout = (...roles: ChannelRole[]): ChannelLayout => expectSuccess(channelLayout(roles));

const FIRST_ORDER_AMBIX = expectSuccess(
  ambisonicLayout({
    order: 1,
    ordering: AmbisonicOrdering.Acn,
    normalisation: AmbisonicNormalisation.Sn3d,
  }),
);

const CODED: readonly (readonly [CodecId, ContainerId])[] = [
  ['flac', 'flac'],
  ['vorbis', 'ogg'],
  ['opus', 'ogg'],
];

describe('the layouts FLAC, Vorbis and Opus state', () => {
  it('states each count’s one arrangement, in the speaker mask’s order', () => {
    const cases: readonly (readonly [ChannelLayout, readonly number[]])[] = [
      [StandardLayouts.mono, [0]],
      [StandardLayouts.stereo, [0, 1]],
      [StandardLayouts.lcr, [0, 1, 2]],
      [StandardLayouts.quadraphonic, [0, 1, 2, 3]],
      [layout(Left, Right, Centre, SurroundLeft, SurroundRight), [0, 1, 2, 3, 4]],
      [StandardLayouts.surround5_1, [0, 1, 2, 3, 4, 5]],
      // 5.1 with its rear pair, given in another order.
      [layout(Centre, Left, Right, RearLeft, RearRight, LowFrequency), [1, 2, 0, 5, 3, 4]],
      [
        layout(Left, Right, Centre, LowFrequency, SurroundLeft, SurroundRight, RearCentre),
        [0, 1, 2, 3, 6, 4, 5],
      ],
      // The domain's 7.1 holds the side pair before the rear pair; the mask the rear pair first.
      [StandardLayouts.surround7_1, [0, 1, 2, 3, 6, 7, 4, 5]],
    ];
    for (const [codec, container] of CODED) {
      for (const [given, order] of cases) {
        expect(expectSuccess(writtenChannelOrder(codec, container, given))).toEqual(order);
      }
    }
  });

  it('refuses every other layout, naming WAV', () => {
    const refused = [
      layout(Centre),
      layout(Left, Right, SurroundLeft, SurroundRight),
      layout(Left, Right, Centre, LowFrequency, SurroundLeft, SurroundRight, RearLeft),
      StandardLayouts.surround7_1_4,
      expectSuccess(discreteLayout(2)),
      expectSuccess(labelledLayout(['Kick', 'Snare'])),
      FIRST_ORDER_AMBIX,
    ];
    for (const [codec, container] of CODED) {
      for (const given of refused) {
        const result = writtenChannelOrder(codec, container, given);
        expect(expectFailureCode(result)).toBe('codecs.layout-unwritable');
        expect(result.ok ? '' : result.failures[0].summary).toContain('WAV states every layout');
      }
    }
  });
});

describe('the layouts AAC and MP3 state', () => {
  it('states AAC’s channel configurations, its eight channels with the front-centre pair', () => {
    expect(
      expectSuccess(writtenChannelOrder('aac-lc', 'mp4', layout(Left, Right, Centre, RearCentre))),
    ).toEqual([0, 1, 2, 3]);
    expect(
      expectSuccess(
        writtenChannelOrder(
          'aac-lc',
          'mp4',
          layout(
            Left,
            Right,
            Centre,
            LowFrequency,
            SurroundLeft,
            SurroundRight,
            FrontLeftOfCentre,
            FrontRightOfCentre,
          ),
        ),
      ),
    ).toEqual([0, 1, 2, 3, 6, 7, 4, 5]);
    expect(
      expectFailureCode(writtenChannelOrder('aac-lc', 'mp4', StandardLayouts.surround7_1)),
    ).toBe('codecs.layout-unwritable');
    expect(
      expectFailureCode(writtenChannelOrder('aac-lc', 'mp4', StandardLayouts.quadraphonic)),
    ).toBe('codecs.layout-unwritable');
  });

  it('states mono and stereo in MP3, and nothing else', () => {
    expect(expectSuccess(writtenChannelOrder('mp3', 'mp3', StandardLayouts.mono))).toEqual([0]);
    expect(expectSuccess(writtenChannelOrder('mp3', 'mp3', layout(Right, Left)))).toEqual([1, 0]);
    for (const given of [
      StandardLayouts.lcr,
      expectSuccess(discreteLayout(2)),
      expectSuccess(discreteLayout(1)),
    ]) {
      expect(expectFailureCode(writtenChannelOrder('mp3', 'mp3', given))).toBe(
        'codecs.layout-unwritable',
      );
    }
  });
});

describe('the layouts WAV and AIFF state', () => {
  it('states every layout in WAV, of every code, its speakers in the mask’s order', () => {
    for (const codec of ['pcm', 'ima-adpcm', 'g711-alaw'] as const) {
      expect(expectSuccess(writtenChannelOrder(codec, 'wav', StandardLayouts.surround7_1))).toEqual(
        [0, 1, 2, 3, 6, 7, 4, 5],
      );
      for (const given of [
        FIRST_ORDER_AMBIX,
        expectSuccess(labelledLayout(['Kick', 'Snare'])),
        StandardLayouts.surround7_1_4,
      ]) {
        expectSuccess(writtenChannelOrder(codec, 'rf64', given));
      }
    }
  });

  it('states in AIFF what a CHAN chunk can, in the order given, and refuses named channels', () => {
    expect(expectSuccess(writtenChannelOrder('pcm', 'aifc', StandardLayouts.surround7_1))).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(
      expectFailureCode(
        writtenChannelOrder('pcm', 'aiff', expectSuccess(labelledLayout(['Kick', 'Snare']))),
      ),
    ).toBe('codecs.layout-unwritable');
  });

  it('refuses a codec in a container AudioGubbins does not write it in', () => {
    expect(expectFailureCode(writtenChannelOrder('opus', 'webm', StandardLayouts.stereo))).toBe(
      'codecs.layout-unwritable',
    );
  });
});
