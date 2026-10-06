/**
 * The adapter over the real runtime, in Node: ONNX Runtime Web's WebAssembly
 * build runs here as it runs in a worker, so the port's contract is held
 * against real inference of a model built in the test, directly and through
 * the worker's client and core. The runtime's files are served over HTTP from
 * this machine's loopback, as the application serves them from its own
 * origin, so the request the runtime's loader makes is the one it makes in a
 * browser, and the test sees it.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  RuntimeBuild,
  type InferenceCapabilities,
  type RuntimeSetup,
} from '../inference-options.js';
import { addModelBytes } from '../testing/add-model.js';
import { InProcessWorker, TEST_ORIGIN } from '../testing/in-process-worker.js';
import { PINNED, portContract, valueOf } from '../testing/port-contract.js';
import { WorkerInference } from '../worker-inference.js';
import { ONNX_RUNTIME_BUILDS, OnnxRuntimeInference } from './onnx-runtime.js';

/** The runtime's installed files. */
const RUNTIME_FILES = dirname(createRequire(import.meta.url).resolve('onnxruntime-web'));

const CPU_FILE = 'ort-wasm-simd-threaded.wasm';

/** The SHA-256 of the CPU build's WebAssembly file, as the build serving it would state it. */
const CPU_DIGEST = createHash('sha256')
  .update(readFileSync(join(RUNTIME_FILES, CPU_FILE)))
  .digest('hex');

/** What Node offers the runtime: SIMD, and one thread, since nothing here is isolated. */
const NODE: InferenceCapabilities = { fixedWidthSimd: true, threads: 1, webGpu: false };

/** Every path the runtime requested of the server. */
const requested: string[] = [];
let server: Server | undefined;
let origin = '';

beforeAll(async () => {
  const serving = createServer((request, response) => {
    const path = request.url ?? '';
    requested.push(path);
    if (path !== `/${CPU_FILE}`) {
      response.writeHead(404).end();
      return;
    }
    response
      .writeHead(200, { 'content-type': 'application/wasm' })
      .end(readFileSync(join(RUNTIME_FILES, CPU_FILE)));
  });
  await new Promise<void>((resolve) => {
    serving.listen(0, '127.0.0.1', resolve);
  });
  const address = serving.address();
  if (address === null || typeof address === 'string') throw new Error('The server has no port.');
  origin = `http://127.0.0.1:${String(address.port)}`;
  server = serving;
});

afterAll(() => {
  server?.close();
});

function setupFor(capabilities: InferenceCapabilities, filesBase = `${origin}/`): RuntimeSetup {
  return {
    filesBase,
    // The WebGPU build is never started in Node, which has no WebGPU.
    webAssemblySha256: { [RuntimeBuild.Cpu]: CPU_DIGEST, [RuntimeBuild.WebGpu]: 'f'.repeat(64) },
    capabilities,
  };
}

function adapter(setup: RuntimeSetup): OnnxRuntimeInference {
  return new OnnxRuntimeInference(setup, {
    load: ONNX_RUNTIME_BUILDS,
    reportFault: (error) => {
      throw error;
    },
  });
}

// The runtime compiles its WebAssembly once in this thread, about a second
// alone and several times that under the whole suite's load, which the first
// test of whichever suite runs first waits for.
portContract('the adapter over the real runtime', {
  port: (capabilities) => adapter(setupFor(capabilities)),
  model: addModelBytes,
  timeout: 30_000,
});

portContract("the worker's client, over a worker serving the adapter over the real runtime", {
  port: (capabilities) =>
    new WorkerInference({
      createWorker: () => new InProcessWorker((setup) => adapter(setup), origin),
      setup: setupFor(capabilities),
    }),
  model: addModelBytes,
  timeout: 30_000,
});

describe('the real runtime', { timeout: 30_000 }, () => {
  it('names itself by its version and the digest of the WebAssembly file it runs', async () => {
    const session = valueOf(await adapter(setupFor(NODE)).open(addModelBytes(), PINNED));
    expect(session.execution.runtime).toEqual({
      name: 'onnxruntime-web',
      version: '1.30.0',
      webAssemblySha256: CPU_DIGEST,
    });
    session.release();
  });

  it('requests its WebAssembly file from the base it was given, and nothing else, once', () => {
    expect(requested).toEqual([`/${CPU_FILE}`]);
  });

  it("refuses runtime files from an origin that is not the worker's own", async () => {
    const port = new WorkerInference({
      createWorker: () => new InProcessWorker((setup) => adapter(setup), TEST_ORIGIN),
      setup: setupFor(NODE, 'https://cdn.example.com/onnxruntime/'),
    });
    const opened = await port.open(addModelBytes(), PINNED);
    expect(opened.ok ? [] : opened.failures.map((one) => one.code)).toEqual([
      'inference.worker-failed',
    ]);
    expect(opened.ok ? '' : opened.failures[0].summary).toMatch(/application's own origin/);
  });
});
