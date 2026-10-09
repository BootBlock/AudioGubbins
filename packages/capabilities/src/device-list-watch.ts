/**
 * Reading the browser's device list again whenever it says its devices
 * changed, for the inputs and the output the media input adapter describes
 * (ADR-0070).
 *
 * Lists asked for one after another can answer out of order, so only the
 * latest read is delivered, and none once the watch stops.
 */

/**
 * Calls `changed` with what `read` makes of `devices` whenever the browser
 * says its devices changed, and answers how to stop.
 */
export function watchDeviceList<T>(
  devices: MediaDevices,
  read: (devices: MediaDevices) => Promise<T>,
  changed: (value: T) => void,
): () => void {
  let latest = 0;
  let stopped = false;
  const listener = (): void => {
    latest += 1;
    const asked = latest;
    void read(devices).then((value) => {
      if (!stopped && asked === latest) changed(value);
    });
  };
  devices.addEventListener('devicechange', listener);
  return () => {
    stopped = true;
    devices.removeEventListener('devicechange', listener);
  };
}
