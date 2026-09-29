import { describe, expect, it, vi } from 'vitest';

import { FailureKind, StandardLayouts, fail, failure, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  DspImplementation,
  PRESET_SETTINGS,
  PerformanceProfile,
  frameBlock,
} from '@audiogubbins/audio-engine';

import { RenderStage, createAudioViewStore } from '../state/audio-view-store.js';
import { FakeRendering, FakeSession } from '../testing/audio-fakes.js';
import { everythingQueued } from '../testing/waiting.js';
import { fingerprintSink } from './fingerprint-sink.js';
import { RenderControl } from './render-control.js';

/** A control over a fake host, with a clock that moves 250 ms per reading. */
function rig() {
  const view = createAudioViewStore();
  const host = new FakeRendering();
  const announce = vi.fn<(text: string) => void>();
  let now = 1_000;
  const control = new RenderControl({
    view,
    open: host.open,
    now: () => {
      now += 250;
      return now;
    },
    announce,
  });
  return { view, host, announce, control };
}

const CHUNKS: readonly (readonly Float32Array[])[] = [
  [Float32Array.of(0.25, -0.25, 0.5), Float32Array.of(0.125, 0, -1)],
  [Float32Array.of(0.75, 1), Float32Array.of(-0.5, 0.0625)],
];

/** The fingerprint of `CHUNKS` written to a sink directly, as a render's result must match. */
async function fingerprintOfChunks(): Promise<bigint> {
  const sink = fingerprintSink();
  const rate = expectSuccess(sampleRate(48_000));
  for (const channels of CHUNKS) {
    await sink.write(expectSuccess(frameBlock(StandardLayouts.stereo, rate, channels)));
  }
  return sink.fingerprint();
}

describe('rendering the test signal offline', () => {
  it('makes nothing until a render is asked for', () => {
    expect(rig().host.opens).toBe(0);
  });

  it('shows the render running at once, before any worker has answered', () => {
    const { control, view } = rig();

    expect(control.render()).toBeUndefined();

    expect(view.get().render).toEqual({
      stage: RenderStage.Running,
      framesRendered: 0,
      framesTotal: 480_000,
    });
  });

  it('asks in chunks of the chosen profile’s length', async () => {
    const { control, view, host } = rig();
    view.chooseProfile(PerformanceProfile.LowLatency);

    control.render();
    await everythingQueued();

    const chunk = PRESET_SETTINGS[PerformanceProfile.LowLatency].renderChunkMilliseconds;
    expect(host.requests[0]?.chunkFrames).toBe((chunk * 48_000) / 1000);
  });

  it('shows what the render produced: its frames, time, DSP path and the fingerprint of what was written', async () => {
    const { control, view, host, announce } = rig();
    host.chunks = CHUNKS;

    control.render();
    await everythingQueued();

    expect(view.get().render).toEqual({
      stage: RenderStage.Finished,
      result: {
        frames: 480_000,
        sampleRate: 48_000,
        milliseconds: 250,
        dsp: DspImplementation.Reference,
        fallbackReason: 'This page cannot compile WebAssembly.',
        fingerprint: await fingerprintOfChunks(),
      },
    });
    expect(announce).toHaveBeenCalledWith('The test signal rendered in 0.3 seconds.');
  });

  it('follows the render’s progress as the worker reports it', async () => {
    const { control, view, host } = rig();
    host.chunks = CHUNKS;
    const seen: number[] = [];
    view.subscribe(() => {
      const { render } = view.get();
      if (render.stage === RenderStage.Running) seen.push(render.framesRendered);
    });

    control.render();
    await everythingQueued();

    expect(seen).toEqual([0, 3, 5]);
  });

  it('shows and says every reason a render failed', async () => {
    const { control, view, host, announce } = rig();
    host.refusal = fail(
      failure('render.worker-failed', FailureKind.Unrecoverable, 'The render worker stopped.'),
    );

    control.render();
    await everythingQueued();

    expect(view.get().render).toEqual({
      stage: RenderStage.Failed,
      reasons: ['The render worker stopped.'],
    });
    expect(announce).toHaveBeenCalledWith('The render worker stopped.');
  });

  it('makes the host once, and keeps its scheduler to the profile and to playback', async () => {
    const { control, view, host } = rig();
    control.render();
    await everythingQueued();
    control.render();
    await everythingQueued();
    expect(host.opens).toBe(1);

    const session = new FakeSession();
    view.showPlayback(session.status);
    expect(host.interactive.at(-1)).toBe(false);
    expectSuccess(session.startPlaying());
    view.showPlayback(session.status);
    expect(host.interactive.at(-1)).toBe(true);

    view.chooseProfile(PerformanceProfile.MaximumStability);
    expect(host.backgroundLimits.at(-1)).toBe(
      PRESET_SETTINGS[PerformanceProfile.MaximumStability].backgroundConcurrencyWhileInteractive,
    );
  });
});
