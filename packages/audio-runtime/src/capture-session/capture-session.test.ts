/**
 * Capture from the page's side (ADR-0070): an input the application opened,
 * captured in the playback context through the real capture processor on a
 * fake context, each take read back through its capture channel as the
 * storage worker reads it.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { StandardLayouts, discreteLayout, type ChannelLayout } from '@audiogubbins/domain';
import { expectSuccess, expectFailureCode } from '@audiogubbins/domain/testing';

import { CaptureReader, type CaptureEvent } from '../capture/capture-reader.js';
import { CaptureEndReason, CaptureTransport } from '../capture/capture-wire.js';
import { AudioContextState } from '../context/audio-context-port.js';
import { FromCaptureKind, ToCaptureKind } from '../protocol/capture-messages.js';
import { CAPTURE_MODULE_URL, CaptureRig, type CaptureRigOptions } from '../testing/capture-rig.js';
import { FakeMediaStream } from '../testing/fake-media-stream.js';
import { settle } from '../testing/playback-rig.js';
import type { CaptureSessionEvent } from './capture-session.js';

const QUANTUM = 128;

function signal(channel: number, frame: number): number {
  return Math.fround(((channel + 1) * 1000 + (frame % 4096)) / 65_536 - 0.04);
}

let rig: CaptureRig | undefined;
afterEach(() => {
  rig?.session.dispose();
  rig = undefined;
});

/** A rig with an input of `layout` open, and every event its session said. */
async function opened(
  layout: ChannelLayout = StandardLayouts.stereo,
  options: CaptureRigOptions = {},
): Promise<{ rig: CaptureRig; events: CaptureSessionEvent[] }> {
  const made = new CaptureRig(options);
  rig = made;
  const events: CaptureSessionEvent[] = [];
  made.session.subscribe((event) => events.push(event));
  const opening = made.session.open({
    stream: new FakeMediaStream(layout.roles.length, signal),
    layout,
    inputLatency: 0.005,
  });
  await settle();
  expectSuccess(await opening);
  return { rig: made, events };
}

async function takeOf(port: MessagePort): Promise<CaptureEvent[]> {
  const events: CaptureEvent[] = [];
  for await (const event of new CaptureReader(port)) events.push(event);
  return events;
}

function samplesOf(events: readonly CaptureEvent[], channel: number): number[] {
  return events.flatMap((event) =>
    event.kind === 'block' ? [...(event.channels[channel] ?? [])] : [],
  );
}

describe('opening an input (ADR-0070)', () => {
  it('feeds the capture processor’s one input exactly the input’s channels, in the playback context', async () => {
    const { rig: made } = await opened();

    expect(made.modules).toEqual([CAPTURE_MODULE_URL]);
    expect(made.node.shape).toEqual({
      numberOfInputs: 1,
      numberOfOutputs: 1,
      inputChannelCount: 2,
      outputChannelCount: [2],
    });
    expect(made.sources[0]?.connected).toBe(true);
    expect(made.node.connectedTo).toBe(made.context.destination);
    expect(made.node.outputChannelOf).toEqual([0, 1]);
  });

  it('lets the input open before go, zeroing it, when another opens, and adds the module once', async () => {
    const { rig: made } = await opened();
    const first = made.node;
    const opening = made.session.open({
      stream: new FakeMediaStream(1, signal),
      layout: StandardLayouts.mono,
      inputLatency: undefined,
    });
    await settle();
    expectSuccess(await opening);

    expect(first.sent.at(-1)).toEqual({ kind: ToCaptureKind.Release });
    expect(first.disconnected).toBe(true);
    expect(made.sources[0]?.connected).toBe(false);
    expect(made.modules).toEqual([CAPTURE_MODULE_URL]);
    // One microphone is heard in both ears.
    expect(made.node.outputChannelOf).toEqual([0, 0]);
  });

  it('refuses to monitor an input whose channels have no place on the device, with the reason', async () => {
    const { rig: made } = await opened(expectSuccess(discreteLayout(4)));

    const refused = made.session.monitor(true);

    expect(expectFailureCode(refused)).toBe('capture.monitoring-unroutable');
    expect(
      made.node.sent.some(
        (message) => (message as { kind: string }).kind === ToCaptureKind.Monitor,
      ),
    ).toBe(false);
  });
});

describe('a take', () => {
  it.each([
    [false, CaptureTransport.Posted],
    [true, CaptureTransport.SharedRing],
  ])(
    'crosses to its reader bit for bit, shared memory %s, from the frame reported',
    async (shared, transport) => {
      const { rig: made, events } = await opened(StandardLayouts.stereo, { sharedMemory: shared });
      await made.render(4);
      // A frame ahead, as a transport schedules one: the command reaches the
      // audio thread between quanta, after the one rendering now.
      const at = made.frame + 1_000;
      const port = expectSuccess(made.session.record(at));
      const take = takeOf(port);
      await made.render(20);
      expectSuccess(made.session.stop(at + 4_000));
      await made.render(40);
      const read = await take;

      expect(events).toContainEqual({
        kind: FromCaptureKind.Recording,
        firstFrame: at,
        startFrame: at,
        retrospectiveFrames: 0,
      });
      expect(read[0]).toMatchObject({ kind: 'begin', frame: at, transport });
      expect(samplesOf(read, 1)).toEqual(
        Array.from({ length: 4_000 }, (_, offset) => signal(1, at + offset)),
      );
      expect(read.at(-1)).toEqual({
        kind: 'end',
        frame: at + 4_000,
        reason: CaptureEndReason.Stopped,
      });
      expect(events).toContainEqual({
        kind: FromCaptureKind.Stopped,
        endFrame: at + 4_000,
        reason: CaptureEndReason.Stopped,
      });
    },
  );

  it('ends as released when its input is closed, after every frame it had', async () => {
    const { rig: made, events } = await opened();
    const port = expectSuccess(made.session.record(QUANTUM));
    const take = takeOf(port);
    await made.render(4);
    made.session.close();
    await settle();
    const read = await take;

    expect(samplesOf(read, 0)).toEqual(
      Array.from({ length: 3 * QUANTUM }, (_, offset) => signal(0, QUANTUM + offset)),
    );
    expect(read.at(-1)).toEqual({
      kind: 'end',
      frame: 4 * QUANTUM,
      reason: CaptureEndReason.Released,
    });
    expect(events.filter((event) => event.kind === FromCaptureKind.Stopped)).toHaveLength(0);
    expect(expectFailureCode(made.session.record(0))).toBe('capture.no-input');
  });
});

describe('what the page reads of an open input', () => {
  it('pulls the input’s last levels and says how late monitoring is heard', async () => {
    const { rig: made } = await opened();
    expect(made.session.meters()).toBeUndefined();
    await made.render(20);

    const levels = made.session.meters();
    expect(levels?.peak).toHaveLength(2);
    expect(levels?.peak[1]).toBeGreaterThan(0);
    const { baseLatency, outputLatency, sampleRate } = made.context;
    expect(made.session.monitoringLatency()).toEqual({
      chainFrames: 0,
      outputSeconds: baseLatency + (outputLatency ?? Number.NaN),
      inputSeconds: 0.005,
      totalSeconds: 0.005 + 0 / sampleRate + baseLatency + (outputLatency ?? Number.NaN),
    });
  });

  it('keeps monitoring off until it is turned on, and plays the input once it is', async () => {
    const { rig: made } = await opened();
    expectSuccess(made.session.arm(5));
    await made.render(3);
    expect(
      made.node.rendered.every((quantum) =>
        quantum.channels.every((one) => one.every((sample) => sample === 0)),
      ),
    ).toBe(true);

    expectSuccess(made.session.monitor(true));
    await settle();
    await made.render(1);
    const last = made.node.rendered.at(-1);
    expect(last?.channels[0]?.[0]).toBe(signal(0, last?.frame ?? 0));
  });

  it('tells its listeners when the context is lost under the input', async () => {
    const { rig: made, events } = await opened();
    made.context.becomes(AudioContextState.Closed);
    await settle();

    expect(events.at(-1)).toMatchObject({ kind: 'lost' });
    expect(made.session.meters()).toBeUndefined();
  });
});
