import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { Connect, Plugin, ResolvedConfig } from 'vite';

import { RUNTIME_FILE } from '../../tools/inference-runtime-files.mjs';

/**
 * The inference runtime's WebAssembly, served by the application from its own
 * origin and identified by the bytes it ships (ADR-0062, REQ-AUDIO-139).
 *
 * The inference worker reads the runtime's CPU build's file from the files
 * base the page starts it with and checks it against the digest the page
 * states before the runtime is given it, so a render records the runtime that
 * really ran. That digest is taken here, from the very bytes the build serves,
 * never written by hand: the application imports it from
 * `virtual:audiogubbins/inference-runtime` with the path the file is served
 * under, which names the runtime's version, so a new runtime is a new path
 * rather than a file a browser may hold stale. The development server serves
 * the file from the installed runtime; a build writes it into its output,
 * which the build-output check reads back. No other file of the runtime's is
 * served: no session runs another build.
 */

/** What the application imports the runtime's identity as. */
export const INFERENCE_RUNTIME_ID = 'virtual:audiogubbins/inference-runtime';

/** The same, marked as no file on disk. */
const RESOLVED_INFERENCE_RUNTIME_ID = `\0${INFERENCE_RUNTIME_ID}`;

/** The runtime's WebAssembly file, as the build ships it. */
export interface ShippedRuntimeFile {
  readonly name: string;
  readonly bytes: Uint8Array;
  /** Of `bytes`, in lowercase hexadecimal. */
  readonly sha256: string;
}

/** The runtime as the build ships it. */
export interface ShippedRuntime {
  readonly version: string;
  /** Where the file is served, under the application's base, ending in `/`. */
  readonly path: string;
  readonly file: ShippedRuntimeFile;
}

/** The installed runtime's package folder, found from the package that depends on it. */
function installedRuntimeFolder(): string {
  const local = createRequire(import.meta.url);
  const entry = local.resolve('@audiogubbins/ml-runtime');
  const runtimeMain = createRequire(entry).resolve('onnxruntime-web');
  // The package's main is a file of its `dist` folder.
  return dirname(dirname(runtimeMain));
}

/** The runtime in `folder`, an installed `onnxruntime-web`, as a build ships it. */
export function shippedRuntime(folder: string): ShippedRuntime {
  const manifest: unknown = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
  const version: unknown =
    typeof manifest === 'object' && manifest !== null
      ? Reflect.get(manifest, 'version')
      : undefined;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error(`The inference runtime in ${folder} states no version.`);
  }
  const bytes = new Uint8Array(readFileSync(join(folder, 'dist', RUNTIME_FILE)));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return {
    version,
    path: `inference/onnxruntime-web-${version}/`,
    file: { name: RUNTIME_FILE, bytes, sha256 },
  };
}

/**
 * The module the application imports: the path from its origin's root the file
 * is served at, under the application's `base`, and its digest.
 */
export function runtimeModule(runtime: ShippedRuntime, base: string): string {
  return [
    `export const INFERENCE_RUNTIME_PATH = ${JSON.stringify(`${base}${runtime.path}`)};`,
    `export const INFERENCE_RUNTIME_VERSION = ${JSON.stringify(runtime.version)};`,
    `export const INFERENCE_RUNTIME_SHA256 = ${JSON.stringify(runtime.file.sha256)};`,
  ].join('\n');
}

/** Serves the file at `<base><path><name>`, as the build's output would. */
function runtimeMiddleware(runtime: ShippedRuntime, base: string): Connect.NextHandleFunction {
  const { file } = runtime;
  const served = `${base}${runtime.path}${file.name}`;
  return (request, response, next) => {
    const path = (request.url ?? '').split('?')[0] ?? '';
    if (path !== served || (request.method !== 'GET' && request.method !== 'HEAD')) {
      next();
      return;
    }
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/wasm');
    response.setHeader('Content-Length', String(file.bytes.length));
    response.end(request.method === 'HEAD' ? undefined : file.bytes);
  };
}

/** The plugin (see the module comment), over the runtime installed for the inference package. */
export function inferenceRuntime(folder: () => string = installedRuntimeFolder): Plugin {
  let runtime: ShippedRuntime | undefined;
  let config: ResolvedConfig | undefined;
  const shipped = (): ShippedRuntime => (runtime ??= shippedRuntime(folder()));
  return {
    name: 'audiogubbins:inference-runtime',
    configResolved(resolved) {
      config = resolved;
    },
    resolveId: (id) => (id === INFERENCE_RUNTIME_ID ? RESOLVED_INFERENCE_RUNTIME_ID : undefined),
    load: (id) =>
      id === RESOLVED_INFERENCE_RUNTIME_ID
        ? runtimeModule(shipped(), config?.base ?? '/')
        : undefined,
    configureServer(server) {
      server.middlewares.use(runtimeMiddleware(shipped(), server.config.base));
    },
    generateBundle() {
      const { path, file } = shipped();
      this.emitFile({ type: 'asset', fileName: `${path}${file.name}`, source: file.bytes });
    },
  };
}
