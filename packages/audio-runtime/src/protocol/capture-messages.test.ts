import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  ambisonicLayout,
  AmbisonicNormalisation,
  AmbisonicOrdering,
  unsafeBrandId,
} from '@audiogubbins/domain';
import { crossingThreads, expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { DspImplementation } from '@audiogubbins/audio-engine';

import { CaptureEndReason } from '../capture/capture-wire.js';
import { DspDeliveryKind } from '../dsp/dsp-delivery.js';
import { createSampleRing } from '../feed/sample-ring.js';
import { FakeMessagePort } from '../testing/fake-message-channel.js';
import {
  FromCaptureKind,
  ToCaptureKind,
  readFromCapture,
  readToCapture,
  retrospectiveRefusal,
  type FromCapture,
  type ToCapture,
} from './capture-messages.js';

const PROCESSOR = unsafeBrandId<'ProcessorId'>('0000aaaa-0001');
const PARAMETER = unsafeBrandId<'ParameterId'>('0000aaaa-0002');

/** One message of every kind the capture processor is sent, an ambisonic input among them. */
function everyToCapture(channel: MessagePort): readonly ToCapture[] {
  return [
    {
      kind: ToCaptureKind.Configure,
      layout: expectSuccess(
        ambisonicLayout({
          order: 1,
          ordering: AmbisonicOrdering.Acn,
          normalisation: AmbisonicNormalisation.Sn3d,
        }),
      ),
      dsp: { kind: DspDeliveryKind.Unavailable, reason: 'None, in this test.' },
      reportEveryBlocks: 13,
    },
    { kind: ToCaptureKind.Arm, retrospectiveSeconds: 12.5 },
    { kind: ToCaptureKind.Disarm },
    {
      kind: ToCaptureKind.Record,
      at: 4_800,
      channel,
      ring: expectSuccess(createSampleRing(2, 256)),
    },
    { kind: ToCaptureKind.Stop, at: 9_600 },
    { kind: ToCaptureKind.Monitor, on: true },
    {
      kind: ToCaptureKind.SetChain,
      chain: { id: unsafeBrandId<'EffectChainId'>('0000aaaa-0003'), slots: [] },
      quality: MAXIMUM_QUALITY,
    },
    { kind: ToCaptureKind.SetChain, chain: undefined, quality: MAXIMUM_QUALITY },
    { kind: ToCaptureKind.SetParameter, processor: PROCESSOR, parameter: PARAMETER, value: -3 },
    { kind: ToCaptureKind.Release },
  ];
}

const EVERY_FROM_CAPTURE: readonly FromCapture[] = [
  {
    kind: FromCaptureKind.Configured,
    dsp: DspImplementation.Reference,
    dspFallbackReason: 'None.',
  },
  { kind: FromCaptureKind.Armed, retrospectiveFrames: 240_000 },
  { kind: FromCaptureKind.Disarmed },
  { kind: FromCaptureKind.Recording, firstFrame: 100, startFrame: 340, retrospectiveFrames: 240 },
  { kind: FromCaptureKind.Stopped, endFrame: 9_600, reason: CaptureEndReason.Released },
  { kind: FromCaptureKind.Monitoring, on: true, chained: true, chainLatencyFrames: 64 },
  { kind: FromCaptureKind.ChainRefused, failures: [{ code: 'a.b', summary: 'Why.' }] },
  {
    kind: FromCaptureKind.ParameterRefused,
    processor: PROCESSOR,
    parameter: PARAMETER,
    failures: [{ code: 'a.b', summary: 'Why.' }],
  },
  { kind: FromCaptureKind.Refused, command: ToCaptureKind.Stop, reason: 'Not recording.' },
  {
    kind: FromCaptureKind.Report,
    contextFrame: 1_664,
    meter: { peak: [0.5, 0.25], rms: [0.3, 0.1], correlation: [-0.5] },
    bufferedFrames: 1_000,
    lostFrames: 0,
    absentFrames: 128,
  },
  {
    kind: FromCaptureKind.Report,
    contextFrame: 1_664,
    meter: undefined,
    bufferedFrames: 0,
    lostFrames: 3,
    absentFrames: 0,
  },
  { kind: FromCaptureKind.Released },
  { kind: FromCaptureKind.Fault, message: 'Stopped.' },
];

describe('the capture processor’s messages (ADR-0070)', () => {
  it('reads every message the page sends as it arrives, the channel end moved with it', () => {
    const { port1 } = FakeMessagePort.pair();
    for (const message of everyToCapture(port1)) {
      const transfer = message.kind === ToCaptureKind.Record ? [message.channel] : [];
      expect(expectSuccess(readToCapture(crossingThreads(message, transfer)))).toEqual(message);
    }
  });

  it('reads every reply as it arrives', () => {
    for (const reply of EVERY_FROM_CAPTURE) {
      expect(expectSuccess(readFromCapture(structuredClone(reply)))).toEqual(reply);
    }
  });

  it('refuses a message whose field is not what its kind needs, naming it', () => {
    const read = readToCapture({ kind: ToCaptureKind.Configure, layout: { roles: ['up'] } });

    expect(expectFailureCode(read)).toBe('protocol.capture-message-malformed');
    expect(read.ok ? undefined : read.failures[0].details).toEqual({ field: 'layout.roles[0]' });
  });

  it('refuses a take said to have stopped as failed, which only its channel says', () => {
    const read = readFromCapture({
      kind: FromCaptureKind.Stopped,
      endFrame: 1,
      reason: CaptureEndReason.Failed,
    });

    expect(expectFailureCode(read)).toBe('protocol.capture-reply-malformed');
  });

  it('keeps a retrospective buffer of any length a buffer can have, and none at zero', () => {
    expect([0, 0.5, 5, 60, 90].map(retrospectiveRefusal)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(
      [-5, Number.NaN, Number.POSITIVE_INFINITY].map(
        (seconds) => typeof retrospectiveRefusal(seconds),
      ),
    ).toEqual(['string', 'string', 'string']);
  });
});
