import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RUNTIME_WEBASSEMBLY_FILE as PAGE_RUNTIME_FILE } from '@audiogubbins/ml-runtime';

import { RUNTIME_WEBASSEMBLY_FILE } from '../tools/check-build-output.mjs';
import { RUNTIME_FILE } from '../tools/inference-runtime-files.mjs';
import { inRepository } from './repository.js';

/**
 * The build's statement of the inference runtime it serves (ADR-0062): the
 * digest of its WebAssembly file is taken from the bytes the build ships, never
 * written by hand, and the file is served at the path the statement names,
 * under the application's base, in a folder named by the runtime's version. No
 * other file of the runtime's is shipped. Run over a runtime folder made here,
 * so what is stated is known apart from the code under test. The module is
 * loaded by a URL built at run time, as the preview log's is, so the compiler
 * leaves it to the root project, which compiles it.
 */

/** The runtime's file as the build ships it. */
interface ShippedFile {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

/** What this file calls of the module. */
interface InferenceRuntimeModule {
  readonly shippedRuntime: (folder: string) => {
    readonly path: string;
    readonly file: ShippedFile;
  };
  readonly runtimeModule: (
    runtime: ReturnType<InferenceRuntimeModule['shippedRuntime']>,
    base: string,
  ) => string;
  readonly inferenceRuntime: (folder: () => string) => {
    readonly configResolved?: unknown;
    readonly generateBundle?: unknown;
  };
  readonly runtimeBundleReferences?: unknown;
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

/** Stands in for a plugin the module does not make, so the case that calls it fails alone. */
function noPlugin(): never {
  throw new Error('apps/web/inference-runtime.ts makes no plugin for the runtime’s references.');
}

/** The hooks of the references plugin a case calls, typed by what they do. */
function pluginHooks(plugin: unknown): {
  readonly configResolved: (resolved: { readonly base: string }) => void;
  readonly transform: (code: string, id: string) => string;
} {
  const configResolved: unknown = Reflect.get(Object(plugin), 'configResolved');
  const transform: unknown = Reflect.get(Object(plugin), 'transform');
  if (typeof configResolved !== 'function' || typeof transform !== 'function') {
    throw new Error('The references plugin has no configResolved or transform hook.');
  }
  return {
    configResolved: (resolved) => {
      Reflect.apply(configResolved, {}, [resolved]);
    },
    transform: (code, id) => {
      const result: unknown = Reflect.apply(transform, {}, [code, id]);
      return typeof result === 'string' ? result : code;
    },
  };
}

let folder: string;

/**
 * The bytes made for each file of the installed runtime, by name: the CPU
 * build's, and the WebGPU build's, which the installed package also holds.
 */
const BYTES = new Map([
  ['ort-wasm-simd-threaded.wasm', new Uint8Array([0, 97, 115, 109, 1, 2, 3])],
  ['ort-wasm-simd-threaded.asyncify.wasm', new Uint8Array([0, 97, 115, 109, 4, 5])],
]);

const CPU_BYTES = BYTES.get('ort-wasm-simd-threaded.wasm') ?? new Uint8Array();

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
  it('ships the file the page asks for, the one build a session runs', () => {
    expect(RUNTIME_FILE).toBe(PAGE_RUNTIME_FILE);
  });

  it("states the file's SHA-256 from the bytes it ships, and the path it serves them at", () => {
    const runtime = shippedRuntime(folder);

    expect(runtime.path).toBe('inference/onnxruntime-web-9.8.7/');
    const { name, sha256 } = runtime.file;
    expect({ name, sha256 }).toEqual({
      name: 'ort-wasm-simd-threaded.wasm',
      sha256: sha256Of(CPU_BYTES),
    });
    // The file the build-output gate holds a build to is the one it serves.
    expect(name).toBe(RUNTIME_WEBASSEMBLY_FILE);

    const stated = runtimeModule(runtime, '/sub/');
    expect(stated).toContain(
      'export const INFERENCE_RUNTIME_PATH = "/sub/inference/onnxruntime-web-9.8.7/";',
    );
    expect(stated).toContain(`export const INFERENCE_RUNTIME_SHA256 = "${sha256}";`);
  });

  it('writes the CPU build’s file into the output at the path it states, and no other', () => {
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

    // The WebGPU build's 26.8 MB file was shipped though no session ran it.
    expect(emitted.map(({ fileName }) => fileName)).toEqual([
      'inference/onnxruntime-web-9.8.7/ort-wasm-simd-threaded.wasm',
    ]);
    expect(emitted.map(({ source }) => source)).toEqual([CPU_BYTES]);
  });

  it('names the served file where the runtime’s bundle named its own copy, so none is copied', () => {
    // The installed bundle, whose references to the file beside it the bundler
    // took for an asset: the build copied the 14 MB file into its assets. It is
    // found from the inference package, the one that depends on the runtime.
    const fromInference = createRequire(inRepository('packages', 'ml-runtime', 'package.json'));
    const bundle = readFileSync(
      join(dirname(fromInference.resolve('onnxruntime-web/wasm')), 'ort.wasm.bundle.min.mjs'),
      'utf8',
    );
    const asset = /new URL\((["'`])ort-wasm-simd-threaded\.wasm\1\s*,\s*import\.meta\.url\)/gu;
    expect(bundle.match(asset)?.length).toBeGreaterThan(0);

    const make = loaded.runtimeBundleReferences;
    const plugin: unknown =
      typeof make === 'function' ? Reflect.apply(make, undefined, [() => folder]) : noPlugin();
    const { configResolved, transform } = pluginHooks(plugin);
    configResolved({ base: '/sub/' });
    const served = transform(
      bundle,
      '/x/node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs',
    );

    expect(served.match(asset)).toBeNull();
    expect(served).toContain(
      'new URL("/sub/inference/onnxruntime-web-9.8.7/ort-wasm-simd-threaded.wasm", "" + import.meta.url)',
    );
    // Any other module is left as it is.
    expect(transform(bundle, '/x/src/other.ts')).toBe(bundle);
  });

  it('refuses a runtime that states no version, rather than serve it under a guessed path', () => {
    writeFileSync(join(folder, 'package.json'), JSON.stringify({ name: 'onnxruntime-web' }));
    expect(() => shippedRuntime(folder)).toThrow(/states no version/);
  });
});
