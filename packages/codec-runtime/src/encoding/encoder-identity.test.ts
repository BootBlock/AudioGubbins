import { PRODUCT_VERSION } from '@audiogubbins/version';
import { describe, expect, it } from 'vitest';

import {
  APPLICATION_ENCODER,
  FLACENC_ENCODER,
  MODULE_FLAC_ENCODER,
  ROPUS_ENCODER,
  browserEncoder,
} from './encoder-identity.js';

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

/** How `crates/codecs` pins each encoder's crate: an exact version, `=x.y.z`. */
const PINS = {
  flacenc: /^flacenc = \{ version = "=([^"]+)"/mu,
  ropus: /^ropus = "=([^"]+)"/mu,
} as const;

describe('the encoders an export names', () => {
  it('names the codec module’s encoders at the versions the codec crate pins', () => {
    const manifest = repositoryFile('crates/codecs/Cargo.toml');
    const flacenc = PINS.flacenc.exec(manifest)?.[1];
    const ropus = PINS.ropus.exec(manifest)?.[1];
    expect(flacenc).toBeDefined();
    expect(ropus).toBeDefined();
    expect(FLACENC_ENCODER).toEqual({
      implementation: 'codec-module',
      version: `flacenc ${String(flacenc)}`,
    });
    expect(ROPUS_ENCODER).toEqual({
      implementation: 'codec-module',
      version: `ropus ${String(ropus)}`,
    });
  });

  it('names AudioGubbins’ own encoders by the product’s release', () => {
    expect(APPLICATION_ENCODER.version).toBe(`AudioGubbins ${PRODUCT_VERSION}`);
    expect(MODULE_FLAC_ENCODER).toEqual({
      implementation: 'codec-module',
      version: `AudioGubbins ${PRODUCT_VERSION}`,
    });
  });

  it('names a browser’s encoder by its family and major version, or says it does not know', () => {
    expect(browserEncoder({ name: 'Edge', majorVersion: '130' })).toEqual({
      implementation: 'browser',
      version: 'WebCodecs (Edge) 130',
    });
    expect(browserEncoder(undefined)).toEqual({
      implementation: 'browser',
      version: 'WebCodecs, of a browser that does not say its version',
    });
  });
});
