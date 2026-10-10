import { describe, expect, it } from 'vitest';

import { browserDecoder, moduleDecoder } from './decoder-identity.js';

/** The text of a file of the repository, read by Node's `fs` module. */
function repositoryFile(path: string): string {
  const host: unknown = Reflect.get(globalThis, 'process');
  const getBuiltinModule: unknown =
    typeof host === 'object' && host !== null ? Reflect.get(host, 'getBuiltinModule') : undefined;
  const fs: unknown =
    typeof getBuiltinModule === 'function'
      ? Reflect.apply(getBuiltinModule, host, ['node:fs'])
      : undefined;
  const cwd: unknown =
    typeof host === 'object' && host !== null ? Reflect.get(host, 'cwd') : undefined;
  const readFileSync: unknown =
    typeof fs === 'object' && fs !== null ? Reflect.get(fs, 'readFileSync') : undefined;
  if (typeof readFileSync !== 'function' || typeof cwd !== 'function') {
    throw new Error('The repository is read on Node.');
  }
  const root: unknown = Reflect.apply(cwd, host, []);
  const text: unknown = Reflect.apply(readFileSync, fs, [`${String(root)}/${path}`, 'utf8']);
  if (typeof text !== 'string') throw new Error(`${path} could not be read.`);
  return text;
}

/** How `crates/codecs` pins each decoder's crate: an exact version, `=x.y.z`. */
const PINS = {
  symphonia: /^symphonia = \{ version = "=([^"]+)"/mu,
  ropus: /^ropus = "=([^"]+)"/mu,
} as const;

describe('the decoders a rendition names', () => {
  it('names the codec module’s decoders at the versions the codec crate pins', () => {
    const manifest = repositoryFile('crates/codecs/Cargo.toml');
    const symphonia = PINS.symphonia.exec(manifest)?.[1];
    const ropus = PINS.ropus.exec(manifest)?.[1];
    expect(symphonia).toBeDefined();
    expect(ropus).toBeDefined();
    for (const codec of ['flac', 'alac', 'mp3', 'vorbis', 'aac-lc'] as const) {
      expect(moduleDecoder(codec)).toEqual({
        implementation: 'codec-module',
        name: 'Symphonia',
        version: symphonia,
      });
    }
    expect(moduleDecoder('opus')).toEqual({
      implementation: 'codec-module',
      name: 'ropus',
      version: ropus,
    });
  });

  it('names a browser’s decoder by its family and major version, or says it is unknown', () => {
    expect(browserDecoder({ name: 'Edge', majorVersion: '130' })).toEqual({
      implementation: 'browser',
      name: 'WebCodecs (Edge)',
      version: '130',
    });
    expect(browserDecoder(undefined)).toEqual({
      implementation: 'browser',
      name: 'WebCodecs',
      version: 'unknown',
    });
  });
});
