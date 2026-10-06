/**
 * The inference port over the real runtime, for the tests of what runs a
 * model, here and in the packages that do, held to the bits a pinned render
 * gives.
 *
 * ONNX Runtime Web's WebAssembly build runs in Node as it runs in the
 * inference worker. The test hands over the CPU build's WebAssembly, read
 * from wherever it keeps it, and the adapter checks it against the digest the
 * test states before the runtime has it, as it checks the file the
 * application serves, so a test that names a runtime build by its hash runs
 * on exactly that build or is refused. The device offers one thread and no
 * WebGPU: a pinned session's configuration, and nothing a preview could ask
 * for beyond it. Reading the file is the test's, so this support reaches no
 * Node module and compiles wherever the package's entry points do.
 */

import { succeed } from '@audiogubbins/domain';

import { ONNX_RUNTIME_BUILDS, OnnxRuntimeInference } from '../adapter/onnx-runtime.js';
import { RuntimeBuild } from '../inference-options.js';
import type { InferencePort } from '../inference-port.js';

/**
 * The real runtime's inference port, its CPU build's WebAssembly
 * `cpuWebAssembly`, which must have the SHA-256 `cpuSha256` (lower-case
 * hexadecimal), or every session is refused as
 * `inference.runtime-file-mismatch`.
 */
export function realInference(
  cpuWebAssembly: Uint8Array<ArrayBuffer>,
  cpuSha256: string,
): InferencePort {
  return new OnnxRuntimeInference(
    {
      // Never read: the files are handed over by the reader below.
      filesBase: 'file:///',
      // The WebGPU build is never started: the device offers no WebGPU.
      webAssemblySha256: { [RuntimeBuild.Cpu]: cpuSha256, [RuntimeBuild.WebGpu]: 'f'.repeat(64) },
      capabilities: { fixedWidthSimd: true, threads: 1, webGpu: false },
    },
    {
      load: ONNX_RUNTIME_BUILDS,
      files: { read: () => Promise.resolve(succeed(cpuWebAssembly.slice())) },
      reportFault: (error) => {
        throw error;
      },
    },
  );
}
