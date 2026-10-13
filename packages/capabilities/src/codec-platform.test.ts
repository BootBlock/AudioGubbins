import { codecCapability, type CodecEnvironment } from '@audiogubbins/codecs';
import { describe, expect, it } from 'vitest';

import { probeCodecs, readCodecPlatform } from './codec-platform.js';
import type { ConfigSupport, WebCodecsAudioConfig } from './config-support.js';

const CHROME_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** A stand-in for a class the probes only look for. */
function standIn(): () => undefined {
  return () => undefined;
}

/** A WebCodecs class whose `isConfigSupported` answers from `answer`, and records what it was asked. */
function codecClass(
  answer: (config: WebCodecsAudioConfig) => Promise<ConfigSupport>,
  asked: string[],
): unknown {
  return Object.assign(standIn(), {
    isConfigSupported: (config: WebCodecsAudioConfig): Promise<ConfigSupport> => {
      asked.push(config.codec);
      return answer(config);
    },
  });
}

/** Answers supported for the listed codec strings, unsupported for the rest. */
function supporting(codecs: readonly string[]) {
  return (config: WebCodecsAudioConfig): Promise<ConfigSupport> =>
    Promise.resolve({ supported: codecs.includes(config.codec) });
}

/** WebAssembly as a scope that compiles it offers it. */
const COMPILING = { Module: WebAssembly.Module };

describe('readCodecPlatform', () => {
  it('reads WebAssembly, the decoding and encoding classes and the browser from a scope', () => {
    const decoder = codecClass(supporting([]), []);
    const encoder = codecClass(supporting([]), []);
    const chunk = standIn();
    const data = standIn();
    const platform = readCodecPlatform({
      WebAssembly: COMPILING,
      AudioDecoder: decoder,
      EncodedAudioChunk: chunk,
      AudioEncoder: encoder,
      AudioData: data,
      navigator: { userAgent: CHROME_AGENT },
    });
    expect(platform.webAssembly).toBe(true);
    expect(platform.decoding).toEqual({ AudioDecoder: decoder, EncodedAudioChunk: chunk });
    expect(platform.encoding).toEqual({ AudioEncoder: encoder, AudioData: data });
    expect(platform.browser).toEqual({ name: 'Chrome', majorVersion: '131' });
  });

  it('offers nothing a scope lacks, and a pair of classes only whole', () => {
    const platform = readCodecPlatform({
      AudioDecoder: codecClass(supporting([]), []),
      AudioData: standIn(),
    });
    expect(platform).toEqual({
      webAssembly: false,
      decoding: undefined,
      encoding: undefined,
      browser: undefined,
    });
  });

  it('reads WebAssembly as absent where a policy refuses to compile', () => {
    const refusing = {
      Module: function Module(): never {
        throw new Error('Refused to compile by the page security policy.');
      },
    };
    expect(readCodecPlatform({ WebAssembly: refusing }).webAssembly).toBe(false);
  });

  it('reads a member a hardened browser refuses as absent', () => {
    const scope = Object.defineProperty({ WebAssembly: COMPILING }, 'AudioDecoder', {
      get: () => {
        throw new DOMException('Refused.', 'SecurityError');
      },
    });
    expect(readCodecPlatform(scope).decoding).toBeUndefined();
  });
});

describe('probeCodecs', () => {
  it('gives the environment codecCapability takes: HE-AAC decoded and AAC-LC encoded where probed', async () => {
    const asked: string[] = [];
    const platform = readCodecPlatform({
      WebAssembly: COMPILING,
      AudioDecoder: codecClass(supporting(['mp4a.40.5', 'mp4a.40.29', 'mp4a.40.2', 'opus']), asked),
      EncodedAudioChunk: standIn(),
      AudioEncoder: codecClass(supporting(['mp4a.40.2', 'opus']), asked),
      AudioData: standIn(),
    });
    const probes = await probeCodecs(platform);
    expect(probes.webAssembly).toBe(true);
    expect([...probes.browserDecoders]).toEqual(['he-aac', 'aac-lc', 'opus']);
    expect(probes.browserEncoders).toEqual(new Set(['aac-lc', 'opus']));
    expect(asked).toContain('flac');

    const environment: CodecEnvironment = {
      ...probes,
      codecModule: { kind: 'loaded' },
      encoderModules: new Map(),
    };
    expect(codecCapability(environment, 'he-aac', 'read')).toMatchObject({
      kind: 'available',
      implementation: 'browser',
    });
    expect(codecCapability(environment, 'aac-lc', 'write')).toMatchObject({ kind: 'available' });
  });

  it('counts HE-AAC only where both its forms decode', async () => {
    const platform = readCodecPlatform({
      AudioDecoder: codecClass(supporting(['mp4a.40.5']), []),
      EncodedAudioChunk: standIn(),
    });
    const probes = await probeCodecs(platform);
    expect(probes.browserDecoders.has('he-aac')).toBe(false);
    const environment: CodecEnvironment = {
      ...probes,
      codecModule: { kind: 'loaded' },
      encoderModules: new Map(),
    };
    const capability = codecCapability(environment, 'he-aac', 'read');
    expect(capability.kind).toBe('unavailable');
  });

  it('takes a configuration the browser holds invalid, or refuses, as unsupported', async () => {
    const platform = readCodecPlatform({
      AudioDecoder: codecClass(
        (config) =>
          config.codec === 'mp3'
            ? Promise.reject(new DOMException('Refused.', 'NotSupportedError'))
            : Promise.reject(new TypeError('Invalid configuration.')),
        [],
      ),
      EncodedAudioChunk: standIn(),
    });
    const probes = await probeCodecs(platform);
    expect(probes.browserDecoders.size).toBe(0);
  });

  it('raises a probe that fails other than by refusing', async () => {
    const platform = readCodecPlatform({
      AudioDecoder: codecClass(() => Promise.reject(new RangeError('A fault.')), []),
      EncodedAudioChunk: standIn(),
    });
    await expect(probeCodecs(platform)).rejects.toThrow(RangeError);
  });

  it('asks one configuration at a time', async () => {
    let open = 0;
    let most = 0;
    const platform = readCodecPlatform({
      AudioDecoder: codecClass(async () => {
        open += 1;
        most = Math.max(most, open);
        await Promise.resolve();
        open -= 1;
        return { supported: true };
      }, []),
      EncodedAudioChunk: standIn(),
    });
    await probeCodecs(platform);
    expect(most).toBe(1);
  });

  it('finds nothing where the browser has no WebCodecs', async () => {
    const probes = await probeCodecs(readCodecPlatform({ WebAssembly: COMPILING }));
    expect(probes).toEqual({
      webAssembly: true,
      browserDecoders: new Set(),
      browserEncoders: new Set(),
      browserBitRates: new Map(),
    });
  });
});
