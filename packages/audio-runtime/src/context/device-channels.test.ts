import { describe, expect, it } from 'vitest';

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

import { FakeAudioContext } from '../testing/fake-audio-context.js';
import { deviceChannelsFor, sendToDevice } from './device-channels.js';

const {
  Left,
  Right,
  Centre,
  LowFrequency,
  SurroundLeft,
  SurroundRight,
  RearLeft,
  RearRight,
  TopFrontLeft,
  Discrete,
} = ChannelRole;

function layoutOf(...roles: ChannelRole[]): ChannelLayout {
  return expectSuccess(channelLayout(roles));
}

describe('deviceChannelsFor', () => {
  it.each<[string, ChannelLayout, readonly number[]]>([
    ['mono', StandardLayouts.mono, [0]],
    ['stereo', StandardLayouts.stereo, [0, 1]],
    ['5.1 in the device’s order', StandardLayouts.surround5_1, [0, 1, 2, 3, 4, 5]],
    // The same speakers with the centre and the effects channel last, as
    // some files order them: each still plays on its own speaker.
    [
      '5.1 in another order',
      layoutOf(Left, Right, SurroundLeft, SurroundRight, Centre, LowFrequency),
      [0, 1, 4, 5, 2, 3],
    ],
    ['7.1', StandardLayouts.surround7_1, [0, 1, 2, 3, 6, 7, 4, 5]],
    ['quadraphonic, backwards', layoutOf(RearRight, RearLeft, Right, Left), [3, 2, 1, 0]],
    ['8 discrete channels', expectSuccess(discreteLayout(8)), [0, 1, 2, 3, 4, 5, 6, 7]],
    [
      '3 labelled channels',
      expectSuccess(labelledLayout(['Dialogue', 'Music', 'Effects'])),
      [0, 1, 2],
    ],
  ])('puts %s on the device channel by channel role', (_, layout, outputChannelOf) => {
    expect(expectSuccess(deviceChannelsFor(layout, 8))).toEqual({
      count: layout.roles.length,
      outputChannelOf,
    });
  });

  it('refuses an output of more channels than the device takes, naming both counts', () => {
    const refused = deviceChannelsFor(StandardLayouts.surround5_1, 2);

    expect(expectFailureCode(refused)).toBe('playback.device-channels-exceeded');
    const summary = refused.ok ? '' : refused.failures[0].summary;
    expect(summary).toMatch(/has 6 channels, but the output device takes at most 2/u);
    expect(summary).toMatch(/matrix or channel-map node/u);
  });

  it('refuses rather than guesses where the roles do not place every channel', () => {
    expect(expectFailureCode(deviceChannelsFor(layoutOf(Left, Right, Discrete), 8))).toBe(
      'playback.output-layout-unplaced',
    );
    expect(
      expectFailureCode(
        deviceChannelsFor(
          expectSuccess(
            ambisonicLayout({
              order: 1,
              ordering: AmbisonicOrdering.Acn,
              normalisation: AmbisonicNormalisation.Sn3d,
            }),
          ),
          8,
        ),
      ),
    ).toBe('playback.output-layout-unplaced');
  });

  it('places every speaker position the device order names', () => {
    expect(
      expectSuccess(deviceChannelsFor(layoutOf(TopFrontLeft, Left), 8)).outputChannelOf,
    ).toEqual([1, 0]);
  });
});

describe('sendToDevice', () => {
  it('sets the destination to take exactly the output’s channels, one by one', () => {
    const context = new FakeAudioContext({ maxChannelCount: 8 });

    sendToDevice(
      context.destination,
      expectSuccess(deviceChannelsFor(StandardLayouts.surround7_1, 8)),
    );

    expect(context.destination).toMatchObject({
      channelCount: 8,
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete',
    });
  });
});
