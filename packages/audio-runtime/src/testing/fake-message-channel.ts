/**
 * A message channel whose two ends deliver on the test's turn, for testing
 * the feeder and the processor talking to each other without a browser.
 *
 * Node has a `MessageChannel` of its own, but it delivers on its event loop's
 * schedule, which no test can order against the rig's clock. These ends
 * deliver a microtask after the post, as a port delivers a message as a task
 * of the receiving side and never inside `postMessage`, and every message
 * crosses as a structured clone with its transfers, so a message that relied
 * on sharing an object with the other end fails here as it would in a
 * browser. An end that crosses in a message is carried across as itself,
 * since a structured clone cannot copy it and a browser transfers it.
 */

/** A message event as a port dispatches it. */
type PortListener = ((this: MessagePort, event: MessageEvent) => unknown) | null;

/** One end of a {@link fakeChannel}. */
export class FakeMessagePort extends EventTarget implements MessagePort {
  onmessage: PortListener = null;
  onmessageerror: PortListener = null;
  /** Every message posted from this end, as it crossed: a transferred buffer is not left detached here. */
  readonly posted: unknown[] = [];
  closed = false;
  #other: FakeMessagePort | undefined;

  /** Recognised as a port by the protocols' readers, which read a value's tag. */
  readonly [Symbol.toStringTag] = 'MessagePort';

  /** Joins two ends, as a channel makes them. */
  static pair(): { readonly port1: FakeMessagePort; readonly port2: FakeMessagePort } {
    const port1 = new FakeMessagePort();
    const port2 = new FakeMessagePort();
    port1.#other = port2;
    port2.#other = port1;
    return { port1, port2 };
  }

  postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions): void {
    const list = Array.isArray(transfer) ? transfer : (transfer?.transfer ?? []);
    const data = cloneAcross(message, list);
    this.posted.push(data);
    const other = this.#other;
    if (this.closed || other === undefined) return;
    queueMicrotask(() => {
      other.#deliver(data);
    });
  }

  /** Says a message arrived at the other end that could not be received. */
  failToOther(): void {
    const other = this.#other;
    if (other === undefined) return;
    queueMicrotask(() => {
      if (other.closed) return;
      const event = new MessageEvent('messageerror');
      other.onmessageerror?.call(other, event);
      other.dispatchEvent(event);
    });
  }

  start(): void {
    // Delivery is never held: the ends deliver as soon as a listener may hear.
  }

  close(): void {
    this.closed = true;
  }

  #deliver(data: unknown): void {
    if (this.closed) return;
    const event = new MessageEvent('message', { data });
    this.onmessage?.call(this, event);
    this.dispatchEvent(event);
  }
}

/** Two joined ends. */
export function fakeChannel(): { readonly port1: MessagePort; readonly port2: MessagePort } {
  return FakeMessagePort.pair();
}

/**
 * `message` as a structured clone arrives, with `transfer` transferred, and
 * each fake end among the message's fields carried across as itself.
 */
export function cloneAcross(message: unknown, transfer: readonly unknown[]): unknown {
  const buffers = transfer.filter((one): one is ArrayBuffer => one instanceof ArrayBuffer);
  if (typeof message !== 'object' || message === null) {
    return structuredClone(message, { transfer: buffers });
  }
  const ports = Object.entries(message).filter(
    (entry): entry is [string, FakeMessagePort] => entry[1] instanceof FakeMessagePort,
  );
  const bare = Object.fromEntries(
    Object.entries(message).filter(([, value]) => !(value instanceof FakeMessagePort)),
  );
  return { ...structuredClone(bare, { transfer: buffers }), ...Object.fromEntries(ports) };
}
