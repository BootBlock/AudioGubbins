/**
 * The download: a `PackSource` over HTTP, and one of the two modules in the
 * repository that reach the network (ADR-0062; the network rule names it and
 * the read of the inference runtime's WebAssembly as its exceptions).
 *
 * It asks the catalogue the build configures, which the application's own
 * origin serves by default, for two things and nothing else: the catalogue,
 * `<catalogue>catalogue.json`, and a pack's file,
 * `<catalogue><id>/<version>/<path>`. Each request is a GET with no body, and
 * its only header is `Range`, sent to resume a file part way. It carries no
 * cookie or credential (`credentials: 'omit'`, not `'same-origin'`): the files
 * are public, and even on the application's own origin a cookie would say
 * something of the person that the request does not need. It sends no referrer,
 * which would name the page; it follows no redirect, which could take it to
 * another origin; and it skips the HTTP cache, which would keep a second copy
 * of every file. So no audio, no project data and nothing derived from either
 * leaves the device (REQ-AUDIO-138, REQ-PRIV-161).
 *
 * The platform's `fetch` is declared here by the shape this module uses, since
 * the package is compiled without a browser's definitions; tests inject one.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import { decodeUtf8 } from '@audiogubbins/project-format';

import type { ModelPackManifest } from '../manifest.js';
import { readPackCatalogue } from '../catalogue-reading.js';
import {
  sourceOverran,
  transferStopped,
  type FileRange,
  type PackSource,
  type ReceiveChunk,
} from '../pack-source.js';

/** Everything a request sends: there is no member for a body. */
export interface PackRequest {
  readonly method: 'GET';
  readonly headers: Readonly<Record<string, string>>;
  readonly credentials: 'omit';
  readonly cache: 'no-store';
  readonly redirect: 'error';
  readonly referrerPolicy: 'no-referrer';
  readonly signal: AbortSignal | null;
}

/** What a read of a response's body gives. */
export type PackBodyRead =
  | { readonly done: false; readonly value: Uint8Array<ArrayBuffer> }
  | { readonly done: true; readonly value?: undefined };

/** The part of a response's body stream this module reads. */
export interface PackBodyReader {
  read(): Promise<PackBodyRead>;
  cancel(reason?: unknown): Promise<void>;
}

/** The part of a response this module reads. */
export interface PackResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body: { getReader(): PackBodyReader } | null;
}

/** The part of the platform's `fetch` this module calls. */
export type PackFetch = (url: string, request: PackRequest) => Promise<PackResponse>;

declare const fetch: PackFetch;

/** The catalogue's file under the catalogue's URL. */
const CATALOGUE_FILE = 'catalogue.json';

/** The longest catalogue read, past which its text is refused unread. */
const LONGEST_CATALOGUE_BYTES = 4 * 1024 * 1024;

/** `bytes <first>-<last>/<length>`, as a partial response states its range. */
const CONTENT_RANGE = /^bytes (\d+)-(\d+)\/(\d+)$/u;

const HTTP_OK = 200;
const HTTP_PARTIAL = 206;
const HTTP_RANGE_NOT_SATISFIABLE = 416;

/** A request for `range` of headers, all else fixed. */
function requestOf(headers: Readonly<Record<string, string>>, signal?: AbortSignal): PackRequest {
  return {
    method: 'GET',
    headers,
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal: signal ?? null,
  };
}

function networkFailed(): DomainResult<never> {
  return fail(
    failure(
      'model-pack.network-failed',
      FailureKind.Retryable,
      'The catalogue could not be reached.',
    ),
  );
}

function unexpectedStatus(status: number): DomainResult<never> {
  return fail(
    failure(
      'model-pack.http-status',
      // A server error or a missing file may pass; what was kept stays good.
      FailureKind.Retryable,
      `The catalogue answered with status ${String(status)}.`,
      { details: { status } },
    ),
  );
}

function endedEarly(range: FileRange, received: number): DomainResult<never> {
  return fail(
    failure(
      'model-pack.transfer-ended-early',
      FailureKind.Retryable,
      `The transfer of ${range.file.path} ended before its last byte.`,
      { details: { file: range.file.path, receivedBytes: received } },
    ),
  );
}

function rangeRefused(range: FileRange): DomainResult<never> {
  return fail(
    failure(
      'model-pack.range-mismatch',
      FailureKind.IntegrityViolation,
      `The catalogue's ${range.file.path} is not the length its manifest states.`,
      { details: { file: range.file.path, expectedBytes: range.file.bytes } },
    ),
  );
}

/**
 * Whether a partial response's `Content-Range` is the range asked for, to the
 * end of a file of the manifest's length; a response that is not came from
 * another file.
 */
function isRangeAsked(contentRange: string | null, range: FileRange): boolean {
  const match = contentRange === null ? null : CONTENT_RANGE.exec(contentRange);
  if (match === null) return false;
  const [, first = '', last = '', length = ''] = match;
  return (
    Number(first) === range.offset &&
    Number(last) === range.file.bytes - 1 &&
    Number(length) === range.file.bytes
  );
}

/** A response, or the failure the platform gave instead. */
async function fetched(
  request: PackFetch,
  url: string,
  init: PackRequest,
  signal?: AbortSignal,
): Promise<DomainResult<PackResponse>> {
  try {
    return succeed(await request(url, init));
  } catch {
    // `fetch` rejects with the abort's reason or with a TypeError for every
    // failure of the network, and says nothing more of either; so the signal
    // tells a stop from a failure, and nothing else is there to catch.
    return signal?.aborted === true ? transferStopped() : networkFailed();
  }
}

/** The next read of a body, or the failure the platform gave instead. */
async function nextRead(
  reader: PackBodyReader,
  signal?: AbortSignal,
): Promise<DomainResult<PackBodyRead>> {
  try {
    return succeed(await reader.read());
  } catch {
    // As `fetched`: a body's read rejects on an abort or a broken connection.
    return signal?.aborted === true ? transferStopped() : networkFailed();
  }
}

/** The download from a catalogue over HTTP (see the module comment). */
export class HttpPackSource implements PackSource {
  private readonly base: string;
  private readonly request: PackFetch;

  /**
   * `catalogueUrl` is the absolute `http:` or `https:` URL of the catalogue's
   * directory, ending in `/`, with no credentials, query or fragment: the build
   * configures it, so another is a programmer error.
   */
  constructor(catalogueUrl: string, request: PackFetch = fetch) {
    const url = new URL(catalogueUrl);
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== '' ||
      !url.pathname.endsWith('/')
    ) {
      throw new RangeError(
        "A catalogue's URL is an absolute http or https directory, ending in a slash, with no credentials, query or fragment.",
      );
    }
    this.base = url.href;
    this.request = request;
  }

  async catalogue(signal?: AbortSignal): Promise<DomainResult<readonly ModelPackManifest[]>> {
    const response = await fetched(
      this.request,
      `${this.base}${CATALOGUE_FILE}`,
      requestOf({}, signal),
      signal,
    );
    if (!response.ok) return response;
    const { status, body } = response.value;
    if (status !== HTTP_OK || body === null) return unexpectedStatus(status);

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const read = await nextRead(reader, signal);
      if (!read.ok) return read;
      if (read.value.done) break;
      length += read.value.value.length;
      if (length > LONGEST_CATALOGUE_BYTES) {
        await reader.cancel();
        return fail(
          failure(
            'model-pack.catalogue-too-long',
            FailureKind.IntegrityViolation,
            'The catalogue is longer than a catalogue may be.',
            { details: { maximumBytes: LONGEST_CATALOGUE_BYTES } },
          ),
        );
      }
      chunks.push(read.value.value);
    }
    const whole = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) {
      whole.set(chunk, at);
      at += chunk.length;
    }
    const text = decodeUtf8(whole);
    return text.ok ? readPackCatalogue(text.value) : text;
  }

  async read(
    range: FileRange,
    receive: ReceiveChunk,
    signal?: AbortSignal,
  ): Promise<DomainResult<void>> {
    const resuming = range.offset > 0;
    const response = await fetched(
      this.request,
      this.urlOf(range),
      requestOf(resuming ? { Range: `bytes=${String(range.offset)}-` } : {}, signal),
      signal,
    );
    if (!response.ok) return response;
    const { status, headers, body } = response.value;

    // A server that ignores `Range` sends the whole file, whose first bytes
    // are those already kept; they are passed over rather than kept twice.
    let skip: number;
    if (resuming && status === HTTP_PARTIAL) {
      if (!isRangeAsked(headers.get('Content-Range'), range)) return rangeRefused(range);
      skip = 0;
    } else if (status === HTTP_OK) {
      skip = range.offset;
    } else if (status === HTTP_RANGE_NOT_SATISFIABLE) {
      return rangeRefused(range);
    } else {
      return unexpectedStatus(status);
    }
    if (body === null) return unexpectedStatus(status);

    const reader = body.getReader();
    const wanted = range.file.bytes - range.offset;
    let received = 0;
    for (;;) {
      const read = await nextRead(reader, signal);
      if (!read.ok) return read;
      if (read.value.done) break;
      let chunk = read.value.value;
      if (skip > 0) {
        const passed = Math.min(skip, chunk.length);
        skip -= passed;
        chunk = chunk.subarray(passed);
        if (chunk.length === 0) continue;
      }
      if (received + chunk.length > wanted) {
        await reader.cancel();
        return sourceOverran(range);
      }
      received += chunk.length;
      const taken = await receive(chunk);
      if (!taken.ok) {
        await reader.cancel();
        return taken;
      }
    }
    return received === wanted ? succeed(undefined) : endedEarly(range, range.offset + received);
  }

  /** The URL of a pack's file, each segment of its path encoded. */
  private urlOf(range: FileRange): string {
    const path = range.file.path.split('/').map(encodeURIComponent).join('/');
    return `${this.base}${encodeURIComponent(range.pack.id)}/${encodeURIComponent(range.pack.version)}/${path}`;
  }
}
