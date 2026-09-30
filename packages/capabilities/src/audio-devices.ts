/**
 * Being told when the audio devices change.
 *
 * A headset unplugged or an interface switched on changes the device the audio
 * context plays to, and its rate and latency with it. The runtime has to hear
 * about it to recover (the packet's "device capability changes recover
 * cleanly"), and the browser says so on its media devices, which only this
 * package reads (REQ-EXEC-136.4).
 */

/**
 * Calls `changed` whenever the set of audio devices changes, and answers how
 * to stop.
 *
 * Where the browser offers no media devices, as an insecure page does not,
 * nothing is ever reported and stopping does nothing: the context's own state
 * changes still reach the runtime, so a lost device is still noticed when
 * playback stops.
 */
export function watchAudioDevices(changed: () => void): () => void {
  const devices: unknown = Reflect.get(navigator, 'mediaDevices');
  if (!(devices instanceof EventTarget)) return () => undefined;

  const listener = (): void => {
    changed();
  };
  devices.addEventListener('devicechange', listener);
  return () => {
    devices.removeEventListener('devicechange', listener);
  };
}
