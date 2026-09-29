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
class FakeDevice {
  readonly usages: number[] = [];
  readonly visibilities: number[] = [];
  submitted = 0;
  destroyed = false;
  /** The validation error the next error scope pops, if any. */
  refusal: string | undefined;
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
    const refusal = this.refusal;
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
    configure: (configuration: { device: unknown }) => {
      configured.push(configuration.device);
    },
    getCurrentTexture: () => ({ createView: () => ({}) }),
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
  return { gpu, canvas, configured, events, said };
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
