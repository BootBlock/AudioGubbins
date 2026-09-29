import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createCapabilityRegistry, type CapabilityEnvironment } from '@audiogubbins/capabilities';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { nodeId, type NodeId } from '@audiogubbins/audio-graph';
import { sampleCount, sampleRate } from '@audiogubbins/domain';
import {
  DspImplementation,
  PRESET_SETTINGS,
  PerformanceProfile,
  ProcessingMode,
  assessRender,
} from '@audiogubbins/audio-engine';
import {
  GpuUseKind,
  LifecycleState,
  PlaybackPhase,
  type MeterLevels,
  type PlaybackStatus,
} from '@audiogubbins/audio-runtime';

import {
  createAudioSettingsStore,
  type AudioSettingsStore,
} from '../state/audio-settings-store.js';
import { createAudioViewStore, type AudioViewStore } from '../state/audio-view-store.js';
import {
  createRenderStrategyStore,
  type RenderStrategyStore,
} from '../state/render-strategy-store.js';
import { createStateStorage } from '../state/state-storage.js';
import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { FAKE_DEVICE, FakeSession, UNLOADED } from '../testing/audio-fakes.js';
import { CAPABLE } from '../testing/shell-context.js';
import { TransportPanel } from './transport-panel.js';

const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('audio');

/** Audio settings as they start, kept nowhere. */
function audioSettings(): AudioSettingsStore {
  return createAudioSettingsStore(
    createStateStorage(ephemeralStorage(), logger, () => undefined),
    logger,
  );
}

/** The panel over `audio`, in a browser `environment` describes. */
function draw(
  audio: AudioViewStore = createAudioViewStore(),
  options: {
    readonly environment?: CapabilityEnvironment;
    readonly playhead?: () => number | undefined;
    readonly meters?: () => ReadonlyMap<NodeId, MeterLevels>;
    readonly framesRendered?: () => number;
    readonly unavailable?: Readonly<Record<string, string>>;
    readonly settings?: AudioSettingsStore;
    readonly strategy?: RenderStrategyStore;
  } = {},
) {
  const run = vi.fn<(id: string) => void>();
  const capabilities = createCapabilityRegistry(
    options.environment ?? CAPABLE,
    createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('capabilities'),
  );
  render(
    <TransportPanel
      title="Transport"
      audio={audio}
      audioSettings={options.settings ?? audioSettings()}
      renderStrategy={options.strategy ?? createRenderStrategyStore()}
      capabilities={capabilities}
      playhead={options.playhead ?? (() => undefined)}
      meters={options.meters ?? (() => NO_METERS)}
      framesRendered={options.framesRendered ?? (() => 0)}
      run={run}
      unavailableReason={(id) => options.unavailable?.[id]}
    />,
  );
  return { run };
}

/** The text a description list gives for `term`. */
function reading(term: string): string {
  const title = screen.getByText(term, { selector: 'dt' });
  return title.nextElementSibling?.textContent ?? '';
}

const NO_METERS: ReadonlyMap<NodeId, MeterLevels> = new Map();

/** The test signal's meter, stereo, one channel clipped, with the pair's correlation. */
const METER = expectSuccess(nodeId('meter'));
const LEVELS: ReadonlyMap<NodeId, MeterLevels> = new Map([
  [METER, { peak: [0.25, 1.5], rms: [0.17, 0.5], correlation: [0.98] }],
]);

/** A graph loaded and playing: its tone made on the feeder's module, its graph calling none. */
function playingStatus(): PlaybackStatus {
  const session = new FakeSession();
  expectSuccess(session.startPlaying());
  return {
    ...UNLOADED,
    phase: PlaybackPhase.Ready,
    transport: session.status.transport,
    contextState: LifecycleState.Running,
    processorDsp: {
      implementation: DspImplementation.WebAssembly,
      fallbackReason: undefined,
      inUse: false,
    },
    feederDsp: {
      implementation: DspImplementation.WebAssembly,
      fallbackReason: undefined,
      inUse: true,
    },
    latencyFrames: 128,
    gpu: { kind: GpuUseKind.Unused },
    device: FAKE_DEVICE,
    stability: {
      stable: true,
      underrunsInWindow: 0,
      explanation: 'No underruns in the last 10 seconds.',
    },
  };
}

describe('the Transport panel before anything plays', () => {
  it('says the context starts with Play, and has no levels yet', () => {
    draw();

    expect(screen.getByRole('heading', { level: 2, name: 'Transport' })).toBeInTheDocument();
    expect(reading('Audio context')).toBe('Not started; it starts when you press Play');
    expect(screen.getByText('No levels until something plays.')).toBeInTheDocument();
    expect(screen.getByRole('timer', { name: 'Position' })).toHaveTextContent('0:00.000');
    // Not a landmark of its own: the dock's tab names the panel.
    expect(screen.queryAllByRole('region')).toEqual([]);
  });

  it('runs each transport command from its button', async () => {
    const { run } = draw();

    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    await userEvent.click(screen.getByRole('button', { name: 'Render the test signal offline' }));

    expect(run.mock.calls).toEqual([
      ['transport.play-test-signal'],
      ['transport.render-test-signal'],
    ]);
  });

  it('greys a button whose command cannot run, with the command’s own reason', () => {
    draw(undefined, { unavailable: { 'transport.pause': 'Nothing is playing.' } });

    const pause = screen.getByRole('button', { name: 'Pause' });
    expect(pause).toBeDisabled();
    expect(pause).toHaveAttribute('title', 'Nothing is playing.');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled();
  });

  it('shows the profile chosen, Custom among them', () => {
    const settings = audioSettings();
    settings.chooseProfile(PerformanceProfile.MaximumStability);
    draw(undefined, { settings });

    const choice = screen.getByRole('combobox', { name: 'Performance profile' });
    expect(choice).toHaveTextContent('Maximum stability');
    act(() => {
      settings.chooseProfile(PerformanceProfile.Custom);
    });
    expect(choice).toHaveTextContent('Custom');
  });
});

/** A ten-second render chosen in the foreground over a warning that the last one ran too slowly. */
function contestedRender() {
  const assessment = expectSuccess(
    assessRender({
      frames: expectSuccess(sampleCount(480_000)),
      channels: 2,
      sampleRate: expectSuccess(sampleRate(48_000)),
      settings: PRESET_SETTINGS[PerformanceProfile.Balanced],
      measuredCostRatio: 2,
      override: ProcessingMode.FinalOffline,
    }),
  );
  const { safer } = assessment;
  if (safer === undefined) throw new Error('The assessment offered no safer strategy.');
  return { ...assessment, safer };
}

describe('the Transport panel’s processing modes', () => {
  it('shows playback as real-time processing, and says why no cached preview is used', () => {
    draw();

    expect(reading('Playback')).toMatch(/^Real-time processing/);
    expect(reading('Playback')).toContain(
      'a cached preview is not available: nothing in AudioGubbins renders a preview ahead of playback yet',
    );
  });

  it('shows the mode the next render takes before any render, with its reason', () => {
    draw();

    expect(reading('Offline render')).toBe(
      'Final offline rendering' +
        'Rendering offline at full quality, so the file is identical on every machine.',
    );
    expect(screen.getByRole('combobox', { name: 'Render mode' })).toHaveTextContent('Automatic');
  });

  it('shows the mode a render was planned with, and where it queued', () => {
    const strategy = createRenderStrategyStore();
    strategy.decide(contestedRender().safer);
    draw(undefined, { strategy });

    expect(reading('Offline render')).toMatch(/^Background rendering/);
    expect(reading('Offline render')).toContain(
      'Queued behind playback, editing and work you are waiting on.',
    );
  });

  it('shows what the render was warned of, naming the resource, and runs the decision it asks for', async () => {
    const strategy = createRenderStrategyStore();
    strategy.awaitDecision(contestedRender());
    const { run } = draw(undefined, { strategy });

    const warnings = screen.getByRole('list', { name: 'What the render was warned of' });
    expect(within(warnings).getByText('Processor.')).toBeInTheDocument();
    expect(warnings).toHaveTextContent('The processor is the limiting resource.');

    const decision = screen.getByRole('group', { name: 'How to render' });
    await userEvent.click(
      within(decision).getByRole('button', { name: 'Render in the background' }),
    );
    await userEvent.click(within(decision).getByRole('button', { name: 'Render as chosen' }));

    expect(run.mock.calls).toEqual([['transport.render-safer'], ['transport.render-as-chosen']]);
  });

  it('offers no decision, and no warnings, while nothing warns', () => {
    draw();

    expect(screen.queryByRole('group', { name: 'How to render' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'What the render was warned of' })).toBeNull();
  });
});

describe('the Transport panel while the test signal plays', () => {
  it('shows the context, the transport, each thread’s DSP path, the device rate and each latency in milliseconds and frames', () => {
    const audio = createAudioViewStore();
    audio.showPlayback(playingStatus());
    draw(audio);

    expect(reading('Audio context')).toBe('Running');
    expect(reading('Transport')).toBe('Playing');
    // The truth of each thread: the tone is made on the module, and no node of the graph calls it.
    expect(reading('Sources in the feeder thread')).toBe('WebAssembly module');
    expect(reading('Graph on the audio thread')).toBe(
      'WebAssembly moduleLoaded; no node of this graph calls it.',
    );
    expect(reading('GPU')).toBe('Available; no processor in this graph uses it.');
    expect(reading('Device rate')).toBe('48000 Hz');
    expect(reading('Base latency')).toBe('10.0 ms (480 frames)');
    expect(reading('Output latency')).toBe('20.0 ms (960 frames)');
    expect(reading('Graph latency')).toBe('2.7 ms (128 frames)');
    expect(reading('Underruns')).toBe('0. No underruns in the last 10 seconds.');
  });

  it('says there are no levels while a loaded graph has reported none', () => {
    const audio = createAudioViewStore();
    audio.showPlayback(playingStatus());
    draw(audio);

    expect(screen.getByText('No levels until something plays.')).toBeInTheDocument();
    expect(screen.queryAllByRole('meter')).toEqual([]);
  });

  it('meters each channel’s peak, in decibels, and holds a clipped one at the top of the scale', () => {
    const audio = createAudioViewStore();
    audio.showPlayback(playingStatus());
    draw(audio, { meters: () => LEVELS });

    const levels = screen.getByRole('group', { name: 'Levels at meter' });
    const left = within(levels).getByRole('meter', { name: 'Left peak' });
    const right = within(levels).getByRole('meter', { name: 'Right peak' });
    expect(left).toHaveAttribute('aria-valuetext', '−12.0 dB');
    expect(right).toHaveAttribute('aria-valuenow', '1');
    expect(right).toHaveAttribute('aria-valuetext', '3.5 dB');
  });

  it('shows the stereo pair’s correlation, signed, on a scale from −1 to 1', () => {
    const audio = createAudioViewStore();
    audio.showPlayback(playingStatus());
    const reported = new Map([[METER, { peak: [0.5, 0.5], rms: [0.3, 0.3], correlation: [-0.5] }]]);
    draw(audio, { meters: () => reported });

    const levels = screen.getByRole('group', { name: 'Levels at meter' });
    const correlation = within(levels).getByRole('meter', { name: 'Left and right correlation' });
    expect(correlation).toHaveAttribute('aria-valuemin', '-1');
    expect(correlation).toHaveAttribute('aria-valuemax', '1');
    expect(correlation).toHaveAttribute('aria-valuenow', '-0.5');
    expect(correlation).toHaveAttribute('aria-valuetext', '−0.50');
  });

  it('shows no correlation for a meter that names no pair', () => {
    const audio = createAudioViewStore();
    audio.showPlayback(playingStatus());
    const levels = new Map([[METER, { peak: [0.5, 0.5], rms: [0.3, 0.3], correlation: [] }]]);
    draw(audio, { meters: () => levels });

    expect(screen.queryByRole('meter', { name: /correlation/u })).not.toBeInTheDocument();
    expect(screen.getAllByRole('meter')).toHaveLength(2);
  });

  it('moves the meters once a display frame, reading the latest report, and redraws nothing for them otherwise', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      const audio = createAudioViewStore();
      audio.showPlayback(playingStatus());
      let levels = LEVELS;
      draw(audio, { meters: () => levels });
      const left = () => screen.getByRole('meter', { name: 'Left peak' });
      expect(left()).toHaveAttribute('aria-valuetext', '−12.0 dB');

      levels = new Map([[METER, { peak: [0.5, 0.5], rms: [0.3, 0.3], correlation: [1] }]]);
      expect(left()).toHaveAttribute('aria-valuetext', '−12.0 dB');
      act(() => {
        vi.advanceTimersToNextFrame();
      });
      expect(left()).toHaveAttribute('aria-valuetext', '−6.0 dB');
      expect(screen.getByRole('meter', { name: 'Left and right correlation' })).toHaveAttribute(
        'aria-valuetext',
        '+1.00',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('moves the position with the playhead, as minutes, seconds and milliseconds', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      const audio = createAudioViewStore();
      audio.showPlayback(playingStatus());
      let frame = 4_800;
      draw(audio, { playhead: () => frame });

      expect(screen.getByRole('timer', { name: 'Position' })).toHaveTextContent('0:00.100');

      frame = 3_120_000;
      // A display frame, as the browser draws one.
      act(() => {
        vi.advanceTimersToNextFrame();
      });
      expect(screen.getByRole('timer', { name: 'Position' })).toHaveTextContent('1:05.000');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the Transport panel where the engine is degraded', () => {
  it('names the reference path and why it runs, and what the browser does not report', () => {
    const audio = createAudioViewStore();
    const status = playingStatus();
    const reference = {
      implementation: DspImplementation.Reference,
      fallbackReason: 'This page cannot compile WebAssembly.',
    };
    audio.showPlayback({
      ...status,
      processorDsp: { ...reference, inUse: true },
      feederDsp: { ...reference, inUse: true },
      latencyFrames: undefined,
      device: { ...FAKE_DEVICE, outputLatencySeconds: undefined },
    });
    draw(audio);

    for (const term of ['Graph on the audio thread', 'Sources in the feeder thread']) {
      expect(reading(term)).toBe('Reference pathThis page cannot compile WebAssembly.');
    }
    for (const note of screen.getAllByText('This page cannot compile WebAssembly.')) {
      expect(note).toHaveAttribute('data-ag-status', 'reduced');
    }
    expect(reading('Output latency')).toContain('Not reported by this browser');
    expect(reading('Graph latency')).toBe('Not known: a node on the way cannot say its own');
  });

  it('explains the underruns and recommends a steadier profile', () => {
    const audio = createAudioViewStore();
    audio.showPlayback({
      ...playingStatus(),
      stability: {
        stable: false,
        underrunsInWindow: 3,
        recommendation: PerformanceProfile.MaximumStability,
        explanation: 'The audio ran out 3 times.',
      },
    });
    draw(audio);

    expect(reading('Underruns')).toBe(
      '3. The audio ran out 3 times.Recommended profile: Maximum stability.',
    );
  });

  it('lists each audio feature this browser reduces or cannot run, with its reason', () => {
    draw(undefined, {
      environment: { ...CAPABLE, hasAudioWorklet: false, compilesWebAssembly: false },
    });

    const items = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(items.some((text) => text.startsWith('Playback and live effectsUnavailable'))).toBe(
      true,
    );
    expect(items.some((text) => text.startsWith('Fast canonical processingReduced'))).toBe(true);
    expect(items.some((text) => text.includes('Rendering in the background'))).toBe(false);
  });

  it('shows why the last Play did not start, and what the session reports', () => {
    const audio = createAudioViewStore();
    audio.showPlayback({ ...playingStatus(), problems: ['The audio output stopped.'] });
    audio.playbackSettled(['Press Play again.']);
    draw(audio);

    expect(screen.getByText('Press Play again.')).toHaveAttribute('data-ag-status', 'unavailable');
    expect(screen.getByText('The audio output stopped.')).toBeInTheDocument();
  });
});

describe('the Transport panel’s offline render', () => {
  it('shows a render’s progress, and says it in tenths', () => {
    const audio = createAudioViewStore();
    audio.renderStarted(480_000);
    draw(audio, { framesRendered: () => 200_000 });

    const progress = screen.getByRole('progressbar', { name: 'Render progress' });
    expect(progress).toHaveAttribute('value', '200000');
    expect(progress).toHaveAttribute('max', '480000');
    expect(screen.getByRole('status')).toHaveTextContent('Rendering: 40%');
  });

  it('moves a render’s progress once a display frame, however often chunks are reported', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      const audio = createAudioViewStore();
      audio.renderStarted(480_000);
      let rendered = 0;
      draw(audio, { framesRendered: () => rendered });
      const progress = () => screen.getByRole('progressbar', { name: 'Render progress' });

      // Several chunks reported between two frames redraw nothing until the frame.
      rendered = 24_000;
      rendered = 240_000;
      expect(progress()).toHaveAttribute('value', '0');
      act(() => {
        vi.advanceTimersToNextFrame();
      });
      expect(progress()).toHaveAttribute('value', '240000');
      expect(screen.getByRole('status')).toHaveTextContent('Rendering: 50%');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows what a finished render produced, its fingerprint in hexadecimal', () => {
    const audio = createAudioViewStore();
    audio.renderFinished({
      frames: 480_000,
      sampleRate: 48_000,
      milliseconds: 812,
      dsp: DspImplementation.WebAssembly,
      fallbackReason: undefined,
      fingerprint: 0x00ab_cdef_0123_4567n,
    });
    draw(audio);

    expect(reading('Frames')).toBe('480,000 at 48,000 Hz');
    expect(reading('Time taken')).toBe('0.8 s');
    expect(reading('Fingerprint')).toBe('0x00abcdef01234567');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows every reason a render failed', () => {
    const audio = createAudioViewStore();
    audio.renderFailed(['The render worker stopped.', 'Try again.']);
    draw(audio);

    for (const text of ['The render worker stopped.', 'Try again.']) {
      expect(screen.getByText(text)).toHaveAttribute('data-ag-status', 'unavailable');
    }
  });
});

describe('the Transport panel’s word on the GPU', () => {
  it.each([
    [{ kind: GpuUseKind.Unavailable }, 'Not available: this browser offers no GPU through WebGPU.'],
    [{ kind: GpuUseKind.Unused }, 'Available; no processor in this graph uses it.'],
    [{ kind: GpuUseKind.Used, nodes: [expectSuccess(nodeId('reverb'))] }, 'Used by reverb.'],
  ] as const)('says what the engine chose: %o', (gpu, said) => {
    const audio = createAudioViewStore();
    audio.showPlayback({ ...playingStatus(), gpu });
    draw(audio);

    expect(reading('GPU')).toBe(said);
  });

  it('says nothing of the GPU before a graph is loaded', () => {
    const audio = createAudioViewStore();
    audio.showPlayback({ ...playingStatus(), gpu: undefined });
    draw(audio);

    expect(screen.queryByText('GPU')).toBeNull();
  });
});
