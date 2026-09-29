import { describe, expect, it, vi } from 'vitest';

import { FailureKind, StandardLayouts, fail, failure, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { createDiagnosticCentre, createLogStore, LogSeverity } from '@audiogubbins/diagnostics';
import {
  DspImplementation,
  JobPriority,
  PRESET_SETTINGS,
  PerformanceProfile,
  ProcessingMode,
  SchedulingPolicy,
  frameBlock,
} from '@audiogubbins/audio-engine';

import { createAudioSettingsStore } from '../state/audio-settings-store.js';
import { RenderStage, createAudioViewStore } from '../state/audio-view-store.js';
import { PlanningStage, createRenderStrategyStore } from '../state/render-strategy-store.js';
import { createStateStorage } from '../state/state-storage.js';
import { FakeRendering, FakeSession } from '../testing/audio-fakes.js';
import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { everythingQueued } from '../testing/waiting.js';
import { fingerprintSink } from './fingerprint-sink.js';
import { RenderControl, RenderDecision } from './render-control.js';

/**
 * A control over a fake host, with a clock that moves `step` ms per reading
 * (250 unless a test says otherwise), on a machine that reports `memory`.
 */
function rig(options: { readonly step?: number; readonly memory?: number } = {}) {
  const view = createAudioViewStore();
  const logs = createLogStore();
  const logger = createDiagnosticCentre(logs, { now: () => 0 }).loggerFor('audio');
  const settings = createAudioSettingsStore(
    createStateStorage(ephemeralStorage(), logger, () => undefined),
    logger,
  );
  const strategy = createRenderStrategyStore();
  const host = new FakeRendering();
  const announce = vi.fn<(text: string) => void>();
  let now = 1_000;
  const control = new RenderControl({
    view,
    settings,
    strategy,
    open: host.open,
    resources: () => ({ availableMemoryBytes: options.memory }),
    now: () => {
      now += options.step ?? 250;
      return now;
    },
    announce,
    logger,
  });
  return { view, settings, strategy, host, announce, control, logs };
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

    expect(control.render().kind).toBe('started');

    expect(view.get().render).toEqual({ stage: RenderStage.Running, framesTotal: 480_000 });
    expect(control.framesRendered()).toBe(0);
  });

  it('asks in chunks of the chosen profile’s length', async () => {
    const { control, settings, host } = rig();
    settings.chooseProfile(PerformanceProfile.LowLatency);

    control.render();
    await everythingQueued();

    const chunk = PRESET_SETTINGS[PerformanceProfile.LowLatency].renderChunkMilliseconds;
    expect(host.requests[0]?.chunkFrames).toBe((chunk * 48_000) / 1000);
  });

  it('asks in chunks of the Custom profile’s length, and starts its scheduler from it', async () => {
    const { control, settings, host } = rig();
    const custom = {
      ...PRESET_SETTINGS[PerformanceProfile.Balanced],
      renderChunkMilliseconds: 125,
    };
    expect(settings.setCustom(custom)).toBeUndefined();
    settings.chooseProfile(PerformanceProfile.Custom);

    control.render();
    await everythingQueued();

    expect(host.requests[0]?.chunkFrames).toBe(6_000);
    expect(host.openedWith).toEqual([custom]);
  });

  it('plans smaller chunks where the memory left holds no more, and still renders it all', async () => {
    // 8 kB holds 1 000 frames of stereo float, far less than Balanced's 500 ms.
    const { control, host, view, strategy } = rig({ memory: 8_000 });
    host.chunks = CHUNKS;

    expect(control.render().kind).toBe('started');
    await everythingQueued();

    expect(host.requests[0]?.chunkFrames).toBe(1_000);
    expect(view.get().render.stage).toBe(RenderStage.Finished);
    const { planning } = strategy.get();
    expect(planning.stage === PlanningStage.Decided && planning.strategy.plan.warnings).toEqual([
      expect.objectContaining({ resource: 'memory', available: 8_000 }),
    ]);
  });

  it('gives the conversions’ tables the memory measured beside a chunk, and no bound unmeasured', async () => {
    const measured = rig({ memory: 1e6 });
    const unmeasured = rig();

    measured.control.render();
    unmeasured.control.render();
    await everythingQueued();

    const chunkFrames = measured.host.requests[0]?.chunkFrames ?? 0;
    expect(chunkFrames).toBeGreaterThan(0);
    expect(measured.host.requests[0]?.coefficientBudgetBytes).toBe(1e6 - chunkFrames * 2 * 4);
    expect(unmeasured.host.requests[0]).not.toHaveProperty('coefficientBudgetBytes');
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
    expect(announce).toHaveBeenCalledWith('The test signal rendered in 0.3 s.');
  });

  it('keeps the render’s progress as the worker reports it, and publishes no view for it', async () => {
    const { control, view, host } = rig();
    host.chunks = CHUNKS;
    const seen: number[] = [];
    let views = 0;
    view.subscribe(() => {
      views += 1;
    });
    const read = host.onChunk;
    host.onChunk = () => {
      seen.push(control.framesRendered());
      read?.();
    };

    control.render();
    await everythingQueued();

    expect(seen.at(-1)).toBe(5);
    // Once when the render starts and once when it finishes: never per chunk.
    expect(views).toBe(2);
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

  it('reports a fault that is not an error, rather than leaving it unobserved', async () => {
    const { control, view, host, announce, logs } = rig();
    host.thrown = 'a string, not an Error';

    control.render();
    await everythingQueued();

    expect(view.get().render).toEqual({
      stage: RenderStage.Failed,
      reasons: ['The render stopped unexpectedly. The diagnostic log has the details.'],
    });
    expect(announce).toHaveBeenCalledWith(
      'The render stopped unexpectedly. The diagnostic log has the details.',
    );
    expect(logs.snapshot().some((record) => record.severity === LogSeverity.Error)).toBe(true);
  });
});

describe('the processing mode and priority of a render', () => {
  it('renders in the foreground, as final offline rendering, while nothing argues otherwise', async () => {
    const { control, host, strategy } = rig();

    const start = control.render();
    await everythingQueued();

    expect(start.kind === 'started' && start.strategy.choice.mode).toBe(
      ProcessingMode.FinalOffline,
    );
    expect(host.runs[0]?.priority).toBe(JobPriority.Foreground);
    expect(strategy.get().planning.stage).toBe(PlanningStage.Decided);
  });

  it('queues as background work when background rendering is set', async () => {
    const { control, host, settings } = rig();
    expect(settings.chooseRenderMode(ProcessingMode.BackgroundOffline)).toBeUndefined();

    control.render();
    await everythingQueued();

    expect(host.runs[0]?.priority).toBe(JobPriority.Background);
  });

  it('measures each render, and moves the next into the background by itself where it ran slower than real time', async () => {
    // Twenty seconds for ten of audio: twice real time.
    const { control, host, strategy } = rig({ step: 20_000 });
    control.render();
    await everythingQueued();
    expect(strategy.get().measuredCostRatio).toBe(2);

    const start = control.render();
    await everythingQueued();

    expect(start.kind === 'started' && start.strategy.choice.mode).toBe(
      ProcessingMode.BackgroundOffline,
    );
    expect(host.runs.map((run) => run.priority)).toEqual([
      JobPriority.Foreground,
      JobPriority.Background,
    ]);
  });

  it('waits for a decision where the foreground was chosen over the processor’s warning, and starts nothing', async () => {
    const { control, host, view, strategy, settings } = rig({ step: 20_000 });
    control.render();
    await everythingQueued();
    settings.chooseRenderMode(ProcessingMode.FinalOffline);

    const start = control.render();
    await everythingQueued();

    expect(start.kind).toBe('awaiting-decision');
    expect(start.kind === 'awaiting-decision' && start.told).toContain(
      'The processor is the limiting resource.',
    );
    expect(host.requests).toHaveLength(1);
    expect(view.get().render.stage).toBe(RenderStage.Finished);
    expect(strategy.get().planning.stage).toBe(PlanningStage.AwaitingDecision);
  });

  it.each([
    [RenderDecision.Safer, JobPriority.Background, ProcessingMode.BackgroundOffline],
    [RenderDecision.AsChosen, JobPriority.Foreground, ProcessingMode.FinalOffline],
  ])('renders as decided: %s', async (decision, priority, mode) => {
    const { control, host, settings, strategy } = rig({ step: 20_000 });
    control.render();
    await everythingQueued();
    settings.chooseRenderMode(ProcessingMode.FinalOffline);
    control.render();

    const start = control.proceed(decision);
    await everythingQueued();

    expect(start.kind).toBe('started');
    expect(host.runs[1]?.priority).toBe(priority);
    const { planning } = strategy.get();
    expect(planning.stage === PlanningStage.Decided && planning.strategy.choice.mode).toBe(mode);
    expect(control.proceed(decision)).toEqual({
      kind: 'refused',
      reasons: ['No render is waiting for a decision.'],
    });
  });

  it('refuses a decision when no render waits for one', () => {
    expect(rig().control.proceed(RenderDecision.Safer).kind).toBe('refused');
  });
});

describe('the scheduler the renders queue on', () => {
  it('is made once, and kept to the settings and to playback', async () => {
    const { control, view, settings, host } = rig();
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

    settings.chooseProfile(PerformanceProfile.MaximumStability);
    expect(host.backgroundLimits.at(-1)).toBe(
      PRESET_SETTINGS[PerformanceProfile.MaximumStability].backgroundConcurrencyWhileInteractive,
    );
  });

  it('takes the priority policy the person chose, from the start and on every change', async () => {
    const { control, settings, host } = rig();
    settings.choosePriorityPolicy(SchedulingPolicy.Throughput);

    control.render();
    await everythingQueued();
    expect(host.policies.at(-1)).toBe(SchedulingPolicy.Throughput);

    settings.choosePriorityPolicy(SchedulingPolicy.InteractiveFirst);
    expect(host.policies.at(-1)).toBe(SchedulingPolicy.InteractiveFirst);
  });

  it('takes a Custom profile’s share for background work', async () => {
    const { control, settings, host } = rig();
    control.render();
    await everythingQueued();

    settings.setCustom({
      ...PRESET_SETTINGS[PerformanceProfile.Balanced],
      backgroundConcurrencyWhileInteractive: 5,
    });
    settings.chooseProfile(PerformanceProfile.Custom);

    expect(host.backgroundLimits.at(-1)).toBe(5);
  });
});
