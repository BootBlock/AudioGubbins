/**
 * The media input adapter: the one place the browser's audio input is reached
 * (ADR-0070).
 *
 * The application reads it once from the page's navigator and global object
 * and composes it with the recording session, the audio runtime and the
 * storage client: the session decides when to open an input, this opens it,
 * and the application hands what it opened to the runtime. What the browser
 * does not offer has stated behaviour rather than a stand-in (REQ-EXEC-216):
 * listing and opening fail with the reason, an insecure page's before any
 * other, the supported constraints are `undefined`, the permission is
 * `unknown`, the output is `undefined`, and no device change is ever reported.
 * The output the page plays through is read here too, since monitoring and
 * calibration judge the input by the output its sound returns through.
 */

import { fail, succeed, type CancellationSignal, type DomainResult } from '@audiogubbins/domain';

import { offered } from './browser-reads.js';
import {
  readSupportedConstraints,
  type CaptureRequest,
  type SupportedCaptureConstraints,
} from './capture-constraints.js';
import {
  listInputDevices,
  watchInputDevices,
  type InputDeviceDescriptor,
} from './input-devices.js';
import { insecureContext, unsupported } from './media-input-failures.js';
import {
  readPlayingOutput,
  watchPlayingOutput,
  type OutputDeviceDescriptor,
} from './output-devices.js';
import {
  readMicrophonePermission,
  watchMicrophonePermission,
  type MicrophonePermission,
} from './microphone-permission.js';
import { openInput, type OpenedInput } from './opened-input.js';

/** The members of a page's navigator the media input reads. */
export interface MediaInputNavigator {
  readonly mediaDevices?: MediaDevices | undefined;
  readonly permissions?: Permissions | undefined;
}

/** The members of a page's global object the media input reads. */
export interface MediaInputGlobals {
  readonly isSecureContext?: boolean | undefined;
}

/** The browser's audio input, as the application composes it. */
export interface MediaInput {
  /** The microphone permission's state now. */
  readonly permission: () => Promise<MicrophonePermission>;

  /** Hears the permission's state once known and at every change, a revocation among them; answers how to stop. */
  readonly watchPermission: (changed: (state: MicrophonePermission) => void) => () => void;

  /** The audio inputs the browser lists now. */
  readonly listDevices: () => Promise<DomainResult<readonly InputDeviceDescriptor[]>>;

  /** Hears the audio inputs, listed again, whenever the devices change; answers how to stop. */
  readonly watchDevices: (
    changed: (inputs: readonly InputDeviceDescriptor[]) => void,
  ) => () => void;

  /** The output the page plays through, or `undefined` where the browser cannot say which it is. */
  readonly output: () => Promise<OutputDeviceDescriptor | undefined>;

  /** Hears the output the page plays through, read again, whenever the devices change; answers how to stop. */
  readonly watchOutput: (
    changed: (output: OutputDeviceDescriptor | undefined) => void,
  ) => () => void;

  /** Which capture constraints the browser recognises, or `undefined` where it cannot say. */
  readonly supportedConstraints: SupportedCaptureConstraints | undefined;

  /** Opens the input a capture asks for, or says why the browser refused it. */
  readonly open: (
    request: CaptureRequest,
    signal?: CancellationSignal,
  ) => Promise<DomainResult<OpenedInput>>;
}

/** The media devices, where they offer what `name` is. */
function devicesOffering(
  devices: MediaDevices | undefined,
  name: 'enumerateDevices' | 'getUserMedia',
): MediaDevices | undefined {
  return typeof devices?.[name] === 'function' ? devices : undefined;
}

/**
 * Reads the media input once from the page's navigator and global object,
 * which the composition root passes as `navigator` and `globalThis`.
 */
export function readMediaInput(
  navigatorLike: MediaInputNavigator,
  globalLike: MediaInputGlobals,
): MediaInput {
  // An insecure page is given no audio input, and saying so names the remedy.
  const insecure = offered(() => globalLike.isSecureContext) === false;
  const devices = insecure ? undefined : offered(() => navigatorLike.mediaDevices);
  const permissions = offered(() => navigatorLike.permissions);
  const missing = (what: string) => fail(insecure ? insecureContext() : unsupported(what));
  const listing = devicesOffering(devices, 'enumerateDevices');
  const opening = devicesOffering(devices, 'getUserMedia');

  return {
    permission: () => readMicrophonePermission(permissions),
    watchPermission: (changed) => watchMicrophonePermission(permissions, changed),
    listDevices: async () =>
      listing === undefined
        ? missing('a list of its audio inputs')
        : succeed(await listInputDevices(listing)),
    watchDevices: (changed) =>
      listing === undefined ? () => undefined : watchInputDevices(listing, changed),
    output: async () => (listing === undefined ? undefined : await readPlayingOutput(listing)),
    watchOutput: (changed) =>
      listing === undefined ? () => undefined : watchPlayingOutput(listing, changed),
    supportedConstraints: devices === undefined ? undefined : readSupportedConstraints(devices),
    open: async (request, signal) =>
      opening === undefined
        ? missing('audio input to a page')
        : await openInput(opening, request, signal),
  };
}
