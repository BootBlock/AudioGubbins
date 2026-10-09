/**
 * What the recording commands and views say of the input, monitoring and
 * latency, in one place, so a state is worded alike wherever it is shown or
 * spoken.
 *
 * A device's name is the person's own: it is shown to them and spoken to them
 * here, and never written to a log.
 */

import type { MicrophonePermission } from '@audiogubbins/capabilities';
import type { DeviceIdentity, ProcessingControl } from '@audiogubbins/recording';

import type { InputStatus } from './input-view.js';
import type { MonitoringView } from './monitoring-control.js';

/** What each kind of browser processing is called, standing alone. */
export const PROCESSING_NAMES: Readonly<Record<ProcessingControl, string>> = {
  echoCancellation: 'Echo cancellation',
  noiseSuppression: 'Noise suppression',
  autoGainControl: 'Automatic gain control',
  voiceIsolation: 'Voice isolation',
};

/** Milliseconds, whole, in a sentence. */
const MILLISECONDS = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

/** `seconds` as milliseconds. */
export function millisecondsText(seconds: number): string {
  return `${MILLISECONDS.format(seconds * 1000)} ms`;
}

/** What a device is called: its name, where the browser gives one. */
export function deviceName(device: DeviceIdentity | undefined): string {
  if (device === undefined || device.id === '') return "The browser's default input";
  return device.label ?? 'An input the browser has not named';
}

/** What the microphone permission's state means for recording. */
export function permissionText(permission: MicrophonePermission): string {
  switch (permission) {
    case 'granted':
      return 'The microphone is allowed.';
    case 'prompt':
      return 'The browser asks for the microphone when you first arm an input.';
    case 'denied':
      return "The microphone is refused for this site. Allow it in the browser's site settings to record.";
    case 'unknown':
      return 'The browser does not say whether the microphone is allowed; it asks when you arm an input if it needs to.';
  }
}

/** The input's state, as the status bar shows and says it. */
export function statusText(status: InputStatus): string {
  const name = deviceName(status.device);
  switch (status.kind) {
    case 'opening':
      return `Opening ${name}`;
    case 'armed':
      return `${name}: armed`;
    case 'buffering':
      return `${name}: armed, buffering ${String(status.seconds)} s`;
    case 'counting-in':
      return `${name}: counting in`;
    case 'recording':
      return `${name}: recording`;
    case 'calibrating':
      return `${name}: calibrating`;
  }
}

/** What monitoring is now, as it is shown and said. */
export function monitoringText(view: MonitoringView): string {
  const { monitoring } = view;
  switch (monitoring.kind) {
    case 'on': {
      const atLeast = monitoring.latency.inputKnown && view.outputKnown ? '' : 'at least ';
      return `Monitoring is on: you hear the input ${atLeast}${millisecondsText(monitoring.latency.seconds)} late.`;
    }
    case 'confirming':
      return monitoring.context.risk.kind === 'unknown'
        ? 'AudioGubbins cannot tell which output is playing, so cannot tell whether you listen on speakers, which would feed the microphone and howl. Confirm to monitor anyway, or mark the profile as used with headphones.'
        : 'The speakers may feed the microphone and howl. Confirm to monitor anyway, or use headphones.';
    case 'off':
      return monitoring.refusal === undefined
        ? 'Monitoring is off.'
        : `Monitoring is off. ${monitoring.refusal}`;
    case 'unavailable':
      return 'Monitoring is off: no input is open.';
  }
}
