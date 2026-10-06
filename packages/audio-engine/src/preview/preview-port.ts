/**
 * The end of a message channel a reader and the preview worker talk over, as
 * the engine sees it.
 *
 * The engine is compiled without a browser's types, so a port is named here
 * by the members it uses, and a port that arrived inside a message is told
 * by those members, as a file is (`media-file.ts`). A browser `MessagePort`
 * has every one of them.
 */

/** A message event, as much of one as a port's listener reads. */
export interface PortMessage {
  readonly data: unknown;
}

/** A browser `MessagePort`, by the members a preview channel uses. */
export interface MessagePortLike {
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
  addEventListener(type: 'message' | 'messageerror', listener: (event: PortMessage) => void): void;
  start(): void;
  close(): void;
}

/** Whether a value that crossed a thread is a port a preview channel can use. */
export function isMessagePortLike(value: unknown): value is MessagePortLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'postMessage') === 'function' &&
    typeof Reflect.get(value, 'addEventListener') === 'function' &&
    typeof Reflect.get(value, 'start') === 'function' &&
    typeof Reflect.get(value, 'close') === 'function'
  );
}

/** One end of a preview channel, sending `TOut`. */
export interface PreviewPort<TOut> {
  post(message: TOut, transfer: readonly ArrayBuffer[]): void;
  /** Hears every message that arrives, and a message that could not be deserialised. */
  listen(onMessage: (data: unknown) => void, onUnreadable: () => void): void;
  close(): void;
}

/** A browser port as one end of a preview channel. */
export function previewPort<TOut>(port: MessagePortLike): PreviewPort<TOut> {
  return {
    post: (message, transfer) => {
      port.postMessage(message, [...transfer]);
    },
    listen: (onMessage, onUnreadable) => {
      port.addEventListener('message', (event) => {
        onMessage(event.data);
      });
      port.addEventListener('messageerror', () => {
        onUnreadable();
      });
      // A port listened to through `addEventListener` delivers nothing until started.
      port.start();
    },
    close: () => {
      port.close();
    },
  };
}
