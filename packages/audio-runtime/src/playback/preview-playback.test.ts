/**
 * Playback of a racked sound, through the session, the feeder and the
 * preview worker (ADR-0061, REQ-AUDIO-019): a chain that cannot run as it
 * plays is heard from the preview worker's render, the feeder never running
 * it; a numeric parameter changed while a chain plays live reaches it and is
 * heard without playback starting again; and a change to a chain heard from
 * a render is refused, so the page loads the sound again.
 */

import { Blob as PlatformBlob } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  sampleRate,
  unsafeBrandId,
  type EffectChain,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import {
  BuiltInNodeType,
  CachePurpose,
  PcmDescriptionKind,
  REFERENCE_DSP,
  RenderPhase,
} from '@audiogubbins/audio-engine';
import {
  graphOf,
  nodeOf,
  rackedMedia,
  rackedPlan,
  scalingChain,
  wire,
  named,
} from '@audiogubbins/audio-engine/testing';

import { PreviewWorkerCore } from '../preview/preview-worker-core.js';
import {
  FromPreviewWorkerKind,
  ToPreviewWorkerKind,
  type FromPreviewWorker,
} from '../protocol/preview-worker-messages.js';
import { ToFeederKind } from '../protocol/feeder-messages.js';
import type { SourceDescription } from '../protocol/source-descriptions.js';
import { fakeChannel } from '../testing/fake-message-channel.js';
import { PlaybackRig } from '../testing/playback-rig.js';

const MONO = StandardLayouts.mono;
const RATE = expectSuccess(sampleRate(48_000));
const QUANTUM = 128;
const LENGTH = 48_000;
const PROCESSOR = unsafeBrandId<'ProcessorId'>('00000000-0e01');
const LEVEL = unsafeBrandId<'ParameterId'>('9a1e0001-0001');
/** A chain of one processor, which the test's processing runs as a scaling. */
const CHAIN: EffectChain = {
  id: unsafeBrandId<'EffectChainId'>('00000000-c4a1'),
  slots: [
    {
      kind: 'processor',
      id: PROCESSOR,
      typeKey: 'scaling',
      enabled: true,
      soloed: false,
      mix: 1,
      version: { implementation: 1, parameters: 1 },
      values: new Map([[LEVEL, 2]]),
    },
  ],
};

/** Frames each a distinct value, exact in single precision, and exact when scaled by 2 or 3. */
const SAMPLES = [Float32Array.from({ length: LENGTH }, (_, frame) => ((frame % 1024) + 1) / 4096)];

const GRAPH = graphOf(
  [
    nodeOf('in', BuiltInNodeType.GraphInput, MONO, { outputs: ['out'] }),
    nodeOf('out', BuiltInNodeType.Output, MONO, { inputs: ['in'] }),
  ],
  [wire('in.out', 'out.in')],
);

/** The racked sound, described for the feeder, its file one a structured clone carries. */
function racked(): SourceDescription {
  return {
    node: named('in'),
    kind: PcmDescriptionKind.Edited,
    sampleRate: RATE,
    plan: rackedPlan(CHAIN, LENGTH, RATE),
    media: [rackedMedia(SAMPLES, RATE, 'memory:racked', (bytes) => new PlatformBlob([bytes]))],
  };
}

/** Every sample the rig's node played, in order. */
function heard(rig: PlaybackRig): number[] {
  return rig.node.rendered.flatMap((quantum) => [...(quantum.channels[0] ?? [])]);
}

/** A preview worker's core run in place, the rig's feeders connected to it. */
function previewWorker(rig: () => PlaybackRig, processing = scalingChain({ rendered: true })) {
  const reports: FromPreviewWorker[] = [];
  const core = new PreviewWorkerCore({
    post: (message) => {
      reports.push(message);
    },
    schedule: (callback, milliseconds) => rig().schedule.schedule(callback, milliseconds),
    processing: processing.processing,
    dsp: REFERENCE_DSP,
    bound: 64 * 2 ** 20,
    concurrency: 1,
    reportFault: (error) => {
      throw error;
    },
  });
  let connections = 0;
  const connect = () => {
    const { port1, port2 } = fakeChannel();
    connections += 1;
    const connection = connections;
    core.receive({
      kind: ToPreviewWorkerKind.Connect,
      connection,
      purpose: CachePurpose.Playback,
      port: port1,
    });
    return {
      port: port2,
      disconnect: () => {
        core.receive({ kind: ToPreviewWorkerKind.Disconnect, connection });
      },
    };
  };
  return { reports, connect, renders: processing };
}

describe('a racked sound played through the session', () => {
  it('plays a chain it cannot run as it plays from the preview worker’s render', async () => {
    const own = scalingChain({ rendered: true });
    // The worker schedules on the rig's clock only once the rig has started it.
    const worker = previewWorker(() => rig);
    const rig = new PlaybackRig({ processing: own.processing, connectPreviews: worker.connect });
    expectSuccess(
      await rig.session.load({ quality: MAXIMUM_QUALITY, graph: GRAPH, sources: [racked()] }),
    );
    expectSuccess(await rig.session.play());
    await rig.render(40);

    expect(rig.feeder.received.map((message) => message.kind)).toContain(ToFeederKind.Previews);
    expect(own.starts).toEqual([]);
    expect(worker.renders.starts).toEqual([0]);
    const played = heard(rig).filter((sample) => sample !== 0);
    expect(played.slice(0, QUANTUM)).toEqual(
      [...(SAMPLES[0]?.subarray(0, QUANTUM) ?? [])].map((sample) => 2 * sample),
    );
    const last = worker.reports.at(-1);
    expect(last?.kind).toBe(FromPreviewWorkerKind.Renders);
    expect(last?.begun).toBe(1);
    expect(last?.renders).toEqual([
      expect.objectContaining({ purposes: [CachePurpose.Playback], phase: RenderPhase.Made }),
    ]);

    rig.session.dispose();
    rig.schedule.advance(100);
    expect(worker.reports.at(-1)?.renders).toEqual([
      expect.objectContaining({ purposes: [], phase: RenderPhase.Made }),
    ]);
  });

  it('hears a parameter changed while it plays live, without playback starting again', async () => {
    const live = scalingChain({ factor: 2 });
    const rig = new PlaybackRig({ processing: live.processing });
    expectSuccess(
      await rig.session.load({ quality: MAXIMUM_QUALITY, graph: GRAPH, sources: [racked()] }),
    );
    expectSuccess(await rig.session.play());
    await rig.render(20);

    expectSuccess(
      await rig.session.changeParameters([{ processor: PROCESSOR, parameter: LEVEL, value: 3 }]),
    );
    // Well within the sound's 48,000 frames, so what is heard last is the
    // stream and not the silence after it.
    await rig.render(250);

    expect(live.starts).toEqual([0]);
    const played = heard(rig);
    const lastFrame = played.length - 1;
    const source = SAMPLES[0] ?? new Float32Array();
    const first = played.findIndex((sample) => sample !== 0);
    expect(lastFrame - first).toBeLessThan(LENGTH);
    // The feeder reads ahead of what is heard, so the change is heard once
    // what it had read is played: by the end, every frame is tripled.
    expect(played[first]).toBe(2 * (source[0] ?? 0));
    expect(played[lastFrame]).toBe(3 * (source[lastFrame - first] ?? 0));
    expect(played[lastFrame]).not.toBe(0);
  });

  it('refuses a change to a chain heard from a render, which was made with the old value', async () => {
    const rig = new PlaybackRig({ processing: scalingChain({ rendered: true }).processing });
    expectSuccess(
      await rig.session.load({ quality: MAXIMUM_QUALITY, graph: GRAPH, sources: [racked()] }),
    );
    expect(
      expectFailureCode(
        await rig.session.changeParameters([{ processor: PROCESSOR, parameter: LEVEL, value: 3 }]),
      ),
    ).toBe('playback.parameter-rendered');
  });
});
