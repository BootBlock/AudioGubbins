import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { inRepository } from './repository.js';

/**
 * The model packs' catalogue on the application's own origin (ADR-0062): the
 * built packs, kept outside the repository, served read only in development
 * under the base's `packs/`, a resumed download's range answered as a static
 * host answers it, and copied into a build only when the build is told to.
 * The module is loaded by a URL built at run time, as the preview log's is,
 * so the compiler leaves it to the root project, which compiles it.
 */

/** What the plugin reads from the environment. */
type Environment = Readonly<Record<string, string>>;

/** The part of a plugin this file calls. */
interface ServingPlugin {
  readonly configResolved?: unknown;
  readonly configureServer?: unknown;
  readonly closeBundle?: unknown;
}

/** What this file calls of the module. */
interface PackServingModule {
  readonly catalogueModule: (environment: Environment, base: string) => string;
  readonly servedFile: (folder: string, prefix: string, url: string) => string | undefined;
  readonly modelPackServing: (environment: Environment) => ServingPlugin;
}

function isModule(value: unknown): value is PackServingModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    ['catalogueModule', 'servedFile', 'modelPackServing'].every(
      (name) => typeof Reflect.get(value, name) === 'function',
    )
  );
}

const loaded: unknown = await import(
  pathToFileURL(inRepository('apps', 'web', 'model-pack-serving.ts')).href
);
if (!isModule(loaded)) {
  throw new Error('apps/web/model-pack-serving.ts no longer exports what the build calls.');
}
const { catalogueModule, modelPackServing, servedFile } = loaded;

let cache: string;
let output: string;

beforeEach(() => {
  cache = mkdtempSync(join(tmpdir(), 'audiogubbins-pack-cache-'));
  output = mkdtempSync(join(tmpdir(), 'audiogubbins-pack-build-'));
  mkdirSync(join(cache, 'catalogue', 'sample-pack', '1.0.0'), { recursive: true });
  writeFileSync(join(cache, 'catalogue', 'catalogue.json'), '{"packs":[]}');
  writeFileSync(
    join(cache, 'catalogue', 'sample-pack', '1.0.0', 'model.onnx'),
    new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
  );
  writeFileSync(join(cache, 'secret.txt'), 'not served');
});

afterEach(() => {
  rmSync(cache, { recursive: true, force: true });
  rmSync(output, { recursive: true, force: true });
});

/** The plugin's development server middleware, served by a real HTTP server here. */
async function serving(base: string): Promise<{ server: Server; port: number }> {
  const plugin = modelPackServing({ AUDIOGUBBINS_PACK_CACHE: cache });
  let handler: ((req: unknown, res: unknown, next: () => void) => void) | undefined;
  const server = {
    config: { base },
    middlewares: { use: (used: typeof handler) => (handler = used) },
  };
  if (typeof plugin.configureServer !== 'function') throw new Error('The plugin serves nothing.');
  await Reflect.apply(plugin.configureServer, {}, [server]);
  const http = createServer((req, res) => {
    handler?.(req, res, () => {
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  return { server: http, port: (http.address() as AddressInfo).port };
}

function get(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Record<string, unknown>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, path, headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
        });
      });
    })
      .on('error', reject)
      .end();
  });
}

describe("the model packs' catalogue on the application's own origin", () => {
  it("is the base's packs/ unless the build names another absolute directory", () => {
    expect(catalogueModule({}, '/AudioGubbins/')).toContain('"/AudioGubbins/packs/"');
    expect(
      catalogueModule({ AUDIOGUBBINS_PACK_CATALOGUE: 'https://packs.example.com/v1/' }, '/'),
    ).toContain('"https://packs.example.com/v1/"');
    expect(() =>
      catalogueModule({ AUDIOGUBBINS_PACK_CATALOGUE: 'https://packs.example.com/v1' }, '/'),
    ).toThrow(/ending in a slash/);
  });

  it('serves a file of the built catalogue and nothing outside it', () => {
    const folder = join(cache, 'catalogue');
    expect(servedFile(folder, '/packs/', '/packs/catalogue.json?x=1')).toBe(
      join(folder, 'catalogue.json'),
    );
    expect(servedFile(folder, '/packs/', '/packs/../secret.txt')).toBeUndefined();
    expect(servedFile(folder, '/packs/', '/packs/%2e%2e/secret.txt')).toBeUndefined();
    expect(servedFile(folder, '/packs/', '/packs/%E0%A4%A')).toBeUndefined();
    expect(servedFile(folder, '/packs/', '/packs/sample-pack')).toBeUndefined();
    expect(servedFile(folder, '/packs/', '/elsewhere/catalogue.json')).toBeUndefined();
    expect(servedFile(folder, '/packs/', '/packs/sample-pack/1.0.0/model.onnx')).toBe(
      join(folder, 'sample-pack', '1.0.0', 'model.onnx'),
    );
  });

  it('refuses every path that escapes the folder, whatever form it takes', () => {
    const folder = join(cache, 'catalogue');
    const secret = join(cache, 'secret.txt');
    const below = (path: string): string => `/packs/${encodeURIComponent(path)}`;
    const escaping = [
      // A path on another drive, or this one, by its letter.
      'D:/secret.txt',
      secret,
      // The extended-length form, which a relative check took for another root
      // and served, the file existing.
      `\\\\?\\${secret}`,
      // A share, which a resolve alone would open a connection to.
      '\\\\example.test\\share\\secret.txt',
      // An absolute path from the root.
      '/secret.txt',
      // Climbing out from inside a pack.
      'sample-pack/1.0.0/../../../secret.txt',
    ];
    for (const path of escaping) {
      expect(servedFile(folder, '/packs/', below(path)), path).toBeUndefined();
    }
  });

  it('answers a whole file, and the rest of one from where a resumed download asks', async () => {
    const { server, port } = await serving('/app/');
    try {
      const whole = await get(port, '/app/packs/sample-pack/1.0.0/model.onnx');
      expect(whole.status).toBe(200);
      expect([...whole.body]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

      const rest = await get(port, '/app/packs/sample-pack/1.0.0/model.onnx', {
        Range: 'bytes=5-',
      });
      expect(rest.status).toBe(206);
      expect(rest.headers['content-range']).toBe('bytes 5-7/8');
      expect([...rest.body]).toEqual([6, 7, 8]);

      expect(
        (await get(port, '/app/packs/sample-pack/1.0.0/model.onnx', { Range: 'bytes=8-' })).status,
      ).toBe(416);
      expect((await get(port, '/app/packs/../secret.txt')).status).toBe(404);
    } finally {
      server.close();
    }
  });

  it('copies the built packs into a build only when told to, and refuses to finish without them', () => {
    const build = (environment: Environment) => {
      const plugin = modelPackServing(environment);
      if (typeof plugin.configResolved === 'function') {
        Reflect.apply(plugin.configResolved, {}, [
          { command: 'build', root: output, base: '/', build: { outDir: 'dist' } },
        ]);
      }
      if (typeof plugin.closeBundle === 'function') Reflect.apply(plugin.closeBundle, {}, []);
    };

    build({ AUDIOGUBBINS_PACK_CACHE: cache });
    expect(existsSync(join(output, 'dist', 'packs'))).toBe(false);

    build({ AUDIOGUBBINS_PACK_CACHE: cache, AUDIOGUBBINS_PACKS_IN_BUILD: '1' });
    expect(readFileSync(join(output, 'dist', 'packs', 'catalogue.json'), 'utf8')).toBe(
      '{"packs":[]}',
    );
    expect(existsSync(join(output, 'dist', 'packs', 'sample-pack', '1.0.0', 'model.onnx'))).toBe(
      true,
    );
    expect(existsSync(join(output, 'dist', 'secret.txt'))).toBe(false);

    expect(() => {
      build({ AUDIOGUBBINS_PACKS_IN_BUILD: '1' });
    }).toThrow(/names no cache/);
  });
});
