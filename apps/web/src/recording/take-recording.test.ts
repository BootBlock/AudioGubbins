import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  StandardLayouts,
  derivedSampleCount,
  sampleRate,
  unsafeBrandId,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { CaptureProfileKind, RecordingEnding } from '@audiogubbins/project-format';
import type { RecordingSetUp } from '@audiogubbins/storage';
import type { RecordingClient, RemoteProjectSession } from '@audiogubbins/storage-runtime';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';

import { projectWorld, type ProjectWindow } from '../testing/project-context.js';
import { everythingQueued } from '../testing/waiting.js';
import { TakeRecording } from './take-recording.js';

const RATE = expectSuccess(sampleRate(48_000));

const SET_UP: RecordingSetUp = {
  start: {
    recordedAt: 1_790_000_000_000,
    device: { channelCount: 2 },
    profile: { kind: CaptureProfileKind.RawStudio, name: 'Raw/Studio' },
    requested: {},
    granted: {},
    sampleRate: RATE,
    layout: StandardLayouts.stereo,
  },
  transportFrame: derivedSampleCount(0),
  purpose: { kind: 'stack' },
  take: { name: 'Take 1', stackName: 'Recording 1', compensation: 0 },
};

const windows: ProjectWindow[] = [];
const ports: MessagePort[] = [];
afterEach(() => {
  for (const window of windows.splice(0)) window.takeDown();
  for (const port of ports.splice(0)) port.close();
});

/** A project open to write, its storage worker's recordings with every stop counted, and a capture channel. */
async function scene() {
  const window = await projectWorld().window();
  windows.push(window);
  await window.runAndHear('file.create-project', { name: 'Harbour' });
  const project: RemoteProjectSession | undefined = window.projects.project.session();
  if (project === undefined) throw new Error('No project is open to write.');
  const real = window.projects.recordings;
  const stops = vi.fn((...args: Parameters<RecordingClient['stop']>) => real.stop(...args));
  const client: RecordingClient = { ...real, stop: stops };
  const channel = new MessageChannel();
  ports.push(channel.port1);
  const take = new TakeRecording({
    client,
    project,
    session: unsafeBrandId<'RecordingSessionId'>('5e5510a0-0000-4000-8000-000000000001'),
    port: channel.port2,
    schedule: (callback, milliseconds) => {
      const timer = setTimeout(callback, milliseconds);
      return () => {
        clearTimeout(timer);
      };
    },
    logger: createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('recording'),
    status: () => undefined,
  });
  /** The capture processor's side: a begun take of `frames` frames, then its end. */
  const capture = (frames: number): void => {
    channel.port1.postMessage({
      kind: 'begin',
      frame: 0,
      sampleRate: RATE,
      channels: 2,
      transport: 'posted',
    });
    const block = [new Float32Array(frames).fill(0.5), new Float32Array(frames).fill(-0.5)];
    channel.port1.postMessage(
      { kind: 'block', frame: 0, channels: block },
      block.map((one) => one.buffer),
    );
    channel.port1.postMessage({ kind: 'end', frame: frames, reason: 'stopped' });
  };
  return { window, take, stops, capture };
}

describe('one take between Record and what it came to', () => {
  it('is stopped once, with the first ending given, however often stop is asked', async () => {
    const { take, stops, capture } = await scene();
    take.begin(SET_UP);
    capture(24_000);
    take.stop(RecordingEnding.Timed);
    take.stop(RecordingEnding.Stopped);
    const outcome = await take.outcome;
    take.stop(RecordingEnding.DeviceLost);
    expect(stops).toHaveBeenCalledTimes(1);
    expect(stops.mock.calls[0]?.[1]).toBe(RecordingEnding.Timed);
    expect(outcome.kind === 'finished' && outcome.recording.recording).toMatchObject({
      length: 24_000,
      ending: RecordingEnding.Timed,
    });
  });

  it('makes a stop asked for before the worker began the take once it has', async () => {
    const { take, stops, capture } = await scene();
    take.stop(RecordingEnding.Stopped);
    // Nothing was begun: the take is let go of, and the worker is asked nothing.
    expect(await take.outcome).toEqual({ kind: 'unbegun' });
    capture(100);
    await everythingQueued();
    expect(stops).not.toHaveBeenCalled();
  });

  it('stops once the worker has begun, when the stop came while it was beginning', async () => {
    const { take, stops, capture } = await scene();
    take.begin(SET_UP);
    take.stop(RecordingEnding.Stopped);
    expect(stops).not.toHaveBeenCalled();
    capture(12_000);
    const outcome = await take.outcome;
    expect(stops).toHaveBeenCalledTimes(1);
    expect(outcome.kind).toBe('finished');
  });
});
