import { describe, expect, it } from 'vitest';

import {
  deviceReport,
  outputLatencyFrames,
  sameDeviceReport,
  type DeviceReport,
} from './device-report.js';
import { FakeAudioContext } from '../testing/fake-audio-context.js';

const STEREO_AT_48K: DeviceReport = {
  sampleRate: 48_000,
  baseLatencySeconds: 128 / 48_000,
  outputLatencySeconds: 480 / 48_000,
  maxChannelCount: 2,
  channelCount: 2,
};

describe('deviceReport', () => {
  it('reads the rate, both latencies and the channels from the context', () => {
    const context = new FakeAudioContext({
      sampleRate: 44_100,
      baseLatency: 0.005,
      outputLatency: 0.02,
      maxChannelCount: 8,
      channelCount: 2,
    });

    expect(deviceReport(context)).toEqual({
      sampleRate: 44_100,
      baseLatencySeconds: 0.005,
      outputLatencySeconds: 0.02,
      maxChannelCount: 8,
      channelCount: 2,
    });
  });

  it('keeps an output latency the browser does not give as absent, not zero', () => {
    const context = new FakeAudioContext({ outputLatency: undefined });

    expect(deviceReport(context).outputLatencySeconds).toBeUndefined();
  });
});

describe('sameDeviceReport', () => {
  it.each([
    ['rate', { sampleRate: 44_100 }],
    ['base latency', { baseLatencySeconds: 0 }],
    ['output latency', { outputLatencySeconds: undefined }],
    ['most channels', { maxChannelCount: 6 }],
    ['channels in use', { channelCount: 1 }],
  ] as const)('tells reports apart by their %s', (_field, change) => {
    expect(sameDeviceReport(STEREO_AT_48K, { ...STEREO_AT_48K, ...change })).toBe(false);
  });

  it('finds a report the same as a copy of itself', () => {
    expect(sameDeviceReport(STEREO_AT_48K, { ...STEREO_AT_48K })).toBe(true);
  });
});

describe('outputLatencyFrames', () => {
  it('adds the context’s and the device’s latency, in frames', () => {
    expect(outputLatencyFrames(STEREO_AT_48K)).toBe(128 + 480);
  });

  it('recovers the whole frames the browser measured where the seconds land just below', () => {
    // 128 and 102 frames at 48 kHz come back as 229.99999999999997: rounding
    // down would lose a frame the browser measured.
    const report = {
      ...STEREO_AT_48K,
      baseLatencySeconds: 128 / 48_000,
      outputLatencySeconds: 102 / 48_000,
    };

    expect((report.baseLatencySeconds + report.outputLatencySeconds) * 48_000).toBeLessThan(230);
    expect(outputLatencyFrames(report)).toBe(230);
  });

  it('counts the context’s latency alone where the browser gives no output latency', () => {
    expect(outputLatencyFrames({ ...STEREO_AT_48K, outputLatencySeconds: undefined })).toBe(128);
  });
});
