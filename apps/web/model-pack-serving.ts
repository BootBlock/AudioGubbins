import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, resolve } from 'node:path';

import type { Connect, Plugin, ResolvedConfig } from 'vite';

// By its path, not the package's name: this module is bundled with the
// configuration, and Node loads a package it names without a compiler.
import { cataloguePathProblem } from '../../packages/model-packs/src/pack-path.js';

/**
 * The model packs' catalogue, which the application's own origin serves by
 * default (ADR-0062): its URL as the build configures it, and the built packs
 * served under it in development and copied into a build only when asked.
 *
 * The packs are built outside the repository (`pnpm packs:build`), which holds
 * none of their files (REQ-REPO-191), into the folder `AUDIOGUBBINS_PACK_CACHE`
 * names, whose `catalogue/` is laid out as the catalogue's URL serves it. The
 * development server serves that folder, read only, under `<base>packs/`,
 * answering a resumed download's range as a static host does. A build copies it
 * into its output only where `AUDIOGUBBINS_PACKS_IN_BUILD` is `1`, since a
 * deployment ships packs by choice, and then refuses to finish without them.
 * The catalogue's URL is `<base>packs/` on the page's own origin unless
 * `AUDIOGUBBINS_PACK_CATALOGUE` names another, absolute, directory; the
 * application imports it from `virtual:audiogubbins/model-packs`.
 */

/** What the application imports the catalogue's URL as. */
export const MODEL_PACKS_ID = 'virtual:audiogubbins/model-packs';

const RESOLVED_MODEL_PACKS_ID = `\0${MODEL_PACKS_ID}`;

/** Where the catalogue is served under the application's base, by default. */
export const PACKS_PATH = 'packs/';

/** What the plugin reads from the environment. */
export interface PackServingEnvironment {
  /** The pack build's cache, whose `catalogue/` is served. */
  readonly AUDIOGUBBINS_PACK_CACHE?: string;
  /** `1` to copy the built packs into a build's output. */
  readonly AUDIOGUBBINS_PACKS_IN_BUILD?: string;
  /** An absolute catalogue URL, ending in `/`, in place of the page's own `packs/`. */
  readonly AUDIOGUBBINS_PACK_CATALOGUE?: string;
}

/** The media types of what a pack folder holds; anything else is bytes. */
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
};

/** `bytes=<first>-`, the only range a resumed download asks for. */
const OPEN_RANGE = /^bytes=(\d+)-$/u;

/** The built catalogue folder, or nothing where no cache is named. */
function catalogueFolder(environment: PackServingEnvironment): string | undefined {
  const cache = environment.AUDIOGUBBINS_PACK_CACHE;
  return cache === undefined || cache === '' ? undefined : resolve(cache, 'catalogue');
}

/**
 * The module the application imports: the catalogue's URL, absolute, or its
 * path from the origin's root under the application's `base`.
 */
export function catalogueModule(environment: PackServingEnvironment, base: string): string {
  const configured = environment.AUDIOGUBBINS_PACK_CATALOGUE;
  if (configured !== undefined && configured !== '') {
    const url = new URL(configured);
    if (!url.pathname.endsWith('/') || url.search !== '' || url.hash !== '') {
      throw new Error(
        'AUDIOGUBBINS_PACK_CATALOGUE is an absolute directory URL ending in a slash.',
      );
    }
    return `export const PACK_CATALOGUE = { kind: 'absolute', url: ${JSON.stringify(url.href)} };`;
  }
  return `export const PACK_CATALOGUE = { kind: 'own-origin', path: ${JSON.stringify(`${base}${PACKS_PATH}`)} };`;
}

/**
 * The file under `folder` a request's path names below `prefix`, or nothing
 * where it names none. The path is held to the pack path grammar before it
 * touches the file system, so another drive, `\\?\`, a share, an absolute
 * path or `..` is refused, not resolved: a check of the joined path missed
 * the first three on Windows, and a share opens a network connection.
 */
export function servedFile(folder: string, prefix: string, url: string): string | undefined {
  const path = url.split('?')[0] ?? '';
  if (!path.startsWith(prefix)) return undefined;
  let below: string;
  try {
    below = decodeURIComponent(path.slice(prefix.length));
  } catch (error) {
    // A path that is not percent-encoding names no file.
    if (!(error instanceof URIError)) throw error;
    return undefined;
  }
  if (cataloguePathProblem(below) !== undefined || isAbsolute(below)) return undefined;
  const file = resolve(folder, below);
  return existsSync(file) && statSync(file).isFile() ? file : undefined;
}

/** Serves the catalogue folder, read only, under `prefix`, with ranges. */
function packMiddleware(folder: string, prefix: string): Connect.NextHandleFunction {
  return (request, response, next) => {
    const file = servedFile(folder, prefix, request.url ?? '');
    if (file === undefined || (request.method !== 'GET' && request.method !== 'HEAD')) {
      next();
      return;
    }
    const size = statSync(file).size;
    const asked = OPEN_RANGE.exec(request.headers.range ?? '');
    const first = asked === null ? 0 : Number(asked[1]);
    if (first > size || (asked !== null && first === size && size > 0)) {
      response.statusCode = 416;
      response.setHeader('Content-Range', `bytes */${String(size)}`);
      response.end();
      return;
    }
    response.statusCode = asked === null ? 200 : 206;
    if (asked !== null) {
      response.setHeader(
        'Content-Range',
        `bytes ${String(first)}-${String(size - 1)}/${String(size)}`,
      );
    }
    response.setHeader('Content-Type', MEDIA_TYPES[extname(file)] ?? 'application/octet-stream');
    response.setHeader('Content-Length', String(size - first));
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'HEAD' || size === 0) {
      response.end();
      return;
    }
    createReadStream(file, { start: first }).pipe(response);
  };
}

/** The plugin (see the module comment), reading `environment`. */
export function modelPackServing(environment: PackServingEnvironment = process.env): Plugin {
  let config: ResolvedConfig | undefined;
  return {
    name: 'audiogubbins:model-pack-serving',
    configResolved(resolved) {
      config = resolved;
    },
    resolveId: (id) => (id === MODEL_PACKS_ID ? RESOLVED_MODEL_PACKS_ID : undefined),
    load: (id) =>
      id === RESOLVED_MODEL_PACKS_ID
        ? catalogueModule(environment, config?.base ?? '/')
        : undefined,
    configureServer(server) {
      const folder = catalogueFolder(environment);
      if (folder === undefined) return;
      server.middlewares.use(packMiddleware(folder, `${server.config.base}${PACKS_PATH}`));
    },
    closeBundle() {
      if (config?.command !== 'build' || environment.AUDIOGUBBINS_PACKS_IN_BUILD !== '1') return;
      const folder = catalogueFolder(environment);
      if (folder === undefined || !existsSync(join(folder, 'catalogue.json'))) {
        throw new Error(
          'AUDIOGUBBINS_PACKS_IN_BUILD asks for the built packs, but AUDIOGUBBINS_PACK_CACHE names no cache holding a catalogue.',
        );
      }
      cpSync(folder, resolve(config.root, config.build.outDir, PACKS_PATH), { recursive: true });
    },
  };
}
