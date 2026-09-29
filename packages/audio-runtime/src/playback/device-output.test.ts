import { describe, expect, it } from 'vitest';

import {
  ChannelRole,
  StandardLayouts,
  channelLayout,
  discreteLayout,
  sampleRate,
  type ChannelLayout,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import type { GraphDescriptor } from '@audiogubbins/audio-graph';
import { BuiltInNodeType, PcmDescriptionKind } from '@audiogubbins/audio-engine';
import { distinctChannels, graphOf, named, nodeOf, wire } from '@audiogubbins/audio-engine/testing';

import type { SourceDescription } from '../protocol/source-descriptions.js';
import { PlaybackRig } from '../testing/playback-rig.js';
import { PlaybackPhase } from './playback-status.js';

const RATE = expectSuccess(sampleRate(48_000));
const SOURCE_FRAMES = 24_000;
const { Left, Right, Centre, LowFrequency, SurroundLeft, SurroundRight } = ChannelRole;

/** The graph input straight to the output, in `layout`. */
function straight(layout: ChannelLayout): GraphDescriptor {
  return graphOf(
    [
      nodeOf('in', BuiltInNodeType.GraphInput, layout, { outputs: ['out'] }),
      nodeOf('out', BuiltInNodeType.Output, layout, { inputs: ['in'] }),
    ],
    [wire('in.out', 'out.in')],
  );
}

/** The source channel a sample of `distinctChannels` came from. */
function sourceChannelOf(sample: number | undefined): number {
  return Math.floor(((sample ?? 0) * 65_536) / 1000) - 1;
}

/** Recorded audio of `frames` frames whose channels differ, in `layout`. */
function recorded(layout: ChannelLayout, frames: number): SourceDescription {
  return {
    node: named('in'),
    kind: PcmDescriptionKind.Pcm,
    sampleRate: RATE,
    channels: distinctChannels(layout, frames),
  };
}

async function playing(layout: ChannelLayout, maxChannelCount: number): Promise<PlaybackRig> {
  const rig = new PlaybackRig({ context: { maxChannelCount } });
  expectSuccess(
    await rig.session.load({
      graph: straight(layout),
      sources: [recorded(layout, SOURCE_FRAMES)],
    }),
  );
  expectSuccess(await rig.session.play());
  await rig.render(8);
  return rig;
}

describe('the device a graph plays to', () => {
  it.each<[string, ChannelLayout, readonly number[]]>([
    ['mono', StandardLayouts.mono, [0]],
    ['stereo', StandardLayouts.stereo, [0, 1]],
    ['5.1', StandardLayouts.surround5_1, [0, 1, 2, 3, 4, 5]],
    [
      '5.1 with its surrounds first',
      expectSuccess(
        channelLayout([Left, Right, SurroundLeft, SurroundRight, Centre, LowFrequency]),
      ),
      [0, 1, 4, 5, 2, 3],
    ],
    ['8 discrete channels', expectSuccess(discreteLayout(8)), [0, 1, 2, 3, 4, 5, 6, 7]],
  ])(
    'takes every channel of a %s output, unmixed, each on its own device channel',
    async (_, layout, sourceChannelAtDevice) => {
      const rig = await playing(layout, 8);

      expect(rig.current.context.destination).toMatchObject({
        channelCount: layout.roles.length,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete',
      });
      const last = rig.node.rendered.at(-1);
      if (last === undefined) throw new Error('Nothing was rendered.');
      expect(rig.node.atDevice(last).map((channel) => sourceChannelOf(channel?.[0]))).toEqual(
        sourceChannelAtDevice,
      );
    },
  );

  it('refuses an output of more channels than the device takes, before any node is made', async () => {
    const rig = new PlaybackRig({ context: { maxChannelCount: 2 } });
    const layout = StandardLayouts.surround5_1;

    const refused = await rig.session.load({
      graph: straight(layout),
      sources: [recorded(layout, 128)],
    });

    expect(expectFailureCode(refused)).toBe('playback.device-channels-exceeded');
    expect(rig.session.status.phase).toBe(PlaybackPhase.Refused);
    expect(rig.session.status.problems).toEqual([
      expect.stringMatching(
        /has 6 channels, but the output device takes at most 2\. It needs a matrix or channel-map node/u,
      ),
    ]);
    expect(rig.current.nodes).toEqual([]);
    expect(rig.current.context.destination.channelCount).toBe(2);
  });
});
