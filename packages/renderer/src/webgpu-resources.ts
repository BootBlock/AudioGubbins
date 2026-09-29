/**
 * What the WebGPU backend makes on a device: its shader, pipeline, bind group
 * and buffers, made again whole on a new device after a loss (ADR-0044).
 */

/// <reference types="@webgpu/types" />

const SHADER = /* wgsl */ `
struct Batch { scale: vec2f, mode: f32, halfWidth: f32, colour: vec4f };
@group(0) @binding(0) var<uniform> batch: Batch;

@vertex
fn vertexMain(@location(0) corner: vec2f, @location(1) instance: vec4f) -> @builtin(position) vec4f {
  var point: vec2f;
  if (batch.mode < 0.5) {
    point = instance.xy + corner * instance.zw;
  } else {
    let along = instance.zw - instance.xy;
    let size = max(length(along), 0.0001);
    let normal = vec2f(-along.y, along.x) / size * batch.halfWidth;
    point = mix(instance.xy, instance.zw, corner.x) + normal * (corner.y * 2.0 - 1.0);
  }
  return vec4f(point * batch.scale + vec2f(-1.0, 1.0), 0.0, 1.0);
}

@fragment
fn fragmentMain() -> @location(0) vec4f {
  return batch.colour;
}
`;

/** Bytes between one batch's uniforms and the next: the smallest dynamic offset WebGPU allows. */
export const UNIFORM_STRIDE = 256;

/**
 * The buffer usage flags the backend asks for, by the values the WebGPU
 * specification fixes. The browser's `GPUBufferUsage` and `GPUShaderStage`
 * namespaces are globals, which the renderer does not read (ADR-0044): it draws
 * with the GPU object it is handed, and a device handed in from anywhere else
 * takes the same numbers.
 */
const BufferUsage = { CopyDst: 0x08, Vertex: 0x20, Uniform: 0x40 } as const;

/** The shader stage flags, by the specification's values, for the same reason. */
const ShaderStage = { Vertex: 0x1, Fragment: 0x2 } as const;

/** A device's pipeline and buffers, made again on a new device. */
export interface Resources {
  readonly device: GPUDevice;
  readonly pipeline: GPURenderPipeline;
  readonly layout: GPUBindGroupLayout;
  readonly corners: GPUBuffer;
  uniforms: GPUBuffer;
  group: GPUBindGroup;
  instances: GPUBuffer;
}

/** The pipeline that draws every batch: a unit quad per instance, blended over what is there. */
function pipelineFor(
  device: GPUDevice,
  format: GPUTextureFormat,
  layout: GPUBindGroupLayout,
): GPURenderPipeline {
  const module = device.createShaderModule({ code: SHADER });
  return device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: {
      module,
      entryPoint: 'vertexMain',
      buffers: [
        { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
        {
          arrayStride: 16,
          stepMode: 'instance',
          attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x4' }],
        },
      ],
    },
    fragment: {
      module,
      entryPoint: 'fragmentMain',
      targets: [
        {
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-strip' },
  });
}

/** Everything the backend draws with on `device`. */
export function build(device: GPUDevice, format: GPUTextureFormat): Resources {
  const layout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: ShaderStage.Vertex | ShaderStage.Fragment,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 32 },
      },
    ],
  });
  const corners = device.createBuffer({
    size: 32,
    usage: BufferUsage.Vertex | BufferUsage.CopyDst,
  });
  device.queue.writeBuffer(corners, 0, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]));
  const uniforms = uniformBuffer(device, 16);
  return {
    device,
    pipeline: pipelineFor(device, format, layout),
    layout,
    corners,
    uniforms,
    group: bindGroup(device, layout, uniforms),
    instances: instanceBuffer(device, 4096),
  };
}

/** A vertex buffer with room for `instances` instances of four floats. */
export function instanceBuffer(device: GPUDevice, instances: number): GPUBuffer {
  return device.createBuffer({
    size: 16 * instances,
    usage: BufferUsage.Vertex | BufferUsage.CopyDst,
  });
}

/** A uniform buffer with a slot for each of `batches` batches. */
export function uniformBuffer(device: GPUDevice, batches: number): GPUBuffer {
  return device.createBuffer({
    size: UNIFORM_STRIDE * batches,
    usage: BufferUsage.Uniform | BufferUsage.CopyDst,
  });
}

/** The bind group over `uniforms`, one batch's slot at a time. */
export function bindGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  uniforms: GPUBuffer,
): GPUBindGroup {
  return device.createBindGroup({
    layout,
    entries: [{ binding: 0, resource: { buffer: uniforms, size: 32 } }],
  });
}
