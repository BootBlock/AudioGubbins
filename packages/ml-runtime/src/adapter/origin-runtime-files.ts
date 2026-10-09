/**
 * The runtime's WebAssembly file, read from the application's own origin:
 * one of the two modules in the repository that reach the network (ADR-0062;
 * the network rule names it and the model pack download as its exceptions).
 *
 * It asks for one thing and nothing else: the file, `<filesBase><file name>`,
 * where the files base is the one the application started the inference worker
 * with, which the worker has already held to its own origin. The request is a
 * GET with no body and no header of its own. It carries no cookie or credential
 * (`credentials: 'omit'`): the file is public, and a cookie would say something
 * of the person that the request does not need. It may go nowhere but the
 * origin (`mode: 'same-origin'`), it follows no redirect, and it sends no
 * referrer, which would name the page. So the request says nothing of the
 * person or their audio (REQ-AUDIO-138, REQ-PRIV-161), and what it answers is
 * checked by the adapter before the runtime is given it.
 *
 * The platform's `fetch` is declared here by the shape this module uses, since
 * the package is compiled without a browser's definitions; tests inject one.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';

import { RUNTIME_WEBASSEMBLY_FILE, type RuntimeFiles } from '../runtime-files.js';

/** Everything a request sends: there is no member for a body or a header. */
export interface RuntimeFileRequest {
  readonly method: 'GET';
  readonly credentials: 'omit';
  readonly mode: 'same-origin';
  readonly redirect: 'error';
  readonly referrerPolicy: 'no-referrer';
}

/** The part of a response this module reads. */
export interface RuntimeFileResponse {
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** The part of the platform's `fetch` this module calls. */
export type RuntimeFileFetch = (
  url: string,
  request: RuntimeFileRequest,
) => Promise<RuntimeFileResponse>;

declare const fetch: RuntimeFileFetch;

const REQUEST: RuntimeFileRequest = {
  method: 'GET',
  credentials: 'omit',
  mode: 'same-origin',
  redirect: 'error',
  referrerPolicy: 'no-referrer',
};

const HTTP_OK = 200;

function unavailable(file: string, summary: string, status?: number): DomainResult<never> {
  return fail(
    failure('inference.runtime-file-unavailable', FailureKind.Unrecoverable, summary, {
      details: { file, ...(status === undefined ? {} : { status }) },
    }),
  );
}

/** The runtime's file over HTTP from the application's own origin (see the module comment). */
export class OriginRuntimeFiles implements RuntimeFiles {
  readonly #filesBase: string;
  readonly #request: RuntimeFileFetch;

  /** `filesBase` is the setup's, an absolute URL ending in a slash on the worker's origin. */
  constructor(filesBase: string, request: RuntimeFileFetch = fetch) {
    this.#filesBase = filesBase;
    this.#request = request;
  }

  async read(): Promise<DomainResult<Uint8Array<ArrayBuffer>>> {
    const file = RUNTIME_WEBASSEMBLY_FILE;
    // Called as a function: a browser's `fetch` called as a method of this
    // object throws "Illegal invocation".
    const request = this.#request;
    try {
      const response = await request(`${this.#filesBase}${file}`, REQUEST);
      if (response.status !== HTTP_OK) {
        return unavailable(
          file,
          `The runtime's WebAssembly file ${file} could not be read: the application's server answered ${String(response.status)}.`,
          response.status,
        );
      }
      return succeed(new Uint8Array(await response.arrayBuffer()));
    } catch (error) {
      // `fetch` and a body's read reject with a TypeError for every failure
      // of the network, a refused redirect or another origin among them, and
      // nothing else is asked of the platform here.
      if (!(error instanceof TypeError)) throw error;
      return unavailable(
        file,
        `The runtime's WebAssembly file ${file} could not be read from the application's server: ${error.message}`,
      );
    }
  }
}
