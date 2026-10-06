import { channelCount, discreteLayout, type ChannelLayout } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import { compileGraph } from './compilation.js';
import type { EdgeDescriptor, GraphDescriptor, ProcessingNodeDescriptor } from './descriptor.js';
import type { ExecutionPlan } from './plan.js';
import {
  CATALOGUE,
  MONO,
  RATE,
  STEREO,
  delay,
  edge,
  graph,
  mix,
  node,
  port,
  sink,
  source,
} from './testing/test-graphs.js';

function plan(described: GraphDescriptor): ExecutionPlan {
  const compiled = compileGraph(described, CATALOGUE, RATE);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  return compiled.plan;
}

/** A source, `length` delays one after another, and a sink. */
function chain(length: number): GraphDescriptor {
  const names = Array.from({ length }, (_, index) => `d${String(index)}`);
  return graph(
    [source('in'), ...names.map((name) => delay(name, 1)), sink('out')],
    ['in', ...names].map((from, index) => edge(`${from}.out`, `${names[index] ?? 'out'}.in`)),
  );
}

const WET_DRY = graph(
  [source('in'), delay('wet', 64), mix('blend', 2), sink('out')],
  [
    edge('in.out', 'wet.in'),
    edge('wet.out', 'blend.in-1'),
    edge('in.out', 'blend.in-2'),
    edge('blend.out', 'out.in'),
  ],
);

describe('an execution plan', () => {
  it('lists each step with its slots and the delay each input needs', () => {
    const planned = plan(WET_DRY);
    expect(planned.steps.map((step) => step.node)).toEqual(['in', 'wet', 'blend', 'out']);
    const blend = planned.steps[2]!;
    expect(blend.inputs.map((input) => input.delay)).toEqual([0, 64]);
    expect(blend.inputs.map((input) => input.slot)).toEqual([
      planned.steps[1]!.outputs[0]!.slot,
      planned.steps[0]!.outputs[0]!.slot,
    ]);
    expect(planned.sinks).toEqual([
      { node: 'out', slots: [blend.outputs[0]!.slot], latency: { kind: 'known', frames: 64 } },
    ]);
    expect(planned.latency).toEqual({ kind: 'known', frames: 64 });
    expect(planned.sampleRate).toBe(RATE);
  });

  it('says how late each step hears the sources, its inputs aligned to the latest', () => {
    // A kernel that plays back what a pass made of a stream tells by this
    // which frame of it its input carries.
    expect(plan(WET_DRY).steps.map((step) => step.inputArrival)).toEqual([
      { kind: 'known', frames: 0 },
      { kind: 'known', frames: 0 },
      { kind: 'known', frames: 64 },
      { kind: 'known', frames: 64 },
    ]);
  });

  it('runs a long serial chain in two slots, reusing each once its reader has run', () => {
    const planned = plan(chain(40));
    expect(planned.slots).toEqual([{ channels: 2 }, { channels: 2 }]);
  });

  it('reuses a slot only for a port of the same channel count', () => {
    const planned = plan(
      graph(
        [
          source('in', MONO),
          node('widen', 'matrix', { inputs: [port('in', MONO)], outputs: [port('out', STEREO)] }),
          node('narrow', 'matrix', { inputs: [port('in', STEREO)], outputs: [port('out', MONO)] }),
          sink('out', MONO),
        ],
        [edge('in.out', 'widen.in'), edge('widen.out', 'narrow.in'), edge('narrow.out', 'out.in')],
      ),
    );
    expect(planned.slots).toEqual([{ channels: 1 }, { channels: 2 }]);
    expect(planned.steps.map((step) => step.outputs.map((output) => output.slot))).toEqual([
      [0],
      [1],
      [0],
      [],
    ]);
  });

  it('gives an output nothing reads a slot of its own, free again after its step', () => {
    const planned = plan(
      graph(
        [
          node('in', 'source', { outputs: [port('out'), port('spare')] }),
          delay('d', 0),
          sink('out'),
        ],
        [edge('in.out', 'd.in'), edge('d.out', 'out.in')],
      ),
    );
    expect(planned.steps[0]!.outputs.map((output) => output.slot)).toEqual([0, 1]);
    expect(planned.steps[1]!.outputs[0]!.slot).toBe(1);
  });

  it('writes settings in one order, whatever order they were declared in', () => {
    const settings = (described: GraphDescriptor): string =>
      JSON.stringify(plan(described).steps.find((step) => step.node === 'd')!.settings);
    const one = graph(
      [
        source('in'),
        node('d', 'delay', {
          inputs: [port('in')],
          outputs: [port('out')],
          settings: { frames: 1, bypass: true },
        }),
        sink('out'),
      ],
      [edge('in.out', 'd.in'), edge('d.out', 'out.in')],
    );
    const other = graph(
      [
        source('in'),
        node('d', 'delay', {
          inputs: [port('in')],
          outputs: [port('out')],
          settings: { bypass: true, frames: 1 },
        }),
        sink('out'),
      ],
      [edge('in.out', 'd.in'), edge('d.out', 'out.in')],
    );
    expect(settings(one)).toBe(settings(other));
    expect(settings(one)).toBe('{"bypass":true,"frames":1}');
  });

  it('is plain data that survives being posted to another thread', () => {
    const planned = plan(WET_DRY);
    expect(structuredClone(planned)).toEqual(planned);
    expect(JSON.parse(JSON.stringify(planned))).toEqual(planned);
  });

  it('refuses to plan a graph that does not validate', () => {
    const compiled = compileGraph(graph([source('in')], []), CATALOGUE, RATE);
    expect(compiled.ok ? [] : compiled.diagnostics.map((one) => one.code)).toEqual(['no-sink']);
  });
});

/**
 * A small deterministic generator, mulberry32, so a failing graph is found
 * again from its seed rather than lost to a random draw.
 */
function generator(seed: number): (below: number) => number {
  let state = seed >>> 0;
  return (below) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return Math.floor((((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296) * below);
  };
}

const WIDTHS: readonly ChannelLayout[] = [MONO, STEREO, expectSuccess(discreteLayout(6))];

/** An output a later node may read. */
interface Offered {
  readonly node: string;
  readonly port: string;
  readonly layout: ChannelLayout;
}

/** A random graph that validates: sources, processors reading earlier outputs, and sinks. */
function randomGraph(seed: number): GraphDescriptor {
  const draw = generator(seed);
  const nodes: ProcessingNodeDescriptor[] = [];
  const edges: EdgeDescriptor[] = [];
  const offered: Offered[] = [];
  const offer = (name: string, count: number): ReturnType<typeof port>[] =>
    Array.from({ length: count }, (_, index) => {
      const layout = WIDTHS[draw(WIDTHS.length)]!;
      offered.push({ node: name, port: `out-${String(index)}`, layout });
      return port(`out-${String(index)}`, layout);
    });
  const read = (name: string, count: number): ReturnType<typeof port>[] =>
    Array.from({ length: count }, (_, index) => {
      const from = offered[draw(offered.length)]!;
      edges.push(edge(`${from.node}.${from.port}`, `${name}.in-${String(index)}`));
      return port(`in-${String(index)}`, from.layout);
    });

  for (let index = 0; index < 1 + draw(3); index += 1) {
    nodes.push(
      node(`s${String(index)}`, 'source', { outputs: offer(`s${String(index)}`, 1 + draw(2)) }),
    );
  }
  for (let index = 0; index < 3 + draw(25); index += 1) {
    const name = `p${String(index)}`;
    const inputs = read(name, 1 + draw(3));
    const settings = { frames: draw(4) === 0 ? 0 : draw(500) };
    nodes.push(node(name, 'delay', { inputs, outputs: offer(name, 1 + draw(3)), settings }));
  }
  for (let index = 0; index < 1 + draw(3); index += 1) {
    nodes.push(
      node(`k${String(index)}`, index === 0 ? 'sink' : 'meter', {
        inputs: read(`k${String(index)}`, 1 + draw(2)),
      }),
    );
  }
  return graph(nodes, edges);
}

/**
 * Runs a plan with a tag in place of audio: each step checks that every slot
 * it reads still holds what its source wrote, and that no output shares a slot
 * with another port of its step, then writes its outputs' tags.
 */
function aliasingIn(planned: ExecutionPlan, described: GraphDescriptor): readonly string[] {
  const sourceOf = new Map(
    described.edges.map((one) => [
      `${one.to.node}.${one.to.port}`,
      `${one.from.node}.${one.from.port}`,
    ]),
  );
  const held = new Map<number, string>();
  const found: string[] = [];
  for (const step of planned.steps) {
    for (const input of step.inputs) {
      const expected = sourceOf.get(`${step.node}.${input.port}`);
      if (held.get(input.slot) !== expected)
        found.push(`${step.node}.${input.port} read ${String(held.get(input.slot))}`);
      if (planned.slots[input.slot]?.channels !== channelCount(input.layout))
        found.push(`${step.node}.${input.port} width`);
    }
    const written = step.outputs.map((output) => output.slot);
    const read = step.inputs.map((input) => input.slot);
    if (new Set(written).size !== written.length || written.some((slot) => read.includes(slot))) {
      found.push(`${step.node} shares a slot within its step`);
    }
    for (const output of step.outputs) {
      if (planned.slots[output.slot]?.channels !== channelCount(output.layout))
        found.push(`${step.node}.${output.port} width`);
      held.set(output.slot, `${step.node}.${output.port}`);
    }
  }
  return found;
}

describe('slot reuse over generated graphs', () => {
  const SEEDS = Array.from({ length: 300 }, (_, index) => index * 7919 + 1);

  it('never lets one buffer be overwritten while a later step still has to read it', () => {
    for (const seed of SEEDS) {
      const described = randomGraph(seed);
      const planned = plan(described);
      expect(aliasingIn(planned, described), `seed ${String(seed)}`).toEqual([]);
    }
  });

  it('reuses slots, so a generated graph needs fewer slots than it has outputs', () => {
    const saved = SEEDS.map((seed) => {
      const planned = plan(randomGraph(seed));
      const outputs = planned.steps.reduce((total, step) => total + step.outputs.length, 0);
      return outputs - planned.slots.length;
    });
    expect(saved.every((one) => one >= 0)).toBe(true);
    expect(saved.some((one) => one > 0)).toBe(true);
  });

  it('makes the same plan from a graph whose edges are written in another order', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const described = randomGraph(seed);
      const draw = generator(seed + 1);
      const shuffled = [...described.edges];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const other = draw(index + 1);
        [shuffled[index], shuffled[other]] = [shuffled[other]!, shuffled[index]!];
      }
      expect(JSON.stringify(plan({ ...described, edges: shuffled })), `seed ${String(seed)}`).toBe(
        JSON.stringify(plan(described)),
      );
    }
  });

  it('makes the same plan from the same graph every time', () => {
    const described = randomGraph(42);
    expect(plan(structuredClone(described))).toEqual(plan(described));
  });
});
