import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '../testing/unwrap.js';
import {
  ChannelRole,
  MAXIMUM_CHANNEL_COUNT,
  StandardLayouts,
  channelCount,
  channelIndexOf,
  channelLayout,
  discreteLayout,
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
