/**
 * Where the graph's one sink delivers in the worklet: the channels of the
 * processor's output for the quantum being rendered.
 *
 * The processor points it at the quantum's output before it runs the graph,
 * and the sink's block is copied straight into it, so no block is held from
 * one quantum to the next.
 */

import type { AudioFrameBlock, SinkTarget } from '@audiogubbins/audio-engine';

/** The sink target that copies a block into the output of the quantum being rendered. */
export class QuantumOutput implements SinkTarget {
  #output: readonly Float32Array[] = [];

  /** Points the target at the output channels of the next quantum. */
  renderInto(output: readonly Float32Array[]): void {
    this.#output = output;
  }

  receive(block: AudioFrameBlock): void {
    const output = this.#output;
    if (block.channels.length > output.length) {
      // Dropping a channel would lose audio silently (REQ-ARCH-157); the main
      // thread makes the node with the sink's channels, so this is its fault.
      throw new Error(
        `The graph's output has ${String(block.channels.length)} channels, and the processor's output ${String(output.length)}.`,
      );
    }
    for (let channel = 0; channel < output.length; channel += 1) {
      const to = output[channel];
      if (to === undefined) continue;
      const from = block.channels[channel];
      if (from === undefined) to.fill(0);
      else to.set(from);
    }
  }
}
