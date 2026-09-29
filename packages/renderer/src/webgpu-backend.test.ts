/**
 * The WebGPU backend, against a GPU object that records what it is asked, in a
 * host with no WebGPU of its own: made, drawing, and its device lost and
 * replaced. What it draws is read in a real browser by the renderer suites
 * under `tests/e2e`.
 */

import { describe, expect, it } from 'vitest';

import type { BackendEvents, RendererBackend } from './renderer-backend.js';
import { webGpuBackend } from './webgpu-backend.js';

/** A device that records its buffers and submissions, and is lost on demand. */
class FakeDevice extends EventTarget {
  readonly usages: number[] = [];
  readonly visibilities: number[] = [];
  submitted = 0;
  destroyed = false;
  /** The validation error each error scope pops, in order, where it pops one. */
  readonly refusals: (string | undefined)[] = [];
  #lose: (info: { reason: string; message: string }) => void = () => undefined;
  readonly lost = new Promise<{ reason: string; message: string }>((resolve) => {
    this.#lose = resolve;
  });
  readonly queue = {
    writeBuffer: (): void => undefined,
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
    return {};
  }

  createBindGroup(): object {
    return {};
  }

  createCommandEncoder(): object {
    const pass = {
      setPipeline: () => undefined,
      setVertexBuffer: () => undefined,
      setScissorRect: () => undefined,
      setBindGroup: () => undefined,
      draw: () => undefined,
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
): Promise<RendererBackend> {
  const result = await webGpuBackend(gpu).create(canvas, events);
  if (!result.ok) throw new Error(result.failures[0].summary);
  return result.value;
}

describe('the WebGPU backend', () => {
  it('asks for its buffers by the specification’s flags, reading no WebGPU global', async () => {
    const device = new FakeDevice();
    const { gpu, canvas, events } = fakeGpu([device]);

    await made(gpu, canvas, events);

    // Vertex and copy destination, and uniform and copy destination; the
    // uniforms are seen by the vertex and fragment stages.
    expect(new Set(device.usages)).toEqual(new Set([0x28, 0x48]));
    expect(device.visibilities).toEqual([0x3]);
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
