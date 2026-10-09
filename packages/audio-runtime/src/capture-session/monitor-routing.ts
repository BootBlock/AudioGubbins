/**
 * Which device channel each monitored channel plays on (ADR-0070).
 *
 * Monitoring shares the context's destination with playback, which sets the
 * destination's channels for its own graph, so the monitored input is put on
 * the device channels by what each carries, as playback's output is
 * (`device-channels.ts`), and never changes the destination. A mono input is
 * the one exception: one microphone is heard in both ears, on the first two
 * device channels, rather than on the left alone. An input whose channels have
 * no place on the device cannot be monitored, with the reason; its node is
 * still connected, silent, because the browser runs a node only while
 * something it plays to is heard.
 */

import { ChannelRole, type ChannelLayout } from '@audiogubbins/domain';

import type { AudioDestinationPort } from '../context/audio-context-port.js';
import { deviceChannelsFor } from '../context/device-channels.js';

/** Where the monitored channels play, and why monitoring is not possible where it is not. */
export interface MonitorRouting {
  /** For each device channel, the monitored channel it carries. */
  readonly outputChannelOf: readonly number[];
  /** Why the input cannot be monitored on this device, or nothing where it can. */
  readonly refusal: string | undefined;
}

/** The routing of an input of `layout` to `destination`. */
export function monitorRouting(
  layout: ChannelLayout,
  destination: AudioDestinationPort,
): MonitorRouting {
  if (layout.roles.length === 1 && layout.roles[0] === ChannelRole.Mono) {
    const both = Math.min(2, destination.maxChannelCount);
    return { outputChannelOf: new Array<number>(both).fill(0), refusal: undefined };
  }
  const device = deviceChannelsFor(layout, destination.maxChannelCount);
  if (device.ok) return { outputChannelOf: device.value.outputChannelOf, refusal: undefined };
  return { outputChannelOf: [0], refusal: device.failures[0].summary };
}
