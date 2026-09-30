import { describe, expect, it } from 'vitest';

import { routeToDevice, type RoutedNode, type RoutingContext } from './device-routing.js';

/** A connection one node made: to which node, from which output, to which input. */
interface Connection {
  readonly from: string;
  readonly to: string;
  readonly output: number | undefined;
  readonly input: number | undefined;
}

/** Audio nodes that record what they are connected to, by name. */
class RecordingGraph implements RoutingContext {
  readonly #names = new Map<RoutedNode, string>();
  readonly connections: Connection[] = [];
  readonly disconnected: string[] = [];
  readonly destination = this.node('destination');

  node(name: string): RoutedNode & { readonly name: string } {
    const node = {
      name,
      connect: (to: RoutedNode, output?: number, input?: number): void => {
        this.connections.push({ from: name, to: this.nameOf(to), output, input });
      },
      disconnect: (): void => {
        this.disconnected.push(name);
      },
    };
    this.#names.set(node, name);
    return node;
  }

  createChannelSplitter(outputs: number): RoutedNode {
    return this.node(`splitter of ${String(outputs)}`);
  }

  createChannelMerger(inputs: number): RoutedNode {
    return this.node(`merger of ${String(inputs)}`);
  }

  nameOf(node: RoutedNode): string {
    return this.#names.get(node) ?? 'a node of another graph';
  }
}

describe('routeToDevice', () => {
  it('connects an output already in the device’s order straight to the destination', () => {
    const graph = new RecordingGraph();
    const source = graph.node('source');

    const unroute = routeToDevice(graph, source, [0, 1, 2, 3, 4, 5]);

    expect(graph.connections).toEqual([
      { from: 'source', to: 'destination', output: undefined, input: undefined },
    ]);
    unroute();
    expect(graph.disconnected).toEqual(['source']);
  });

  it('wires each output channel to its device channel through a splitter and a merger', () => {
    const graph = new RecordingGraph();
    const source = graph.node('source');

    const unroute = routeToDevice(graph, source, [0, 1, 4, 5, 2, 3]);

    expect(graph.connections).toEqual([
      { from: 'source', to: 'splitter of 6', output: undefined, input: undefined },
      ...[0, 1, 4, 5, 2, 3].map((output, device) => ({
        from: 'splitter of 6',
        to: 'merger of 6',
        output,
        input: device,
      })),
      { from: 'merger of 6', to: 'destination', output: undefined, input: undefined },
    ]);
    unroute();
    expect(graph.disconnected).toEqual(['source', 'splitter of 6', 'merger of 6']);
  });
});
