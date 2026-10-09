/**
 * The microphone permission's state, and its changes, where the browser says.
 *
 * The Permissions API answers before anything is asked of the person, so the
 * recording view can say whether arming will prompt, and it reports a
 * revocation while an input is open. Not every browser names the microphone to
 * it: an unknown name is refused with a `TypeError`, as the specification has
 * it, and that and a refusal of the API itself are an `unknown` state, never a
 * guessed one (REQ-EXEC-216).
 */

import { offered } from './browser-reads.js';

/** The microphone permission's state; `unknown` where the browser does not say. */
export type MicrophonePermission = 'granted' | 'denied' | 'prompt' | 'unknown';

/** A permission status's state, checked, since a browser may add states. */
function stateOf(status: PermissionStatus): MicrophonePermission {
  const state: string = status.state;
  return state === 'granted' || state === 'denied' || state === 'prompt' ? state : 'unknown';
}

/** The microphone's permission status, or `undefined` where the browser gives none. */
async function microphoneStatus(
  permissions: Permissions | undefined,
): Promise<PermissionStatus | undefined> {
  const api = offered(() => (typeof permissions?.query === 'function' ? permissions : undefined));
  if (api === undefined) return undefined;
  try {
    return await api.query({ name: 'microphone' });
  } catch (error) {
    // A TypeError names a permission this browser does not know; a DOMException refuses the API.
    if (error instanceof TypeError || error instanceof DOMException) return undefined;
    throw error;
  }
}

/** The microphone permission's state now. */
export async function readMicrophonePermission(
  permissions: Permissions | undefined,
): Promise<MicrophonePermission> {
  const status = await microphoneStatus(permissions);
  return status === undefined ? 'unknown' : stateOf(status);
}

/**
 * Calls `changed` with the microphone permission's state once it is known, and
 * again whenever it changes, and answers how to stop. Where the browser gives
 * no status, `changed` hears `unknown` once.
 */
export function watchMicrophonePermission(
  permissions: Permissions | undefined,
  changed: (state: MicrophonePermission) => void,
): () => void {
  let stopped = false;
  let unlisten = (): void => undefined;
  void microphoneStatus(permissions).then((status) => {
    if (stopped) return;
    if (status === undefined) {
      changed('unknown');
      return;
    }
    const listener = (): void => {
      changed(stateOf(status));
    };
    status.addEventListener('change', listener);
    unlisten = () => {
      status.removeEventListener('change', listener);
    };
    changed(stateOf(status));
  });
  return () => {
    stopped = true;
    unlisten();
  };
}
