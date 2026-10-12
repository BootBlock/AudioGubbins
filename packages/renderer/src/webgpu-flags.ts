/**
 * The WebGPU numbers and states the renderer names for itself, shared by what
 * it makes on a device.
 */

/// <reference types="@webgpu/types" />

/**
 * The buffer usage flags the backend asks for, by the values the WebGPU
 * specification fixes. The browser's `GPUBufferUsage`, `GPUTextureUsage` and
 * `GPUShaderStage` namespaces are globals, which the renderer does not read
 * (ADR-0044): it draws with the GPU object it is handed, and a device handed in
 * from anywhere else takes the same numbers.
 */
export const BufferUsage = { CopyDst: 0x08, Vertex: 0x20, Uniform: 0x40, Storage: 0x80 } as const;

/** The texture usage flags, by the specification's values, for the same reason. */
export const TextureUsage = { CopyDst: 0x02, TextureBinding: 0x04 } as const;

/** The shader stage flags, by the specification's values, for the same reason. */
export const ShaderStage = { Vertex: 0x1, Fragment: 0x2 } as const;

/** Straight alpha blended source-over, as every batch is drawn. */
export const STRAIGHT_ALPHA: GPUBlendState = {
  color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
};

/** Bytes between one draw's uniforms and the next: the smallest dynamic offset WebGPU allows. */
export const UNIFORM_STRIDE = 256;
