/**
 * What a recording's manifest states as it starts (`ADR-0071`, `REQ-STOR-166`):
 * when, the input as the browser described it, the profile, what was asked of
 * the browser and what it granted, and the audio's rate and layout, read from
 * the input open now.
 *
 * Every part is only what the browser gave: a setting it did not report is left
 * out, never assumed (`REQ-EXEC-216`). The device's label and group are the
 * person's own; the project keeps them in its provenance, which strips them
 * below the full level.
 */

import { mapResult, type DomainResult } from '@audiogubbins/domain';
import type { CaptureSettings, RecordingStart } from '@audiogubbins/project-format';
import type { CaptureRequest, GrantedCapture } from '@audiogubbins/recording';

import { captureLayout } from './capture-facts.js';
import type { OpenedFacts } from './input-view.js';

/** The settings `request` asked the browser for. */
function requestedOf(request: CaptureRequest): CaptureSettings {
  return {
    ...request.processing,
    ...(request.channelCount === undefined ? {} : { channelCount: request.channelCount }),
    ...(request.sampleRate === undefined ? {} : { sampleRate: request.sampleRate }),
  };
}

/** The settings the browser reported it granted. */
function grantedOf(granted: GrantedCapture): CaptureSettings {
  return {
    ...granted.processing,
    ...(granted.channelCount === undefined ? {} : { channelCount: granted.channelCount }),
    ...(granted.sampleRate === undefined ? {} : { sampleRate: granted.sampleRate }),
    ...(granted.latency === undefined ? {} : { latency: granted.latency }),
  };
}

/**
 * The start of a recording made on the input `facts` describes, at `recordedAt`
 * milliseconds since the epoch, in the layout the capture takes its channels
 * in.
 */
export function recordingStartOf(
  facts: OpenedFacts,
  recordedAt: number,
): DomainResult<RecordingStart> {
  const { device, plan, granted } = facts;
  return mapResult(captureLayout(facts.channels), (layout) => ({
    recordedAt,
    device: {
      ...(device.label === undefined || device.label === '' ? {} : { label: device.label }),
      ...(device.group === undefined ? {} : { group: device.group }),
      ...(granted.channelCount === undefined ? {} : { channelCount: granted.channelCount }),
    },
    profile: { kind: plan.profile.kind, name: plan.profile.name },
    requested: requestedOf(plan.request),
    granted: grantedOf(granted),
    sampleRate: facts.rate,
    layout,
  }));
}
