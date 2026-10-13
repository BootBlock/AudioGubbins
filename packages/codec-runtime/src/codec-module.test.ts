import { describe, expect, it } from 'vitest';

import { readCodecExports } from './codec-exports.js';
import { instantiateCodecModule } from './codec-module.js';
import { codecModuleBytes } from './testing/codec-module.js';

/** The real module's exports, instantiated with a read that reads nothing. */
async function realExports(): Promise<Record<string, unknown>> {
  const { instance } = await WebAssembly.instantiate(codecModuleBytes(), {
    audiogubbins_codecs: { ag_codec_read: () => -1 },
  });
  return { ...instance.exports };
}

describe('the codec module', () => {
  it('instantiates from its bytes and from its compiled form', async () => {
    const fromBytes = await instantiateCodecModule(codecModuleBytes());
    expect(fromBytes.ok).toBe(true);
    const compiled = await WebAssembly.compile(codecModuleBytes());
    const fromModule = await instantiateCodecModule(compiled);
    expect(fromModule.ok).toBe(true);
  });

  it('speaks the ABI version this runtime speaks', async () => {
    expect(readCodecExports(await realExports()).ok).toBe(true);
  });

  it('refuses a module of another ABI version, naming both', async () => {
    const real = await realExports();
    const version = real['ag_codec_abi_version'];
    const spoken =
      typeof version === 'function' ? Number(Reflect.apply(version, undefined, [])) : Number.NaN;
    const exports = { ...real, ag_codec_abi_version: () => spoken + 1 };
    const read = readCodecExports(exports);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.failures[0].code).toBe('codec-runtime.module-abi-mismatch');
    expect(read.failures[0].details).toEqual({ module: spoken + 1, runtime: spoken });
    expect(read.failures[0].summary).toContain(String(spoken + 1));
  });

  it('names every export a module lacks', async () => {
    const { ag_decoder_open: _open, memory: _memory, ...rest } = await realExports();
    const read = readCodecExports(rest);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.failures[0].code).toBe('codec-runtime.module-exports-missing');
    expect(read.failures[0].details).toEqual({ missing: 'memory, ag_decoder_open' });
    expect(readCodecExports(undefined).ok).toBe(false);
  });

  it('refuses bytes that are not the module', async () => {
    const refused = await instantiateCodecModule(new Uint8Array([0, 97, 115, 109, 9, 9, 9, 9]));
    expect(refused.ok ? undefined : refused.failures[0].code).toBe(
      'codec-runtime.module-instantiation-failed',
    );
  });
});
