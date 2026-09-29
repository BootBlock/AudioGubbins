import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '../testing/unwrap.js';
import {
  ChannelRole,
  MAXIMUM_CHANNEL_COUNT,
  StandardLayouts,
  channelCount,
  channelIndexOf,
  channelLabelOf,
  channelLayout,
  discreteLayout,
  labelledLayout,
  layoutsMatch,
} from './channel-layout.js';

describe('channelLayout', () => {
  it('accepts a single mono channel', () => {
    const layout = expectSuccess(channelLayout([ChannelRole.Mono]));
    expect(channelCount(layout)).toBe(1);
  });

  it('accepts an arrangement far beyond stereo', () => {
    const layout = expectSuccess(channelLayout(StandardLayouts.surround7_1.roles));
    expect(channelCount(layout)).toBe(8);
  });

  it('accepts the maximum channel count', () => {
    const layout = expectSuccess(discreteLayout(MAXIMUM_CHANNEL_COUNT));
    expect(channelCount(layout)).toBe(MAXIMUM_CHANNEL_COUNT);
  });

  it('rejects an empty layout, because no audio has zero channels', () => {
    expect(expectFailureCode(channelLayout([]))).toBe('channel.layout-empty');
  });

  it('rejects a count large enough to be a corrupt header', () => {
    const roles = Array.from({ length: MAXIMUM_CHANNEL_COUNT + 1 }, () => ChannelRole.Discrete);
    expect(expectFailureCode(channelLayout(roles))).toBe('channel.layout-too-many-channels');
  });

  it('rejects a repeated positional role, which would make routing ambiguous', () => {
    expect(expectFailureCode(channelLayout([ChannelRole.Left, ChannelRole.Left]))).toBe(
      'channel.layout-duplicate-role',
    );
  });

  it('allows discrete channels to repeat, because that is what discrete means', () => {
    const layout = expectSuccess(
      channelLayout([ChannelRole.Discrete, ChannelRole.Discrete, ChannelRole.Discrete]),
    );
    expect(channelCount(layout)).toBe(3);
  });

  it('rejects mono combined with another channel', () => {
    expect(expectFailureCode(channelLayout([ChannelRole.Mono, ChannelRole.Right]))).toBe(
      'channel.layout-mono-with-others',
    );
  });

  it('preserves the order the roles were given, because order is buffer order', () => {
    const layout = expectSuccess(
      channelLayout([ChannelRole.Right, ChannelRole.Left, ChannelRole.Centre]),
    );
    expect(layout.roles).toEqual([ChannelRole.Right, ChannelRole.Left, ChannelRole.Centre]);
  });
});

describe('discreteLayout', () => {
  it('builds a layout of the requested width', () => {
    expect(channelCount(expectSuccess(discreteLayout(12)))).toBe(12);
  });

  it('rejects zero channels', () => {
    expect(expectFailureCode(discreteLayout(0))).toBe('channel.discrete-count-invalid');
  });

  it('rejects a fractional channel count', () => {
    expect(expectFailureCode(discreteLayout(2.5))).toBe('channel.discrete-count-invalid');
  });
});

describe('layoutsMatch', () => {
  it('treats identical layouts as matching', () => {
    expect(layoutsMatch(StandardLayouts.stereo, StandardLayouts.stereo)).toBe(true);
  });

  it('treats different widths as not matching', () => {
    expect(layoutsMatch(StandardLayouts.stereo, StandardLayouts.mono)).toBe(false);
  });

  it('treats the same roles in a different order as not matching', () => {
    const swapped = expectSuccess(channelLayout([ChannelRole.Right, ChannelRole.Left]));
    expect(layoutsMatch(StandardLayouts.stereo, swapped)).toBe(false);
  });
});

describe('channelIndexOf', () => {
  it('finds a role at its buffer position', () => {
    expect(channelIndexOf(StandardLayouts.surround5_1, ChannelRole.LowFrequency)).toBe(3);
  });

  it('reports an absent role as undefined rather than -1', () => {
    expect(channelIndexOf(StandardLayouts.stereo, ChannelRole.Centre)).toBeUndefined();
  });

  it('finds the first channel of a mono layout', () => {
    expect(channelIndexOf(StandardLayouts.mono, ChannelRole.Mono)).toBe(0);
  });
});

describe('the positions beyond 7.1', () => {
  it('accepts 7.1.4, with its four height channels', () => {
    const layout = expectSuccess(channelLayout(StandardLayouts.surround7_1_4.roles));
    expect(channelCount(layout)).toBe(12);
    expect(channelIndexOf(layout, ChannelRole.TopRearRight)).toBe(11);
  });

  it('accepts LCR, which is three channels and not stereo with a centre guessed in', () => {
    expect(channelCount(expectSuccess(channelLayout(StandardLayouts.lcr.roles)))).toBe(3);
  });

  it('refuses an ambisonic role outside a set that states its convention', () => {
    expect(expectFailureCode(channelLayout([ChannelRole.Ambisonic]))).toBe(
      'channel.layout-ambisonic-without-convention',
    );
  });
});

describe('labelled layouts', () => {
  it('names each channel of a custom map, in buffer order', () => {
    const layout = expectSuccess(labelledLayout(['Dialogue', 'Music', 'Effects']));
    expect(channelCount(layout)).toBe(3);
    expect(channelLabelOf(layout, 1)).toBe('Music');
    expect(layout.roles.every((role) => role === ChannelRole.Discrete)).toBe(true);
  });

  it('labels positional channels too', () => {
    const layout = expectSuccess(channelLayout(StandardLayouts.stereo.roles, ['Main L', 'Main R']));
    expect(channelLabelOf(layout, 0)).toBe('Main L');
  });

  it('has no label where none was given', () => {
    expect(channelLabelOf(StandardLayouts.stereo, 0)).toBeUndefined();
  });

  it('refuses a label count that differs from the channel count', () => {
    expect(expectFailureCode(channelLayout(StandardLayouts.stereo.roles, ['Only one']))).toBe(
      'channel.labels-count-mismatch',
    );
  });

  it('refuses two channels of one name, which routing by name could not tell apart', () => {
    expect(expectFailureCode(labelledLayout(['Take', 'Take']))).toBe('channel.label-duplicate');
  });

  it.each([
    ['blank', ''],
    ['space around it', ' Vox '],
    ['a control character', 'Vox\u0007'],
    ['longer than any label a person types', 'x'.repeat(129)],
  ])('refuses a label that is %s', (_why, label) => {
    expect(expectFailureCode(labelledLayout([label]))).toBe('channel.label-invalid');
  });

  it('refuses an empty custom map', () => {
    expect(expectFailureCode(labelledLayout([]))).toBe('channel.layout-empty');
  });

  it('matches only a layout of the same labels', () => {
    const one = expectSuccess(labelledLayout(['A', 'B']));
    const same = expectSuccess(labelledLayout(['A', 'B']));
    const other = expectSuccess(labelledLayout(['A', 'C']));
    const unlabelled = expectSuccess(discreteLayout(2));
    expect(layoutsMatch(one, same)).toBe(true);
    expect(layoutsMatch(one, other)).toBe(false);
    expect(layoutsMatch(one, unlabelled)).toBe(false);
  });
});
