/**
 * The browser's input as the recording package reads it, and the recording
 * package's request as the browser takes it (`ADR-0070`).
 *
 * The capabilities adapter speaks the browser's shapes and the recording
 * package its own, which knows no browser, so the application maps one to the
 * other here and nowhere else: a device as an identity, the constraints the
 * browser supports as an offer, a capture plan as the constraints asked for,
 * the settings read from the track as a grant, and a granted channel count as
 * the layout a take is recorded in.
 */

import {
  StandardLayouts,
  discreteLayout,
  succeed,
  type ChannelLayout,
  type DomainResult,
  type SampleRate,
} from '@audiogubbins/domain';
import type {
  CaptureRequest as BrowserCaptureRequest,
  GrantedCaptureSettings,
  InputDeviceDescriptor,
  OpenedInput,
  SupportedCaptureConstraints,
} from '@audiogubbins/capabilities';
import type {
  CaptureOffer,
  CapturePlan,
  DeviceIdentity,
  GrantedCapture,
} from '@audiogubbins/recording';

/** A listed input's identity, or none where the browser withholds its identifier. */
export function identityOfDevice(device: InputDeviceDescriptor): DeviceIdentity | undefined {
  if (device.deviceId === undefined) return undefined;
  return {
    id: device.deviceId,
    ...(device.groupId === undefined ? {} : { group: device.groupId }),
    ...(device.label === undefined ? {} : { label: device.label }),
  };
}

/**
 * The identity of the input the browser opened, read from its track: the
 * device asked for where the track does not say which it is, since the
 * request required that device.
 */
export function identityOfOpened(
  opened: OpenedInput,
  asked: DeviceIdentity | undefined,
): DeviceIdentity {
  const id = opened.settings.deviceId ?? asked?.id ?? '';
  const group = opened.settings.groupId ?? asked?.group;
  const label = opened.label ?? asked?.label;
  return {
    id,
    ...(group === undefined ? {} : { group }),
    ...(label === undefined ? {} : { label }),
  };
}

/** The listed input that is `device`, by its identifier, where the browser lists it. */
export function listedAs(
  devices: readonly InputDeviceDescriptor[],
  device: DeviceIdentity | undefined,
): InputDeviceDescriptor | undefined {
  return device === undefined ? undefined : devices.find((one) => one.deviceId === device.id);
}

/** The names of the constraints the browser recognises. */
function supportedNames(supported: SupportedCaptureConstraints | undefined): ReadonlySet<string> {
  return new Set(
    supported === undefined
      ? []
      : Object.entries(supported).flatMap(([name, offered]) => (offered ? [name] : [])),
  );
}

/** What the browser and `device` offer a capture at the context's rate. */
export function captureOffer(
  supported: SupportedCaptureConstraints | undefined,
  device: InputDeviceDescriptor | undefined,
  contextRate: SampleRate,
): CaptureOffer {
  const channels = device?.channelCounts?.max;
  return {
    supported: supportedNames(supported),
    contextRate,
    ...(channels === undefined ? {} : { channelCount: channels }),
  };
}

/** The constraints `plan` asks the browser for, of the input `device`, where one is chosen. */
export function browserRequest(
  plan: CapturePlan,
  device: DeviceIdentity | undefined,
): BrowserCaptureRequest {
  const { processing, channelCount, sampleRate } = plan.request;
  return {
    ...processing,
    ...(device === undefined || device.id === '' ? {} : { deviceId: device.id }),
    ...(channelCount === undefined ? {} : { channelCount }),
    ...(sampleRate === undefined ? {} : { sampleRate }),
  };
}

/** The settings the browser reports it granted, as the recording package compares them. */
export function grantedCaptureOf(settings: GrantedCaptureSettings): GrantedCapture {
  const processing = {
    ...(settings.echoCancellation === undefined
      ? {}
      : { echoCancellation: settings.echoCancellation }),
    ...(settings.noiseSuppression === undefined
      ? {}
      : { noiseSuppression: settings.noiseSuppression }),
    ...(settings.autoGainControl === undefined
      ? {}
      : { autoGainControl: settings.autoGainControl }),
    ...(settings.voiceIsolation === undefined ? {} : { voiceIsolation: settings.voiceIsolation }),
  };
  return {
    processing,
    ...(settings.channelCount === undefined ? {} : { channelCount: settings.channelCount }),
    ...(settings.sampleRate === undefined ? {} : { sampleRate: settings.sampleRate }),
    ...(settings.latency === undefined ? {} : { latency: settings.latency }),
  };
}

/**
 * The layout a capture of `channels` channels is recorded in (`REQ-ARCH-157`):
 * mono for one, left and right for two, as a WAV file without a stated layout
 * is read, and otherwise channels with no stated meaning, which a browser never
 * gives for an input.
 */
export function captureLayout(channels: number): DomainResult<ChannelLayout> {
  if (channels === 1) return succeed(StandardLayouts.mono);
  if (channels === 2) return succeed(StandardLayouts.stereo);
  return discreteLayout(channels);
}
