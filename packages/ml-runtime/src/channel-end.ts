/**
 * One end of a channel between two threads, as a `MessagePort` is, by the
 * part this package uses, since it is compiled without a browser's
 * definitions.
 */

/** One end of a channel, as a `MessagePort` is. */
export interface ChannelEnd {
  /** Sends `message`, giving up `transfer`: buffers, and ends of other channels. */
  postMessage(message: unknown, transfer: readonly object[]): void;
  addEventListener(
    type: 'message' | 'messageerror',
    listener: (event: { readonly data: unknown }) => void,
  ): void;
  /** Starts delivering the messages that arrived, which a listener alone does not. */
  start(): void;
  close(): void;
}

/** Whether a value that crossed a thread is the end of a channel. */
export function isChannelEnd(value: unknown): value is ChannelEnd {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'postMessage') === 'function' &&
    typeof Reflect.get(value, 'addEventListener') === 'function' &&
    typeof Reflect.get(value, 'start') === 'function' &&
    typeof Reflect.get(value, 'close') === 'function'
  );
}
