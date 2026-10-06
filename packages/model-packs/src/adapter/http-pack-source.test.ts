import { describe, expect, it } from 'vitest';

import { succeed, type DomainResult } from '@audiogubbins/domain';

import { manifestJson } from '../manifest-writing.js';
import { patterned, testPack } from '../testing/node-sha256.js';
import {
  HttpPackSource,
  type PackBodyRead,
  type PackFetch,
  type PackRequest,
  type PackResponse,
} from './http-pack-source.js';

const BASE = 'https://packs.example/catalogue/';
const PACK = testPack({
  files: { 'models/encoder.onnx': patterned(10, 1), 'decoder.onnx': patterned(7, 2) },
});
const ENCODER = firstOf(PACK.manifest.files);

function firstOf<TItem>(items: readonly TItem[]): TItem {
  const [first] = items;
  if (first === undefined) throw new Error('The list is empty.');
  return first;
}

/** What a request was: its URL and everything it sent. */
interface Sent {
  readonly url: string;
  readonly request: PackRequest;
}

/** A response of `status` whose body arrives in `chunks`, each a read. */
function response(
  status: number,
  chunks: readonly Uint8Array<ArrayBuffer>[],
  headers: Readonly<Record<string, string>> = {},
): PackResponse & { cancelled: boolean } {
  let next = 0;
  const answer = {
    status,
    cancelled: false,
    headers: { get: (name: string) => headers[name] ?? null },
    body: {
      getReader: () => ({
        read: (): Promise<PackBodyRead> => {
          const chunk = chunks[next];
          next += 1;
          return Promise.resolve(
            chunk === undefined ? { done: true } : { done: false, value: chunk },
          );
        },
        cancel: () => {
          answer.cancelled = true;
          return Promise.resolve();
        },
      }),
    },
  };
  return answer;
}

/** A `fetch` that records what it was sent and answers with `answer`. */
function recording(answer: (sent: Sent) => Promise<PackResponse>): {
  readonly fetch: PackFetch;
  readonly sent: Sent[];
} {
  const sent: Sent[] = [];
  return {
    sent,
    fetch: async (url, request) => {
      sent.push({ url, request });
      return await answer({ url, request });
    },
  };
}

/** Reads `offset` on of the encoder, keeping what arrives. */
async function readEncoder(
  source: HttpPackSource,
  offset: number,
  signal?: AbortSignal,
): Promise<{ readonly result: DomainResult<void>; readonly bytes: readonly number[] }> {
  const bytes: number[] = [];
  const result = await source.read(
    { pack: PACK.manifest, file: ENCODER, offset },
    (chunk) => {
      bytes.push(...chunk);
      return Promise.resolve(succeed(undefined));
    },
    signal,
  );
  return { result, bytes };
}

function codes<TValue>(result: DomainResult<TValue>): readonly string[] {
  return result.ok ? [] : result.failures.map((failure) => failure.code);
}

const ENCODER_BYTES = PACK.files.get('models/encoder.onnx') ?? new Uint8Array();

/** Everything a request may send: a GET, no body, no credential, no referrer, no redirect. */
function only(headers: Readonly<Record<string, string>>, signal: AbortSignal | null = null) {
  return {
    method: 'GET',
    headers,
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal,
  };
}

describe('the download over HTTP', () => {
  it('asks for the catalogue at the configured URL, sending nothing else', async () => {
    const text = JSON.stringify({ format: 1, packs: [manifestJson(PACK.manifest)] });
    const { fetch, sent } = recording(() =>
      Promise.resolve(response(200, [new TextEncoder().encode(text)])),
    );
    const source = new HttpPackSource(BASE, fetch);

    expect(await source.catalogue()).toEqual({ ok: true, value: [PACK.manifest] });
    expect(sent).toEqual([{ url: `${BASE}catalogue.json`, request: only({}) }]);
    expect(Object.keys(sent[0]?.request ?? {})).not.toContain('body');
  });

  it('refuses a catalogue that is not one, or longer than a catalogue may be', async () => {
    const hostile = new HttpPackSource(
      BASE,
      recording(() => Promise.resolve(response(200, [new TextEncoder().encode('{"packs": 1')])))
        .fetch,
    );
    expect((await hostile.catalogue()).ok).toBe(false);

    const megabyte = new Uint8Array(1024 * 1024).fill(0x20);
    const endless = recording(() =>
      Promise.resolve(
        response(
          200,
          Array.from({ length: 5 }, () => megabyte),
        ),
      ),
    );
    expect(codes(await new HttpPackSource(BASE, endless.fetch).catalogue())).toEqual([
      'model-pack.catalogue-too-long',
    ]);
  });

  it('asks for a file at its pack’s path, with no range from the start', async () => {
    const { fetch, sent } = recording(() =>
      Promise.resolve(response(200, [ENCODER_BYTES.slice(0, 4), ENCODER_BYTES.slice(4)])),
    );
    const { result, bytes } = await readEncoder(new HttpPackSource(BASE, fetch), 0);

    expect(result.ok).toBe(true);
    expect(bytes).toEqual([...ENCODER_BYTES]);
    expect(sent).toEqual([
      { url: `${BASE}sample-pack/1.0.0/models/encoder.onnx`, request: only({}) },
    ]);
  });

  it('resumes with a Range header, and takes the partial response that range is', async () => {
    const { fetch, sent } = recording(() =>
      Promise.resolve(response(206, [ENCODER_BYTES.slice(6)], { 'Content-Range': 'bytes 6-9/10' })),
    );
    const controller = new AbortController();
    const { result, bytes } = await readEncoder(
      new HttpPackSource(BASE, fetch),
      6,
      controller.signal,
    );

    expect(result.ok).toBe(true);
    expect(bytes).toEqual([...ENCODER_BYTES.slice(6)]);
    expect(sent.map((one) => one.request)).toEqual([
      only({ Range: 'bytes=6-' }, controller.signal),
    ]);
  });

  it('refuses a partial response of another range or another file', async () => {
    for (const contentRange of ['bytes 5-9/10', 'bytes 6-10/11', 'bytes 6-9/*', undefined]) {
      const { fetch } = recording(() =>
        Promise.resolve(
          response(
            206,
            [ENCODER_BYTES.slice(6)],
            contentRange === undefined ? {} : { 'Content-Range': contentRange },
          ),
        ),
      );
      const { result, bytes } = await readEncoder(new HttpPackSource(BASE, fetch), 6);
      expect(codes(result)).toEqual(['model-pack.range-mismatch']);
      expect(bytes).toEqual([]);
    }
  });

  it('passes over what is kept where the server ignores the range', async () => {
    const { fetch } = recording(() =>
      Promise.resolve(response(200, [ENCODER_BYTES.slice(0, 4), ENCODER_BYTES.slice(4)])),
    );
    const { result, bytes } = await readEncoder(new HttpPackSource(BASE, fetch), 6);
    expect(result.ok).toBe(true);
    expect(bytes).toEqual([...ENCODER_BYTES.slice(6)]);
  });

  it('stops a file that runs past its manifest’s length, as another file', async () => {
    const answer = response(200, [ENCODER_BYTES, new Uint8Array([1])]);
    const { result } = await readEncoder(
      new HttpPackSource(BASE, recording(() => Promise.resolve(answer)).fetch),
      0,
    );
    expect(codes(result)).toEqual(['model-pack.source-overran']);
    expect(result.ok ? undefined : result.failures[0].kind).toBe('integrity-violation');
    expect(answer.cancelled).toBe(true);
  });

  it('says a transfer that ended early may be resumed', async () => {
    const { fetch } = recording(() => Promise.resolve(response(200, [ENCODER_BYTES.slice(0, 7)])));
    const { result, bytes } = await readEncoder(new HttpPackSource(BASE, fetch), 0);
    expect(codes(result)).toEqual(['model-pack.transfer-ended-early']);
    expect(result.ok ? undefined : result.failures[0].kind).toBe('retryable');
    expect(bytes).toHaveLength(7);
  });

  it('answers a failed network, a status and an abort as results', async () => {
    const broken = recording(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(codes((await readEncoder(new HttpPackSource(BASE, broken.fetch), 0)).result)).toEqual([
      'model-pack.network-failed',
    ]);

    const missing = recording(() => Promise.resolve(response(404, [])));
    expect(codes((await readEncoder(new HttpPackSource(BASE, missing.fetch), 0)).result)).toEqual([
      'model-pack.http-status',
    ]);
    expect(
      codes(
        (
          await readEncoder(
            new HttpPackSource(BASE, recording(() => Promise.resolve(response(416, []))).fetch),
            3,
          )
        ).result,
      ),
    ).toEqual(['model-pack.range-mismatch']);

    const controller = new AbortController();
    const aborting = recording(() => {
      controller.abort();
      return Promise.reject(new Error('aborted'));
    });
    expect(
      codes(
        (await readEncoder(new HttpPackSource(BASE, aborting.fetch), 0, controller.signal)).result,
      ),
    ).toEqual(['model-pack.transfer-stopped']);
  });

  it('stops reading where the receiver refuses a chunk', async () => {
    const answer = response(200, [ENCODER_BYTES.slice(0, 4), ENCODER_BYTES.slice(4)]);
    const source = new HttpPackSource(BASE, recording(() => Promise.resolve(answer)).fetch);
    const refusal = {
      ok: false,
      failures: [{ code: 'full', kind: 'retryable', summary: 'Full.' }],
    } as const;
    const result = await source.read({ pack: PACK.manifest, file: ENCODER, offset: 0 }, () =>
      Promise.resolve(refusal),
    );
    expect(result).toEqual(refusal);
    expect(answer.cancelled).toBe(true);
  });

  it.each([
    ['a relative URL', '/catalogue/'],
    ['another scheme', 'ftp://packs.example/'],
    ['credentials', 'https://user:secret@packs.example/'],
    ['a query', 'https://packs.example/?who=me'],
    ['a fragment', 'https://packs.example/#here'],
    ['no closing slash', 'https://packs.example/catalogue'],
  ])('refuses a catalogue URL with %s', (_case, url) => {
    expect(
      () => new HttpPackSource(url, recording(() => Promise.reject(new Error())).fetch),
    ).toThrow();
  });
});
