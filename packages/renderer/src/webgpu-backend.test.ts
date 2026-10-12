/**
 * The WebGPU backend, against a GPU object that records what it is asked, in a
 * host with no WebGPU of its own: made, drawing, and its device lost and
 * replaced. What it draws is read in a real browser by the renderer suites
 * under `tests/e2e`.
 */

import { describe, expect, it } from 'vitest';

import { FieldLookups } from './field-pixels.js';
import type { ColourRamp, FieldBatch, RenderBatch, RenderFrame } from './render-frame.js';
import type { BackendEvents, RendererBackend } from './renderer-backend.js';
import { webGpuBackend } from './webgpu-device.js';

/** A texture as the fake device makes it: what it was asked for, and whether it is destroyed. */
interface FakeTexture {
  readonly format: string;
  readonly size: { readonly width: number; readonly height: number };
  destroyed: boolean;
}

/**
 * A device that records its buffers, textures, writes, passes and submissions,
 * and is lost on demand.
 */
class FakeDevice extends EventTarget {
  readonly usages: number[] = [];
  readonly visibilities: number[] = [];
  readonly textures: FakeTexture[] = [];
  /** Each texture written, with the bytes and their layout. */
  readonly textureWrites: { texture: unknown; data: unknown; layout: unknown }[] = [];
  /** Each buffer written, with what was written. */
  readonly bufferWrites: unknown[] = [];
  /** Every call on a render pass, by name and arguments. */
  readonly passCalls: unknown[][] = [];
  readonly pipelines: object[] = [];
  readonly limits = { maxTextureDimension2D: 8192 };
  submitted = 0;
  destroyed = false;
  /** The validation error each error scope pops, in order, where it pops one. */
  readonly refusals: (string | undefined)[] = [];
  #lose: (info: { reason: string; message: string }) => void = () => undefined;
  readonly lost = new Promise<{ reason: string; message: string }>((resolve) => {
    this.#lose = resolve;
  });
  readonly queue = {
    writeBuffer: (_buffer: unknown, _offset: number, data: unknown): void => {
      this.bufferWrites.push(data);
    },
    writeTexture: (destination: { texture: unknown }, data: unknown, layout: unknown): void => {
      this.textureWrites.push({ texture: destination.texture, data, layout });
    },
    submit: (): void => {
      this.submitted += 1;
    },
  };

  lose(message: string): void {
    this.#lose({ reason: 'unknown', message });
  }

  createBindGroupLayout(descriptor: { entries: { visibility: number }[] }): object {
    this.visibilities.push(...descriptor.entries.map((entry) => entry.visibility));
    return {};
  }

  createBuffer(descriptor: { size: number; usage: number }): object {
    this.usages.push(descriptor.usage);
    return { size: descriptor.size, destroy: () => undefined };
  }

  createShaderModule(): object {
    return {};
  }

  createPipelineLayout(): object {
    return {};
  }

  createRenderPipeline(): object {
    const pipeline = {};
    this.pipelines.push(pipeline);
    return pipeline;
  }

  createTexture(descriptor: { format: string; size: { width: number; height: number } }): object {
    const texture = {
      format: descriptor.format,
      size: descriptor.size,
      destroyed: false,
      destroy: () => {
        texture.destroyed = true;
      },
      createView: () => ({}),
    };
    this.textures.push(texture);
    return texture;
  }

  /** The field textures it has made, those not yet destroyed. */
  fieldTextures(): FakeTexture[] {
    return this.textures.filter((texture) => texture.format === 'r8unorm' && !texture.destroyed);
  }

  createBindGroup(): object {
    return {};
  }

  createCommandEncoder(): object {
    const record =
      (name: string) =>
      (...args: unknown[]): void => {
        this.passCalls.push([name, ...args]);
      };
    const pass = {
      setPipeline: record('setPipeline'),
      setVertexBuffer: record('setVertexBuffer'),
      setScissorRect: record('setScissorRect'),
      setBindGroup: record('setBindGroup'),
      draw: record('draw'),
      end: () => undefined,
    };
    return { beginRenderPass: () => pass, finish: () => ({}) };
  }

  pushErrorScope(): void {
    return undefined;
  }

  popErrorScope(): Promise<{ message: string } | null> {
    const refusal = this.refusals.shift();
    return Promise.resolve(refusal === undefined ? null : { message: refusal });
  }

  destroy(): void {
    this.destroyed = true;
  }
}

/** A GPU object whose adapter hands out the devices listed, then none. */
function fakeGpu(devices: FakeDevice[]) {
  const configured: unknown[] = [];
  const canvas = document.createElement('canvas');
  const context = {
    canvas,
    /** Why the canvas refuses a texture, where it does. */
    refusal: undefined as string | undefined,
    configure: (configuration: { device: unknown }) => {
      configured.push(configuration.device);
    },
    getCurrentTexture: () => {
      if (context.refusal !== undefined) throw new Error(context.refusal);
      return { createView: () => ({}) };
    },
  };
  canvas.getContext = ((kind: string) =>
    kind === 'webgpu' ? context : null) as HTMLCanvasElement['getContext'];
  const queue = [...devices];
  const adapter = { requestDevice: () => Promise.resolve(queue.shift()) };
  const gpu = {
    requestAdapter: () => Promise.resolve(queue.length === 0 ? null : adapter),
    getPreferredCanvasFormat: () => 'bgra8unorm',
  } as unknown as GPU;
  const said: string[] = [];
  const events: BackendEvents = {
    lost: (reason) => said.push(`lost: ${reason}`),
    restored: () => said.push('restored'),
    failed: (reason) => said.push(`failed: ${reason}`),
  };
  return { gpu, canvas, context, configured, events, said };
}

/** Lets every promise the backend is waiting on settle. */
function settled(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function made(
  gpu: GPU,
  canvas: HTMLCanvasElement,
  events: BackendEvents,
  fieldBudget?: number,
): Promise<RendererBackend> {
  const result = await webGpuBackend(gpu, fieldBudget).create(canvas, events);
  if (!result.ok) throw new Error(result.failures[0].summary);
  return result.value;
}

describe('the WebGPU backend', () => {
  it('asks for its buffers by the specification’s flags, reading no WebGPU global', async () => {
    const device = new FakeDevice();
    const { gpu, canvas, events } = fakeGpu([device]);

    await made(gpu, canvas, events);

    // Vertex and copy destination, uniform and copy destination, and storage
    // and copy destination for the fields' maps; the geometry's uniforms are
    // seen by the vertex and fragment stages, and the fields' bindings by the
    // fragment stage alone.
    expect(new Set(device.usages)).toEqual(new Set([0x28, 0x48, 0x88]));
    expect(device.visibilities).toEqual([0x3, 0x2, 0x2, 0x2]);
  });

  it('asks for another device when its device is lost, and draws on it', async () => {
    const first = new FakeDevice();
    const second = new FakeDevice();
    const { gpu, canvas, configured, events, said } = fakeGpu([first, second]);
    await made(gpu, canvas, events);

    first.lose('The device was destroyed.');
    await settled();

    expect(said).toEqual(['lost: The GPU device was lost: The device was destroyed.', 'restored']);
    expect(configured.at(-1)).toBe(second);
  });

  it('fails when the browser gives no adapter after the loss', async () => {
    const first = new FakeDevice();
    const { gpu, canvas, events, said } = fakeGpu([first]);
    await made(gpu, canvas, events);

    first.lose('The device was destroyed.');
    await settled();

    expect(said.at(-1)).toBe('failed: The browser gave no adapter after the loss.');
  });
});

describe('the WebGPU backend failing to draw', () => {
  it('fails, rather than saying it is restored, when the new device refuses the validation draw', async () => {
    const first = new FakeDevice();
    const second = new FakeDevice();
    // The pipeline passes; the draw with it does not.
    second.refusals.push(undefined, 'The texture belongs to a destroyed device.');
    const { gpu, canvas, events, said } = fakeGpu([first, second]);
    await made(gpu, canvas, events);

    first.lose('The device was destroyed.');
    await settled();

    expect(said).toEqual([
      'lost: The GPU device was lost: The device was destroyed.',
      'failed: The new GPU device refused a validation draw: The texture belongs to a destroyed device.',
    ]);
  });

  it('fails when its device reports an error no scope caught', async () => {
    const device = new FakeDevice();
    const { gpu, canvas, events, said } = fakeGpu([device]);
    await made(gpu, canvas, events);

    device.dispatchEvent(
      Object.assign(new Event('uncapturederror'), { error: { message: 'Invalid buffer.' } }),
    );

    expect(said).toEqual(['failed: The GPU device refused a draw: Invalid buffer.']);
  });

  it('answers a failed draw with the reason when the canvas gives it no texture', async () => {
    const { gpu, canvas, context, events } = fakeGpu([new FakeDevice()]);
    const backend = await made(gpu, canvas, events);
    context.refusal = 'The context is not configured.';

    expect(
      backend.draw({ width: 1, height: 1, pixelRatio: 1, clear: [0, 0, 0, 1], layers: [] }),
    ).toEqual({
      kind: 'failed',
      reason: 'The WebGPU draw was refused: The context is not configured.',
    });
  });
});

const RAMP: ColourRamp = { key: 'ramp', colours: new Uint8Array(1024) };

/**
 * A field `width` by `height` whose cells count up from 0, drawn across `at`
 * with a field column and a field row to each CSS pixel.
 */
function fieldOf(
  key: string,
  width: number,
  height: number,
  at: FieldBatch['at'] = { x: 0, y: 0, width, height },
): FieldBatch {
  return {
    kind: 'field',
    field: { key, width, height, values: Uint8Array.from({ length: width * height }, (_, i) => i) },
    ramp: RAMP,
    at,
    columns: { from: 0, to: at.width },
    rows: Float32Array.from({ length: Math.ceil(at.height) }, (_, i) => i),
  };
}

const RECTANGLE: RenderBatch = {
  kind: 'rectangles',
  colour: [1, 1, 1, 1],
  values: new Float32Array([0, 0, 1, 1]),
  count: 1,
};

/** A frame four CSS pixels by two at one device pixel to each, of one layer. */
function frameOf(batches: readonly RenderBatch[], clip?: FieldBatch['at']): RenderFrame {
  return {
    width: 4,
    height: 2,
    pixelRatio: 1,
    clear: [0, 0, 0, 1],
    layers: [clip === undefined ? { batches } : { clip, batches }],
  };
}

/** How many times `batch`'s field has gone up to `device`. */
function uploads(device: FakeDevice, batch: FieldBatch): number {
  return device.textureWrites.filter(({ data }) => data === batch.field.values).length;
}

/** The pass calls named `name` on `device`, by their arguments. */
function passed(device: FakeDevice, name: string): unknown[][] {
  return device.passCalls.filter(([called]) => called === name).map(([, ...args]) => args);
}

describe('the WebGPU backend drawing a field', () => {
  it('uploads a field once as one-byte textures and its ramp, and draws it over the pixels it paints', async () => {
    const device = new FakeDevice();
    const { gpu, canvas, events } = fakeGpu([device]);
    const backend = await made(gpu, canvas, events);
    const field = {
      ...fieldOf('a', 2, 2, { x: 0, y: 0, width: 4, height: 2 }),
      columns: { from: 0, to: 2 },
    };
    const frame = frameOf([field]);

    expect(backend.draw(frame)).toEqual({ kind: 'drawn' });

    expect(device.textures.map(({ format, size }) => [format, size.width, size.height])).toEqual([
      ['rgba8unorm', 256, 1],
      ['r8unorm', 2, 2],
    ]);
    expect(device.textureWrites.find(({ data }) => data === field.field.values)?.layout).toEqual({
      offset: 0,
      bytesPerRow: 2,
      rowsPerImage: 2,
    });
    // The column map, two device columns to each field column, then the row map.
    const maps = device.bufferWrites.find(
      (data) => data instanceof Float32Array && data.length === 6,
    );
    expect(maps instanceof Float32Array ? [...maps] : maps).toEqual([0, 0, 1, 1, 0, 1]);
    expect(passed(device, 'setScissorRect').at(-1)).toEqual([0, 0, 4, 2]);
    expect(passed(device, 'draw').at(-1)).toEqual([3]);

    backend.draw(frame);

    expect(uploads(device, field)).toBe(1);
    expect(device.textures).toHaveLength(2);
  });

  it('draws a field in its place among its layer’s geometry, which goes on in the layer’s scissor', async () => {
    const device = new FakeDevice();
    const { gpu, canvas, events } = fakeGpu([device]);
    const backend = await made(gpu, canvas, events);
    device.passCalls.length = 0;

    backend.draw(
      frameOf([RECTANGLE, fieldOf('a', 2, 2), RECTANGLE], { x: 0, y: 0, width: 3, height: 2 }),
    );

    const [geometry, field] = device.pipelines;
    const drawing = device.passCalls.flatMap(([name, ...args]) => {
      if (name === 'setPipeline')
        return [args[0] === geometry ? 'geometry' : args[0] === field ? 'field' : '?'];
      if (name === 'setScissorRect' || name === 'draw') return [`${name} ${args.join(' ')}`];
      return [];
    });
    expect(drawing).toEqual([
      'geometry',
      'setScissorRect 0 0 3 2',
      'draw 4 1',
      'field',
      'setScissorRect 0 0 2 2',
      'draw 3',
      'geometry',
      'setScissorRect 0 0 3 2',
      'draw 4 1',
    ]);
  });

  it('paints the device pixels the shared rule gives, by its scissor and origin', async () => {
    const device = new FakeDevice();
    const { gpu, canvas, events } = fakeGpu([device]);
    const backend = await made(gpu, canvas, events);
    const at = { x: 0.4, y: 0.2, width: 2.5, height: 2 };
    const clip = { x: 1.2, y: 0, width: 3, height: 3 };
    const frame: RenderFrame = {
      width: 4,
      height: 4,
      pixelRatio: 1.5,
      clear: [0, 0, 0, 1],
      layers: [{ clip, batches: [fieldOf('a', 4, 4, at)] }],
    };
    const span = new FieldLookups().pack(frame).placements[0]?.span;
    if (span === undefined) throw new Error('The frame holds one field.');

    backend.draw(frame);

    expect(span).toEqual({ left: 2, top: 0, width: 2, height: 3 });
    expect(passed(device, 'setScissorRect').at(-1)).toEqual([
      span.left,
      span.top,
      span.width,
      span.height,
    ]);
    const uniforms = device.bufferWrites.find((data) => data instanceof Int32Array);
    expect(uniforms instanceof Int32Array ? [...uniforms.subarray(0, 2)] : uniforms).toEqual([
      span.left,
      span.top,
    ]);
  });

  it('cuts a field wider and taller than the device takes into slices, and draws each', async () => {
    const device = new FakeDevice();
    device.limits.maxTextureDimension2D = 2;
    const { gpu, canvas, events } = fakeGpu([device]);
    const backend = await made(gpu, canvas, events);
    const field = fieldOf('a', 3, 3, { x: 0, y: 0, width: 3, height: 2 });
    device.passCalls.length = 0;

    backend.draw(frameOf([field]));

    expect(device.fieldTextures().map(({ size }) => [size.width, size.height])).toEqual([
      [2, 2],
      [1, 2],
      [2, 1],
      [1, 1],
    ]);
    // Each slice read from the field's own bytes, at its offset.
    expect(
      device.textureWrites
        .filter(({ data }) => data === field.field.values)
        .map(({ layout }) => layout),
    ).toEqual([
      { offset: 0, bytesPerRow: 3, rowsPerImage: 2 },
      { offset: 2, bytesPerRow: 3, rowsPerImage: 2 },
      { offset: 6, bytesPerRow: 3, rowsPerImage: 1 },
      { offset: 8, bytesPerRow: 3, rowsPerImage: 1 },
    ]);
    const offsets = passed(device, 'setBindGroup')
      .filter(([group]) => group === 0)
      .map(([, , dynamic]) => dynamic);
    expect(offsets).toEqual([[0], [256], [512], [768]]);
    expect(passed(device, 'draw')).toEqual([[3], [3], [3], [3]]);
  });

  it('keeps fields within its budget, letting the least recently drawn go first', async () => {
    const device = new FakeDevice();
    const { gpu, canvas, events } = fakeGpu([device]);
    const backend = await made(gpu, canvas, events, 8);
    const a = fieldOf('a', 2, 2);
    const b = fieldOf('b', 2, 2);
    const c = fieldOf('c', 2, 2);

    backend.draw(frameOf([a, b]));
    backend.draw(frameOf([c]));

    expect(device.fieldTextures()).toHaveLength(2);
    backend.draw(frameOf([b]));
    backend.draw(frameOf([a]));

    expect([uploads(device, a), uploads(device, b), uploads(device, c)]).toEqual([2, 1, 1]);
  });

  it('draws a field larger than its whole budget, then lets it go and keeps the rest', async () => {
    const device = new FakeDevice();
    const { gpu, canvas, events } = fakeGpu([device]);
    const backend = await made(gpu, canvas, events, 3);
    const small = fieldOf('small', 1, 1);
    const large = fieldOf('large', 2, 2);
    device.passCalls.length = 0;

    backend.draw(frameOf([small, large]));

    expect(passed(device, 'draw')).toEqual([[3], [3]]);
    expect(device.fieldTextures().map(({ size }) => size.width)).toEqual([1]);
    backend.draw(frameOf([small, large]));
    expect([uploads(device, small), uploads(device, large)]).toEqual([1, 2]);
  });

  it('uploads its fields to the device that takes the place of a lost one', async () => {
    const first = new FakeDevice();
    const second = new FakeDevice();
    const { gpu, canvas, events } = fakeGpu([first, second]);
    const backend = await made(gpu, canvas, events);
    const field = fieldOf('a', 2, 2);
    backend.draw(frameOf([field]));

    first.lose('The device was destroyed.');
    await settled();
    backend.draw(frameOf([field]));

    expect([uploads(first, field), uploads(second, field)]).toEqual([1, 1]);
    expect(second.fieldTextures()).toHaveLength(1);
  });

  it('makes no texture for a field it does not draw', async () => {
    const device = new FakeDevice();
    const { gpu, canvas, events } = fakeGpu([device]);
    const backend = await made(gpu, canvas, events);

    backend.draw(frameOf([fieldOf('off the canvas', 2, 2, { x: 5, y: 0, width: 2, height: 2 })]));
    backend.draw(frameOf([fieldOf('clipped away', 2, 2)], { x: 3, y: 0, width: 1, height: 2 }));
    backend.draw(frameOf([fieldOf('no cells', 0, 2)]));

    expect(device.textures).toEqual([]);
  });
});
