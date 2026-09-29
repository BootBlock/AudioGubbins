import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createCapabilityRegistry, type CapabilityEnvironment } from '@audiogubbins/capabilities';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { nodeId } from '@audiogubbins/audio-graph';
import { DspImplementation, PerformanceProfile } from '@audiogubbins/audio-engine';
import { LifecycleState, PlaybackPhase, type PlaybackStatus } from '@audiogubbins/audio-runtime';

import { createAudioViewStore, type AudioViewStore } from '../state/audio-view-store.js';
import { FAKE_DEVICE, FakeSession, UNLOADED } from '../testing/audio-fakes.js';
import { CAPABLE } from '../testing/shell-context.js';
import { TransportPanel } from './transport-panel.js';

/** The panel over `audio`, in a browser `environment` describes. */
function draw(
  audio: AudioViewStore = createAudioViewStore(),
  options: {
    readonly environment?: CapabilityEnvironment;
    readonly playhead?: () => number | undefined;
    readonly unavailable?: Readonly<Record<string, string>>;
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
      capabilities={capabilities}
      playhead={options.playhead ?? (() => undefined)}
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

/** A graph loaded and playing on the WebAssembly module, through the fake device. */
function playingStatus(): PlaybackStatus {
  const session = new FakeSession();
  session.move({ kind: 'play', contextFrame: 0 });
  return {
    ...UNLOADED,
    phase: PlaybackPhase.Ready,
    transport: session.status.transport,
    contextState: LifecycleState.Running,
    dsp: { implementation: DspImplementation.WebAssembly, fallbackReason: undefined },
    latencyFrames: 128,
    device: FAKE_DEVICE,
    stability: {
      stable: true,
      underrunsInWindow: 0,
      explanation: 'No underruns in the last 10 seconds.',
    },
    meters: new Map([[expectSuccess(nodeId('meter')), { peak: [0.25, 1.5], rms: [0.17, 0.5] }]]),
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

  it('shows the profile chosen', () => {
    const audio = createAudioViewStore();
    audio.chooseProfile(PerformanceProfile.MaximumStability);
    draw(audio);

    expect(screen.getByRole('combobox', { name: 'Performance profile' })).toHaveTextContent(
      'Maximum stability',
    );
  });
});

describe('the Transport panel while the test signal plays', () => {
  it('shows the context, the transport, the DSP path, the device rate and each latency in milliseconds and frames', () => {
    const audio = createAudioViewStore();
    audio.showPlayback(playingStatus());
    draw(audio);

    expect(reading('Audio context')).toBe('Running');
    expect(reading('Transport')).toBe('Playing');
    expect(reading('Processing')).toBe('WebAssembly module');
    expect(reading('Device rate')).toBe('48000 Hz');
    expect(reading('Base latency')).toBe('10.0 ms (480 frames)');
    expect(reading('Output latency')).toBe('20.0 ms (960 frames)');
    expect(reading('Graph latency')).toBe('2.7 ms (128 frames)');
    expect(reading('Underruns')).toBe('0. No underruns in the last 10 seconds.');
  });

  it('says there are no levels while a loaded graph has reported none', () => {
    const audio = createAudioViewStore();
    audio.showPlayback({ ...playingStatus(), meters: new Map() });
    draw(audio);

    expect(screen.getByText('No levels until something plays.')).toBeInTheDocument();
    expect(screen.queryAllByRole('meter')).toEqual([]);
  });

  it('meters each channel’s peak, in decibels, and holds a clipped one at the top of the scale', () => {
    const audio = createAudioViewStore();
    audio.showPlayback(playingStatus());
    draw(audio);

    const levels = screen.getByRole('group', { name: 'Levels at meter' });
    const left = within(levels).getByRole('meter', { name: 'Left peak' });
    const right = within(levels).getByRole('meter', { name: 'Right peak' });
    expect(left).toHaveAttribute('aria-valuetext', '−12.0 dB');
    expect(right).toHaveAttribute('aria-valuenow', '1');
    expect(right).toHaveAttribute('aria-valuetext', '3.5 dB');
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
    audio.showPlayback({
      ...status,
      dsp: {
        implementation: DspImplementation.Reference,
        fallbackReason: 'This page cannot compile WebAssembly.',
      },
      latencyFrames: undefined,
      device: { ...FAKE_DEVICE, outputLatencySeconds: undefined },
    });
    draw(audio);

    expect(reading('Processing')).toBe('Reference pathThis page cannot compile WebAssembly.');
    expect(screen.getByText('This page cannot compile WebAssembly.')).toHaveAttribute(
      'data-ag-status',
      'reduced',
    );
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
    audio.renderProgressed(200_000, 480_000);
    draw(audio);

    const progress = screen.getByRole('progressbar', { name: 'Render progress' });
    expect(progress).toHaveAttribute('value', '200000');
    expect(progress).toHaveAttribute('max', '480000');
    expect(screen.getByRole('status')).toHaveTextContent('Rendering: 40%');
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
