/**
 * A programme playing through the session goes on into one that continues it
 * (ADR-0104): through the session, the feeder and the processor, with the
 * effect rack's real filter, it is heard as the new programme would be heard
 * played from the start, without the transport pausing or the feeds being
 * rewound; and a continuation is refused where it cannot go on from what is
 * loaded.
 */

import { Blob as PlatformBlob } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  createDeterministicIdGenerator,
  derivedSampleCount,
  sampleRate,
  unsafeBrandId,
  type EditPlan,
  type EffectChain,
  type PlanSegment,
  type PlanSource,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { BuiltInNodeType, PcmDescriptionKind, TransportMode } from '@audiogubbins/audio-engine';
import { graphOf, named, nodeOf, rackedMedia, wire } from '@audiogubbins/audio-engine/testing';
import { AudioContextState } from '../context/audio-context-port.js';
import { ToFeederKind } from '../protocol/feeder-messages.js';
import type { SourceDescription } from '../protocol/source-descriptions.js';
import { CAPTURE_PROCESSING, catalogueSlot } from '../testing/capture-rig.js';
import { PlaybackRig } from '../testing/playback-rig.js';
import type { PlaybackRequest } from './playback-preparation.js';

const MONO = StandardLayouts.mono;
const RATE = expectSuccess(sampleRate(48_000));
const QUANTUM = 128;
const HORIZON = 24_000;
const LONGER = 48_000;
const ASSET = unsafeBrandId<'AssetId'>('0000c0de-0a55');
/** The effect rack over the whole catalogue, as the feeder's module makes it. */
const RACK = CAPTURE_PROCESSING;

const GRAPH = graphOf(
  [
    nodeOf('in', BuiltInNodeType.GraphInput, MONO, { outputs: ['out'] }),
    nodeOf('out', BuiltInNodeType.Output, MONO, { inputs: ['in'] }),
  ],
  [wire('in.out', 'out.in')],
);

/** Noise from a seed, so every frame differs. */
function noise(seed: number, frames: number): Float32Array {
  let state = seed;
  return Float32Array.from({ length: frames }, () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return Math.fround(state / 2 ** 32 - 0.5);
  });
}

/** The member's file, one a structured clone carries to the feeder. */
const MEDIA = [
  {
    ...rackedMedia([noise(7, 8_000)], RATE, 'memory:member', (bytes) => new PlatformBlob([bytes])),
    asset: ASSET,
  },
];

const ids = createDeterministicIdGenerator(2_026);
const BUS: EffectChain = {
  id: ids.next(),
  slots: [catalogueSlot(ids, 'filter', { cutoff: 1_500 })],
};

function segment(source: PlanSource, start: number, length: number): PlanSegment {
  return {
    source,
    start: derivedSampleCount(start),
    length: derivedSampleCount(length),
    reversed: false,
    stages: [],
  };
}

/**
 * The output reading a bus, a filter over a lane: silence, the member from
 * frame 1,000 to 5,000, and a voice of it at each frame of `voices`, to
 * `horizon`.
 */
function programme(horizon: number, voices: readonly number[] = []): EditPlan {
  const lane: PlanSegment[] = [];
  let position = 0;
  for (const at of [1_000, ...voices]) {
    lane.push(segment({ kind: 'silence', channels: 1 }, 0, at - position));
    lane.push(segment({ kind: 'media', asset: ASSET }, 0, 4_000));
    position = at + 4_000;
  }
  lane.push(segment({ kind: 'silence', channels: 1 }, 0, horizon - position));
  return {
    streams: [
      {
        sampleRate: RATE,
        layout: MONO,
        segments: [segment({ kind: 'stream', stream: 1 }, 0, horizon)],
      },
      {
        sampleRate: RATE,
        layout: MONO,
        segments: [segment({ kind: 'stream', stream: 2 }, 0, horizon)],
        processing: { kind: 'chain', chain: BUS, input: MONO },
      },
      { sampleRate: RATE, layout: MONO, segments: lane },
    ],
  };
}

function request(plan: EditPlan): PlaybackRequest {
  const source: SourceDescription = {
    node: named('in'),
    kind: PcmDescriptionKind.Edited,
    sampleRate: RATE,
    plan,
    media: MEDIA,
  };
  return { quality: MAXIMUM_QUALITY, graph: GRAPH, sources: [source] };
}

const OLD = programme(HORIZON);

/** A rig playing `plan` from its start. */
async function playing(plan: EditPlan): Promise<PlaybackRig> {
  const rig = new PlaybackRig({ processing: RACK });
  expectSuccess(await rig.session.load(request(plan)));
  expectSuccess(await rig.session.play());
  return rig;
}

/** Every sample the rig's last node played, in order. */
function heard(rig: PlaybackRig): number[] {
  return rig.node.rendered.flatMap((quantum) => [...(quantum.channels[0] ?? [])]);
}

/** What `plan` sounds like played through a rig from its start for `quanta` quanta. */
async function uninterrupted(plan: EditPlan, quanta: number): Promise<number[]> {
  const rig = await playing(plan);
  await rig.render(quanta);
  return heard(rig);
}

describe('a programme continued while it plays', () => {
  it('is heard as the new programme played from its start, the transport playing on and the feeds never rewound', async () => {
    const rig = await playing(OLD);
    await rig.render(40);
    const from = expectSuccess(rig.session.readFrame());
    const next = programme(LONGER, [from + 2_000, 30_000]);

    const continued = expectSuccess(await rig.session.continueWith(request(next), from));
    const mode = rig.session.status.transport.mode;
    await rig.render(360);

    expect(continued.kind).toBe('continued');
    expect(continued.frame).toBeLessThanOrEqual(from);
    expect(mode).toBe(TransportMode.Playing);
    expect(rig.feeder.received.filter(({ kind }) => kind === ToFeederKind.Start)).toHaveLength(1);
    expect(heard(rig)).toEqual(await uninterrupted(next, 400));
  });

  it('is taken whenever it is asked from the frame the session says the feeder reads from', async () => {
    const rig = await playing(OLD);
    const answers: string[] = [];

    for (let step = 1; step <= 5; step += 1) {
      await rig.render(30);
      const from = expectSuccess(rig.session.readFrame());
      const answer = expectSuccess(
        await rig.session.continueWith(request(programme(HORIZON + step * 4_800, [from])), from),
      );
      answers.push(answer.kind);
    }

    expect(answers).toEqual(['continued', 'continued', 'continued', 'continued', 'continued']);
  });

  it('is too late, with the frame the feeder had reached, where it differs before it, and changes nothing', async () => {
    const rig = await playing(OLD);
    await rig.render(40);

    const answer = expectSuccess(
      await rig.session.continueWith(
        request(programme(HORIZON, [6_000])),
        derivedSampleCount(6_000),
      ),
    );
    await rig.render(160);

    expect(answer.kind).toBe('too-late');
    expect(answer.frame).toBeGreaterThan(40 * QUANTUM);
    expect(heard(rig)).toEqual(await uninterrupted(OLD, 200));
  });

  it('is refused with nothing loaded, and for another graph, which is loaded instead', async () => {
    const idle = new PlaybackRig({ processing: RACK });
    expect(
      expectFailureCode(await idle.session.continueWith(request(OLD), derivedSampleCount(0))),
    ).toBe('playback.not-ready');

    const rig = await playing(OLD);
    const stereo = graphOf(
      [
        nodeOf('in', BuiltInNodeType.GraphInput, StandardLayouts.stereo, { outputs: ['out'] }),
        nodeOf('out', BuiltInNodeType.Output, StandardLayouts.stereo, { inputs: ['in'] }),
      ],
      [wire('in.out', 'out.in')],
    );
    expect(
      expectFailureCode(
        await rig.session.continueWith(
          { ...request(OLD), graph: stereo },
          derivedSampleCount(HORIZON),
        ),
      ),
    ).toBe('playback.continuation-unmatched');
  });

  it('is refused as unanswered where the feeder never answers, and leaves what plays as it was', async () => {
    const rig = await playing(OLD);
    await rig.render(10);
    rig.feeder.terminated = true;

    const asked = rig.session.continueWith(request(programme(LONGER)), derivedSampleCount(HORIZON));
    rig.schedule.advance(10_000);

    expect(expectFailureCode(await asked)).toBe('playback.continuation-unanswered');
    expect(rig.session.status.transport.mode).toBe(TransportMode.Playing);
  });

  it('is what plays on a new context after the old one is lost, from the sources the feeder kept', async () => {
    const rig = await playing(OLD);
    await rig.render(40);
    const from = expectSuccess(rig.session.readFrame());
    expectSuccess(await rig.session.continueWith(request(programme(LONGER, [30_000])), from));

    rig.current.context.becomes(AudioContextState.Closed);
    expectSuccess(await rig.session.play());
    expectSuccess(await rig.session.seek(derivedSampleCount(29_952)));
    await rig.render(40);

    expect(rig.feeder.received.filter(({ kind }) => kind === ToFeederKind.Sources)).toHaveLength(1);
    // The old programme was silence there; the new one plays its voice from frame 30,000.
    expect(heard(rig).some((sample) => sample !== 0)).toBe(true);
  });
});
