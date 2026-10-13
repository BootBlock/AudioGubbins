/**
 * What the page asks of the codecs (ADR-0090, ADR-0091): what this browser can
 * do with each codec, the codec worker made ready, a file analysed before
 * anything is stored, and a rendered stream encoded into a file's bytes.
 *
 * One instance for the page's life, made by the composition root, whether or
 * not projects can be kept here. The codec worker is started on the first
 * call that needs it and never before, so a page that imports and exports
 * nothing compiles no codec module. No sample passes through the page: the
 * streams travel over the ports an encode is given, and a file analysed is
 * read by the worker in place.
 */

import type { CodecCapability, CodecEnvironment, CodecId, CodecUse } from '@audiogubbins/codecs';
import type { ExportEncodeRequest, ImportAnalysis } from '@audiogubbins/codec-runtime';
import type { DomainResult, SampleCount } from '@audiogubbins/domain';
import type { ExportCodec } from '@audiogubbins/project-format';

import type { Observable } from '../state/observable.js';

/**
 * A file the codec worker encoded: the frames it holds, and the encoder that
 * wrote them, which the export's record names (REQ-AUDIO-145, REQ-STOR-197).
 */
export interface EncodedFile {
  readonly frames: SampleCount;
  readonly encoder: ExportCodec;
}

/** The page's codecs (see the module comment). */
export interface CodecServices {
  /**
   * What this browser offers the codecs. Before the worker is ready it says
   * only whether WebAssembly runs, with no module yet loaded; it is replaced
   * by each environment the worker sends, so a module that fails to load
   * makes its codecs unavailable here, with the reason, from then on.
   */
  readonly environment: Observable<CodecEnvironment>;

  /**
   * What the current environment can do with `codec` in `use`, read from
   * `environment` as it stands, never a cached answer: unavailable with the
   * sentence saying why and the codecs that serve instead. Never starts the
   * worker, so it may be asked at any time, such as by a dialog listing the
   * formats before the person chooses one.
   */
  capability(codec: CodecId, use: CodecUse): CodecCapability;

  /**
   * Starts the codec worker, compiles each module the page bundles, configures
   * the worker with them, and connects it to the storage worker, so imports
   * decode through it; once, however often it is called, every call answering
   * the first one's result. A module that fails to compile is no failure: the
   * worker is configured with why, and its codecs become unavailable through
   * `environment`. Fails where the worker cannot be started or the storage
   * worker cannot be joined, and a later call answers the same failure: the
   * page does not start a second worker beside one that failed.
   */
  ready(): Promise<DomainResult<void>>;

  /**
   * Analyses `file` in the codec worker: its format recognised from its bytes,
   * its stream and metadata described, before anything is stored. Waits for
   * `ready` and answers its failure where it failed. A file the codecs cannot
   * import is no failure: it is the analysis `refused`, with the reason and
   * the codecs that serve instead. Fails where the worker answers a failure,
   * and with `codec-runtime.cancelled` once `signal` aborts, the request
   * cancelled in the worker.
   */
  analyse(file: Blob, signal: AbortSignal): Promise<DomainResult<ImportAnalysis>>;

  /**
   * Encodes the rendered stream arriving over `ports.rendered` into the
   * encoded stream sent over `ports.stream`, as `request` asks, transferring
   * both ports to the worker; `progress` is told the frames encoded so far,
   * never fewer than the last. Waits for `ready` and answers its failure where
   * it failed. Answers the encoded file once its last byte was sent and taken.
   * Fails where the codec is unavailable here, where the encoder or either
   * stream fails, and with `codec-runtime.cancelled` once `signal` aborts, the
   * request cancelled in the worker and the stream's receiver told, so it
   * keeps nothing.
   */
  encode(
    request: ExportEncodeRequest,
    ports: { readonly rendered: MessagePort; readonly stream: MessagePort },
    progress: (frames: number) => void,
    signal: AbortSignal,
  ): Promise<DomainResult<EncodedFile>>;
}
