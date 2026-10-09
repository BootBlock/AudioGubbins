import { describe, expect, it, vi } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { derivedSampleCount, sampleRate, succeed } from '@audiogubbins/domain';
import { TransportMode } from '@audiogubbins/audio-engine';
import { loopbackCaptureLength } from '@audiogubbins/recording';
import type { OutputDeviceDescriptor } from '@audiogubbins/capabilities';

import { TEST_SIGNAL_PROGRAMME } from '../audio/test-signal.js';
import { playbackSettled } from '../testing/audio-fakes.js';
import { PROMPTLY, everythingQueued } from '../testing/waiting.js';
import { buildShellContext } from '../testing/shell-context.js';

const RATE = 48_000;

/**
 * A shell whose calibration runs over fakes, its signal started and its
 * capture open, playing through `output` where a test names one.
 */
async function calibrating(output?: OutputDeviceDescriptor) {
  const built = buildShellContext();
  const { calibration } = built.context.recording;
  if (output !== undefined) {
    built.recording.media.outputDevice = output;
    built.context.recording.input.watchDevices();
    await everythingQueued();
  }
  expectSuccess(calibration.calibrate());
  await everythingQueued();
  await playbackSettled(built.context.audio);
  const capture = built.recording.captures[0];
  const port = capture?.channels[0];
  if (capture === undefined || port === undefined) throw new Error('Nothing is captured.');
  return { ...built, calibration, capture, port };
}

/**
 * Sends `channels` as a take's channel would carry them from context frame
 * zero, posted rather than in a ring.
 */
function capture(port: MessagePort, channels: readonly Float32Array[]): void {
  port.postMessage({
    kind: 'begin',
    frame: 0,
    sampleRate: RATE,
    channels: channels.length,
    transport: 'posted',
  });
  port.postMessage({ kind: 'block', frame: 0, channels });
}

describe('the latency calibration', () => {
  it('measures the round trip on the channel the signal came back on, and keeps it for the path', async () => {
    const built = await calibrating();
    built.recording.measure.answer = succeed({
      roundTrip: derivedSampleCount(2400),
      peakRatio: 40,
    });
    const length = loopbackCaptureLength(expectSuccess(sampleRate(RATE)));
    const heard = new Float32Array(length).fill(0.5);
    capture(built.port, [new Float32Array(length), heard]);

    await vi.waitFor(() => {
      expect(built.calibration.stage.get().kind).toBe('measured');
    }, PROMPTLY);
    expect(built.recording.measure.given[0]).toEqual(heard);
    const [kept] = built.context.audioSettings.get().recording.calibrations;
    // The output's share is the context's base and output latency, 25 ms.
    expect(kept?.measured).toMatchObject({ roundTrip: 2400, output: 1200, input: 1200 });
    expect(kept?.rate).toBe(RATE);
    expect(built.recording.media.opened[0]?.stopped).toBe(true);
    expect(built.context.audio.get().playback?.transport.mode).toBe(TransportMode.Stopped);
  });

  it('keeps the measurement for the output the browser names', async () => {
    const built = await calibrating({
      deviceId: undefined,
      groupId: 'monitors',
      label: 'Monitors',
    });
    built.recording.measure.answer = succeed({
      roundTrip: derivedSampleCount(2400),
      peakRatio: 40,
    });
    const length = loopbackCaptureLength(expectSuccess(sampleRate(RATE)));
    capture(built.port, [new Float32Array(length).fill(0.5)]);

    await vi.waitFor(() => {
      expect(built.calibration.stage.get().kind).toBe('measured');
    }, PROMPTLY);
    const [kept] = built.context.audioSettings.get().recording.calibrations;
    expect(kept?.output).toEqual({
      kind: 'known',
      device: { id: '', group: 'monitors', label: 'Monitors' },
    });
  });

  it('keeps nothing, and says why, when the signal is not heard back clearly', async () => {
    const built = await calibrating();
    const length = loopbackCaptureLength(expectSuccess(sampleRate(RATE)));
    capture(built.port, [new Float32Array(length)]);

    await vi.waitFor(() => {
      expect(built.calibration.stage.get().kind).toBe('refused');
    }, PROMPTLY);
    const stage = built.calibration.stage.get();
    expect(stage.kind === 'refused' && stage.reason).toBe('Not heard back clearly.');
    expect(built.context.audioSettings.get().recording.calibrations).toEqual([]);
    expect(built.recording.media.opened[0]?.stopped).toBe(true);
  });

  it('refuses a capture that lost frames while measuring', async () => {
    const built = await calibrating();
    built.port.postMessage({
      kind: 'begin',
      frame: 0,
      sampleRate: RATE,
      channels: 1,
      transport: 'posted',
    });
    built.port.postMessage({ kind: 'gap', frame: 0, frames: 128 });

    await vi.waitFor(() => {
      expect(built.calibration.stage.get().kind).toBe('refused');
    }, PROMPTLY);
    expect(built.recording.measure.given).toEqual([]);
  });

  it('closes the input at once when cancelled', async () => {
    const built = await calibrating();
    expectSuccess(built.calibration.cancel());
    expect(built.recording.media.opened[0]?.stopped).toBe(true);
    expect(built.calibration.stage.get()).toEqual({
      kind: 'refused',
      reason: 'The calibration was cancelled.',
    });
  });

  it('is refused while an input is armed, which it would open beside', async () => {
    const built = buildShellContext();
    const { input, calibration } = built.context.recording;
    expectSuccess(input.arm({ purpose: { kind: 'new-stack' }, holdsWriteLease: true }));
    await everythingQueued();
    const refused = calibration.calibrate();
    expect(refused.ok ? undefined : refused.failures[0].summary).toBe(
      'Disarm the input first: the calibration opens it on its own.',
    );
    expect(built.recording.media.requests).toHaveLength(1);
  });

  it('is refused while something plays, since it plays a signal of its own', async () => {
    const built = buildShellContext();
    built.context.playback.play(TEST_SIGNAL_PROGRAMME);
    await playbackSettled(built.context.audio);
    const refused = built.context.recording.calibration.calibrate();
    expect(refused.ok ? undefined : refused.failures[0].summary).toBe(
      'Stop playback first: the calibration plays a signal of its own.',
    );
  });

  it('opens the input with no voice processing, which would cancel the signal', async () => {
    const built = await calibrating();
    expect(built.recording.media.requests[0]).toMatchObject({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
    expectSuccess(built.calibration.cancel());
  });
});
