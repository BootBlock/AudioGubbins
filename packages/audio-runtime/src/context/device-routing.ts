/**
 * Puts a node's channels on the device channels `DeviceChannels` chose.
 *
 * A node's output reaches the destination channel by channel in its own
 * order, so an order that differs goes through a splitter, one output a
 * channel, and a merger, one input a channel, wired from each output channel
 * to its device channel. Both pass a channel unchanged: routing, not mixing.
 * An order that is already the device's connects straight.
 *
 * Written against the few members of the Web Audio nodes it uses, so the
 * wiring is tested without a browser, which a test cannot make.
 */

/** The members of an audio node the routing uses. */
export interface RoutedNode {
  connect(destination: RoutedNode, output?: number, input?: number): unknown;
  disconnect(): void;
}

/** The members of an audio context the routing uses. */
export interface RoutingContext {
  readonly destination: RoutedNode;
  createChannelSplitter(numberOfOutputs: number): RoutedNode;
  createChannelMerger(numberOfInputs: number): RoutedNode;
}

/**
 * Connects `node` to the context's destination with output channel
 * `outputChannelOf[k]` on device channel `k`, and answers how to undo it.
 */
export function routeToDevice(
  context: RoutingContext,
  node: RoutedNode,
  outputChannelOf: readonly number[],
): () => void {
  const { destination } = context;
  if (outputChannelOf.every((output, device) => output === device)) {
    node.connect(destination);
    return () => {
      node.disconnect();
    };
  }
  const count = outputChannelOf.length;
  const splitter = context.createChannelSplitter(count);
  const merger = context.createChannelMerger(count);
  node.connect(splitter);
  for (const [device, output] of outputChannelOf.entries())
    splitter.connect(merger, output, device);
  merger.connect(destination);
  return () => {
    node.disconnect();
    splitter.disconnect();
    merger.disconnect();
  };
}
