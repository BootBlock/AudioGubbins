/**
 * Which buffer each port of a plan reads and writes.
 *
 * Every output port writes one buffer slot, and every input reads the slot its
 * source wrote. A slot is live from the step that writes it to the last step
 * that reads it, and is free for another output after that, so a long serial
 * chain runs in a handful of slots rather than one per port. Two rules keep a
 * reused slot from corrupting audio: a step's outputs are placed before the
 * slots its inputs free are returned, so no output shares a slot with an input
 * of its own step or with another output; and a slot is reused only by a port
 * of its channel count, so a buffer is never read as a different width than it
 * was sized for. The free slot of lowest number is always taken, so the
 * allocation is a function of the plan's order alone.
 */

import { channelCount } from '@audiogubbins/domain';

import type { NodeId, PortReference } from './node-id.js';
import type { ValidatedNode } from './validation.js';

/** The slots of each step's ports, and the width of every slot. */
export interface SlotAllocation {
  /** Channels in each slot, by slot number. */
  readonly channels: readonly number[];

  /** The slot each input port of each step reads, by step, then port. */
  readonly inputs: readonly (readonly number[])[];

  /** The slot each output port of each step writes, by step, then port. */
  readonly outputs: readonly (readonly number[])[];
}

/** The slots free for reuse, by channel count, each list in ascending order. */
type FreeSlots = Map<number, number[]>;

function take(free: FreeSlots, channels: number[], width: number): number {
  const slot = free.get(width)?.shift();
  if (slot !== undefined) return slot;
  channels.push(width);
  return channels.length - 1;
}

function release(free: FreeSlots, width: number, slot: number): void {
  const list = free.get(width) ?? [];
  const at = list.findIndex((one) => one > slot);
  list.splice(at === -1 ? list.length : at, 0, slot);
  free.set(width, list);
}

/** The last step that reads each output, by node, then port name. */
function lastReaders(
  steps: readonly ValidatedNode[],
): ReadonlyMap<NodeId, ReadonlyMap<string, number>> {
  const last = new Map<NodeId, Map<string, number>>();
  for (const [step, node] of steps.entries()) {
    for (const source of node.sources) {
      const ports = last.get(source.node) ?? new Map<string, number>();
      ports.set(source.port, step);
      last.set(source.node, ports);
    }
  }
  return last;
}

/** Where each output written so far and still to be read sits, by node, then port name. */
type Written = Map<NodeId, Map<string, number>>;

function slotOf(written: Written, source: PortReference): number {
  const slot = written.get(source.node)?.get(source.port);
  if (slot === undefined) throw new Error('A step reads an output no earlier step wrote.');
  return slot;
}

/** Frees an output's slot once the step that reads it last has run, or at once if nothing reads it. */
function freeIfDone(
  output: PortReference,
  step: number,
  last: ReadonlyMap<NodeId, ReadonlyMap<string, number>>,
  written: Written,
  free: FreeSlots,
  channels: readonly number[],
): void {
  const reader = last.get(output.node)?.get(output.port);
  const ports = written.get(output.node);
  const slot = ports?.get(output.port);
  if (slot === undefined || (reader !== undefined && reader !== step)) return;
  // Forgotten once freed, so an output two inputs of one step read is freed once.
  ports?.delete(output.port);
  release(free, channels[slot] ?? 0, slot);
}

/** Allocates slots to the ports of steps given in running order. */
export function allocateSlots(steps: readonly ValidatedNode[]): SlotAllocation {
  const last = lastReaders(steps);
  const written: Written = new Map();
  const free: FreeSlots = new Map();
  const channels: number[] = [];
  const inputs: (readonly number[])[] = [];
  const outputs: (readonly number[])[] = [];

  for (const [step, node] of steps.entries()) {
    const id = node.descriptor.id;
    inputs.push(node.sources.map((source) => slotOf(written, source)));
    const ports = new Map<string, number>();
    for (const port of node.descriptor.outputs) {
      ports.set(port.name, take(free, channels, channelCount(port.layout)));
    }
    written.set(id, ports);
    outputs.push([...ports.values()]);
    const done = [
      ...node.sources,
      ...node.descriptor.outputs.map(({ name }) => ({ node: id, port: name })),
    ];
    for (const output of done) freeIfDone(output, step, last, written, free, channels);
  }
  return { channels, inputs, outputs };
}
