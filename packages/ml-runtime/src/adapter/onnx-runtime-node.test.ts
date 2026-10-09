/**
 * The adapter over the real runtime, in Node: ONNX Runtime Web's WebAssembly
 * build runs here as it runs in a worker, so the port's contract is held
 * against real inference of a model built in the test, directly and through
 * the worker's client and core. The runtime's WebAssembly is served over HTTP
 * from this machine's loopback, as the application serves it from its own
 * origin, and read by the worker's own reader, so the request the worker makes
 * is the one it makes in a browser; the runtime runs the bytes that were read
 * and checked, and the test sees that it requests nothing itself.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { InferenceCapabilities, RuntimeSetup } from '../inference-options.js';
import { addModel } from '../testing/add-model.js';
import { TEST_ORIGIN, inProcessInference } from '../testing/in-process-worker.js';
import { PINNED, portContract, valueOf } from '../testing/port-contract.js';
import type { RuntimeFiles } from '../runtime-files.js';
import { OnnxRuntimeInference, loadOnnxRuntime } from './onnx-runtime.js';
import { OriginRuntimeFiles } from './origin-runtime-files.js';

/** The runtime's installed files. */
const RUNTIME_FILES = dirname(createRequire(import.meta.url).resolve('onnxruntime-web'));

const CPU_FILE = 'ort-wasm-simd-threaded.wasm';

/** The SHA-256 of the CPU build's WebAssembly file, as the build serving it would state it. */
const CPU_DIGEST = createHash('sha256')
  .update(readFileSync(join(RUNTIME_FILES, CPU_FILE)))
  .digest('hex');

/** What Node offers the runtime: SIMD. */
const NODE: InferenceCapabilities = { fixedWidthSimd: true };

/** Every path requested of the server. */
const requested: string[] = [];
/** How many times the worker's reader read a file, each one request of its own. */
let reads = 0;
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

function setupFor(
  capabilities: InferenceCapabilities,
  filesBase = `${origin}/`,
  cpuDigest = CPU_DIGEST,
): RuntimeSetup {
  return {
    filesBase,
    webAssemblySha256: cpuDigest,
    capabilities,
  };
}

/** The worker's reader over Node's own `fetch`, counting its reads. */
function countedFiles(filesBase: string): RuntimeFiles {
  const files = new OriginRuntimeFiles(filesBase);
  return {
    read: () => {
      reads += 1;
      return files.read();
    },
  };
}

function adapter(setup: RuntimeSetup): OnnxRuntimeInference {
  return new OnnxRuntimeInference(setup, {
    load: loadOnnxRuntime,
    files: countedFiles(setup.filesBase),
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
  model: addModel,
  timeout: 30_000,
});

portContract(
  "a thread's client, over the page's workers serving the adapter over the real runtime",
  {
    port: (capabilities) =>
      inProcessInference((setup) => adapter(setup), setupFor(capabilities), origin).inference,
    model: addModel,
    timeout: 30_000,
  },
);

describe('the real runtime', { timeout: 30_000 }, () => {
  it('names itself by its version and the digest of the WebAssembly file it runs', async () => {
    const session = valueOf(await adapter(setupFor(NODE)).open(addModel(), PINNED));
    expect(session.execution.runtime).toEqual({
      name: 'onnxruntime-web',
      version: '1.30.0',
      webAssemblySha256: CPU_DIGEST,
    });
    session.release();
  });

  it('requests nothing itself: every request was a read of the WebAssembly file by the worker’s reader', () => {
    expect(reads).toBeGreaterThan(0);
    expect(requested).toHaveLength(reads);
    expect(new Set(requested.map((path) => path.slice(path.lastIndexOf('/') + 1)))).toEqual(
      new Set([CPU_FILE]),
    );
  });

  it('refuses a WebAssembly file whose digest is not the setup’s, before the runtime has it', async () => {
    const opened = await adapter(setupFor(NODE, `${origin}/`, '0'.repeat(64))).open(
      addModel(),
      PINNED,
    );
    expect(opened.ok ? [] : opened.failures.map((one) => one.code)).toEqual([
      'inference.runtime-file-mismatch',
    ]);
    expect(opened.ok ? '' : opened.failures[0].summary).toContain(CPU_DIGEST);
  });

  it('answers a WebAssembly file the server does not have as unavailable', async () => {
    const opened = await adapter(setupFor(NODE, `${origin}/elsewhere/`)).open(addModel(), PINNED);
    expect(opened.ok ? [] : opened.failures.map((one) => one.code)).toEqual([
      'inference.runtime-file-unavailable',
    ]);
  });

  it("refuses runtime files from an origin that is not the worker's own", async () => {
    const port = inProcessInference(
      (setup) => adapter(setup),
      setupFor(NODE, 'https://cdn.example.com/onnxruntime/'),
      TEST_ORIGIN,
    ).inference;
    const opened = await port.open(addModel(), PINNED);
    expect(opened.ok ? [] : opened.failures.map((one) => one.code)).toEqual([
      'inference.worker-failed',
    ]);
    expect(opened.ok ? '' : opened.failures[0].summary).toMatch(/application's own origin/);
  });
});
