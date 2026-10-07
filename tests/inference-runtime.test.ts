import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RUNTIME_WEBASSEMBLY_FILES } from '../tools/check-build-output.mjs';
import { inRepository } from './repository.js';

/**
 * The build's statement of the inference runtime it serves (ADR-0062): the
 * digest of each WebAssembly file is taken from the bytes the build ships,
 * never written by hand, and the files are served at the path the statement
 * names, under the application's base, in a folder named by the runtime's
 * version. Run over a runtime folder made here, so what is stated is known
 * apart from the code under test. The module is loaded by a URL built at run
 * time, as the preview log's is, so the compiler leaves it to the root
 * project, which compiles it.
 */

/** A file of the runtime as the build ships it. */
interface ShippedFile {
  readonly build: string;
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

/** What this file calls of the module. */
interface InferenceRuntimeModule {
  readonly shippedRuntime: (folder: string) => {
    readonly path: string;
    readonly files: readonly ShippedFile[];
  };
  readonly runtimeModule: (
    runtime: ReturnType<InferenceRuntimeModule['shippedRuntime']>,
    base: string,
  ) => string;
  readonly inferenceRuntime: (folder: () => string) => {
    readonly configResolved?: unknown;
    readonly generateBundle?: unknown;
  };
}

function isModule(value: unknown): value is InferenceRuntimeModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    ['shippedRuntime', 'runtimeModule', 'inferenceRuntime'].every(
      (name) => typeof Reflect.get(value, name) === 'function',
    )
  );
}

const loaded: unknown = await import(
  pathToFileURL(inRepository('apps', 'web', 'inference-runtime.ts')).href
);
if (!isModule(loaded)) {
  throw new Error('apps/web/inference-runtime.ts no longer exports what the build calls.');
}
const { inferenceRuntime, runtimeModule, shippedRuntime } = loaded;

let folder: string;

/** The bytes made for each file of the runtime, by name. */
const BYTES = new Map([
  ['ort-wasm-simd-threaded.wasm', new Uint8Array([0, 97, 115, 109, 1, 2, 3])],
  ['ort-wasm-simd-threaded.asyncify.wasm', new Uint8Array([0, 97, 115, 109, 4, 5])],
]);

function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'audiogubbins-runtime-'));
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ version: '9.8.7' }));
  mkdirSync(join(folder, 'dist'));
  for (const [name, bytes] of BYTES) writeFileSync(join(folder, 'dist', name), bytes);
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe('the inference runtime a build serves', () => {
  it("states each build's SHA-256 from the bytes it ships, and the path it serves them at", () => {
    const runtime = shippedRuntime(folder);

    expect(runtime.path).toBe('inference/onnxruntime-web-9.8.7/');
    expect(runtime.files.map(({ build, name, sha256 }) => ({ build, name, sha256 }))).toEqual([
      {
        build: 'cpu',
        name: 'ort-wasm-simd-threaded.wasm',
        sha256: sha256Of(BYTES.get('ort-wasm-simd-threaded.wasm') ?? new Uint8Array()),
      },
      {
        build: 'webgpu',
        name: 'ort-wasm-simd-threaded.asyncify.wasm',
        sha256: sha256Of(BYTES.get('ort-wasm-simd-threaded.asyncify.wasm') ?? new Uint8Array()),
      },
    ]);
    // The files the build-output gate holds a build to are the ones it serves.
    expect(runtime.files.map(({ name }) => name)).toEqual([...RUNTIME_WEBASSEMBLY_FILES]);

    const stated = runtimeModule(runtime, '/sub/');
    expect(stated).toContain(
      'export const INFERENCE_RUNTIME_PATH = "/sub/inference/onnxruntime-web-9.8.7/";',
    );
    for (const { sha256 } of runtime.files) expect(stated).toContain(`"${sha256}"`);
  });

  it('writes each file into the output at the path it states', () => {
    const plugin = inferenceRuntime(() => folder);
    const emitted: { fileName?: string; source?: unknown }[] = [];
    const resolved = { base: '/' };
    if (typeof plugin.configResolved === 'function') {
      Reflect.apply(plugin.configResolved, {}, [resolved]);
    }
    if (typeof plugin.generateBundle !== 'function') throw new Error('The plugin writes no files.');
    Reflect.apply(
      plugin.generateBundle,
      {
        emitFile: (file: { fileName?: string; source?: unknown }) => {
          emitted.push(file);
          return '';
        },
      },
      [{}, {}, false],
    );

    expect(emitted.map(({ fileName }) => fileName)).toEqual([
      'inference/onnxruntime-web-9.8.7/ort-wasm-simd-threaded.wasm',
      'inference/onnxruntime-web-9.8.7/ort-wasm-simd-threaded.asyncify.wasm',
    ]);
    expect(emitted.map(({ source }) => source)).toEqual([...BYTES.values()]);
  });

  it('refuses a runtime that states no version, rather than serve it under a guessed path', () => {
    writeFileSync(join(folder, 'package.json'), JSON.stringify({ name: 'onnxruntime-web' }));
    expect(() => shippedRuntime(folder)).toThrow(/states no version/);
  });
});
