/**
 * The microphone permission and the inputs the browser lists, watched while a
 * recording view is shown or an input is open (`ADR-0070`).
 *
 * Watching asks the browser nothing the person would see: the permission's
 * state is read without a prompt, and listing the inputs opens none of them. It
 * starts with the first reader and stops with the last, so a page on which no
 * recording view is open and no input is armed reads nothing of its inputs.
 */

import type {
  InputDeviceDescriptor,
  MediaInput,
  MicrophonePermission,
} from '@audiogubbins/capabilities';
import type { DomainFailure } from '@audiogubbins/domain';

/** Hears what the watch learns. */
export interface DeviceWatchListener {
  readonly permission: (state: MicrophonePermission) => void;
  readonly devices: (inputs: readonly InputDeviceDescriptor[]) => void;
  /** The browser would not list its inputs, for the reason given. */
  readonly refused: (failure: DomainFailure) => void;
}

/** Watches the permission and the inputs for as many readers as there are. */
export class DeviceWatch {
  readonly #media: MediaInput;
  readonly #listener: DeviceWatchListener;
  #readers = 0;
  #stop: (() => void) | undefined;
  /** Counts listings, so one overtaken by a later one is not delivered. */
  #listing = 0;

  constructor(media: MediaInput, listener: DeviceWatchListener) {
    this.#media = media;
    this.#listener = listener;
  }

  /** Watches until the answer is called; the first reader starts the watch and lists the inputs. */
  watch(): () => void {
    this.#readers += 1;
    if (this.#readers === 1) this.#start();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      this.#readers -= 1;
      if (this.#readers === 0) this.#end();
    };
  }

  /** Lists the inputs again, as after the permission is given, which shows their names. */
  relist(): void {
    if (this.#readers > 0) void this.#list();
  }

  #start(): void {
    const stopPermission = this.#media.watchPermission(this.#listener.permission);
    const stopDevices = this.#media.watchDevices(this.#listener.devices);
    this.#stop = () => {
      stopPermission();
      stopDevices();
    };
    void this.#list();
  }

  #end(): void {
    this.#listing += 1;
    this.#stop?.();
    this.#stop = undefined;
  }

  async #list(): Promise<void> {
    this.#listing += 1;
    const asked = this.#listing;
    const listed = await this.#media.listDevices();
    if (asked !== this.#listing) return;
    if (listed.ok) this.#listener.devices(listed.value);
    else this.#listener.refused(listed.failures[0]);
  }
}
