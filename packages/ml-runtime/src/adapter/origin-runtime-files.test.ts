import { describe, expect, it, vi } from 'vitest';

import type { DomainResult } from '@audiogubbins/domain';

import { RuntimeBuild } from '../inference-options.js';
import {
  OriginRuntimeFiles,
  type RuntimeFileFetch,
  type RuntimeFileResponse,
} from './origin-runtime-files.js';

const BASE = 'https://audiogubbins.test/runtime/';

function answering(response: RuntimeFileResponse) {
  return vi.fn<RuntimeFileFetch>(() => Promise.resolve(response));
}

function bodyOf(bytes: readonly number[]): RuntimeFileResponse {
  return { status: 200, arrayBuffer: () => Promise.resolve(new Uint8Array(bytes).buffer) };
}

function codesOf<TValue>(result: DomainResult<TValue>): readonly string[] {
  return result.ok ? [] : result.failures.map((one) => one.code);
}

describe('the runtime files read from the application’s own origin', () => {
  it('asks for the build’s file under the files base, with no credential, header, referrer or redirect, and nowhere but the origin', async () => {
    const request = answering(bodyOf([0, 97, 115, 109]));
    const files = new OriginRuntimeFiles(BASE, request);

    const cpu = await files.read(RuntimeBuild.Cpu);
    await files.read(RuntimeBuild.WebGpu);

    expect(cpu).toEqual({ ok: true, value: new Uint8Array([0, 97, 115, 109]) });
    const init = {
      method: 'GET',
      credentials: 'omit',
      mode: 'same-origin',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    };
    expect(request.mock.calls).toEqual([
      [`${BASE}ort-wasm-simd-threaded.wasm`, init],
      [`${BASE}ort-wasm-simd-threaded.asyncify.wasm`, init],
    ]);
  });

  it('calls the platform’s fetch as a function, which a browser refuses as a method of another object', async () => {
    // As a browser's own `fetch` does: called with anything but the global
    // scope, or nothing, as `this`, it throws "Illegal invocation".
    function platformFetch(this: unknown): Promise<RuntimeFileResponse> {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(bodyOf([0, 97, 115, 109]));
    }
    const files = new OriginRuntimeFiles(BASE, platformFetch);

    expect(await files.read(RuntimeBuild.Cpu)).toEqual({
      ok: true,
      value: new Uint8Array([0, 97, 115, 109]),
    });
  });

  it('answers a status other than 200 as the file being unavailable, with the status', async () => {
    const files = new OriginRuntimeFiles(BASE, answering({ ...bodyOf([1]), status: 404 }));
    const read = await files.read(RuntimeBuild.Cpu);
    expect(codesOf(read)).toEqual(['inference.runtime-file-unavailable']);
    expect(read.ok ? undefined : read.failures[0].details).toEqual({
      file: 'ort-wasm-simd-threaded.wasm',
      status: 404,
    });
  });

  it('answers a failure of the network, before or during the body, as the file being unavailable', async () => {
    const refused = new OriginRuntimeFiles(BASE, () =>
      Promise.reject(new TypeError('Failed to fetch')),
    );
    const broken = new OriginRuntimeFiles(
      BASE,
      answering({
        status: 200,
        arrayBuffer: () => Promise.reject(new TypeError('The connection was reset.')),
      }),
    );

    const before = await refused.read(RuntimeBuild.Cpu);
    expect(codesOf(before)).toEqual(['inference.runtime-file-unavailable']);
    expect(before.ok ? '' : before.failures[0].summary).toMatch(/Failed to fetch/);
    expect(codesOf(await broken.read(RuntimeBuild.Cpu))).toEqual([
      'inference.runtime-file-unavailable',
    ]);
  });
});
