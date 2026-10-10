/**
 * One end of a message channel, as the codec worker sees it: the channel a
 * request arrives on, and each stream's channel to the storage worker or from
 * the render worker (ADR-0090, ADR-0092).
 *
 * A port is named by the members used, and one that arrived inside a message
 * is told by those members, so a test drives the worker over Node's own
 * channels and the browser's `MessagePort` has every one of them.
 */

/** A message event, as much of one as a listener reads. */
export interface PortMessage {
  readonly data: unknown;
}

/** A browser `MessagePort`, by the members the codec worker uses. */
export interface MessagePortLike {
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
  addEventListener(type: 'message' | 'messageerror', listener: (event: PortMessage) => void): void;
  start(): void;
  close(): void;
}

/** Whether a value that crossed a thread is a port the codec worker can use. */
export function isMessagePortLike(value: unknown): value is MessagePortLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    ['postMessage', 'addEventListener', 'start', 'close'].every(
      (member) => typeof Reflect.get(value, member) === 'function',
    )
  );
}

/**
 * Hears every message that arrives on `port`, and a message that could not
 * be deserialised, and starts the port, which delivers nothing to a listener
 * added this way until it is started.
 */
export function listen(
  port: MessagePortLike,
  onMessage: (data: unknown) => void,
  onUnreadable: () => void,
): void {
  port.addEventListener('message', (event) => {
    onMessage(event.data);
  });
  port.addEventListener('messageerror', () => {
    onUnreadable();
  });
  port.start();
}
