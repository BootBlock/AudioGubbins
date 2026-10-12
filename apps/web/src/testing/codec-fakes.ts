/**
 * The page's codecs for a test that asks them nothing it does not script: an
 * environment where WebAssembly runs and the worker has said nothing, each
 * file's analysis answered as the test says, and nothing decoded or encoded.
 */

import type { CodecCapability, CodecEnvironment, CodecId, CodecUse } from '@audiogubbins/codecs';
import {
  WORK_CANCELLED,
  type ExportEncodeRequest,
  type ImportAnalysis,
} from '@audiogubbins/codec-runtime';
import {
  FailureKind,
  fail,
  failure,
  sampleCount,
  sampleRate,
  succeed,
  type ChannelLayout,
  type DomainResult,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { createCodecEnvironmentStore } from '../codecs/codec-environment.js';
import type { CodecServices, DecodedFile, EncodedFile } from '../codecs/codec-services.js';
import type { Observable } from '../state/observable.js';

/** The analysis of an AAC stream in MP4 of `layout`, decoded by the codec module. */
export function decodedAnalysis(layout: ChannelLayout): ImportAnalysis {
  return {
    kind: 'decode',
    stream: {
      codec: 'aac-lc',
      container: 'mp4',
      sampleRate: expectSuccess(sampleRate(48_000)),
      layout,
      statedFrames: undefined,
      leadingFrames: expectSuccess(sampleCount(0)),
      bitRate: undefined,
      bitsPerSample: undefined,
    },
    decoder: { implementation: 'codec-module', name: 'Symphonia', version: '0.6.1' },
    metadata: { kind: 'none' },
  };
}

/** What a test's codecs answer of a file analysed. */
export type ScriptedAnalysis = (file: Blob) => DomainResult<ImportAnalysis>;

/** The analysis of a test that scripts none: refused, as a file no codec reads. */
const NO_ANALYSIS: ScriptedAnalysis = () =>
  fail(failure('test.no-analysis', FailureKind.Rejected, 'This test analyses no file.'));

/** Codecs whose analyses a test scripts, recording each file asked of them. */
export class ScriptedCodecs implements CodecServices {
  readonly analysed: Blob[] = [];
  readonly #environment = createCodecEnvironmentStore(true);
  #analysis: ScriptedAnalysis;

  constructor(analysis: ScriptedAnalysis = NO_ANALYSIS) {
    this.#analysis = analysis;
  }

  get environment(): Observable<CodecEnvironment> {
    return this.#environment;
  }

  /** Takes `environment` as the one the worker sent, as a module loaded or failed. */
  adopt(environment: CodecEnvironment): void {
    this.#environment.adopt(environment);
  }

  /** Answers each later analysis as `analysis` says. */
  analyseAs(analysis: ScriptedAnalysis): void {
    this.#analysis = analysis;
  }

  capability(codec: CodecId, use: CodecUse): CodecCapability {
    return this.#environment.capability(codec, use);
  }

  /** How many times the worker was asked to be made ready. */
  readied = 0;

  ready(): Promise<DomainResult<void>> {
    this.readied += 1;
    return Promise.resolve(succeed(undefined));
  }

  analyse(file: Blob, signal: AbortSignal): Promise<DomainResult<ImportAnalysis>> {
    this.analysed.push(file);
    return Promise.resolve(signal.aborted ? fail(WORK_CANCELLED) : this.#analysis(file));
  }

  decode(
    _file: Blob,
    _stream: MessagePort,
    _progress: (frames: number) => void,
    _signal: AbortSignal,
  ): Promise<DomainResult<DecodedFile>> {
    return Promise.resolve(
      fail(failure('test.no-decoder', FailureKind.Rejected, 'This test decodes nothing.')),
    );
  }

  encode(
    _request: ExportEncodeRequest,
    _ports: { readonly rendered: MessagePort; readonly stream: MessagePort },
    _progress: (frames: number) => void,
    _signal: AbortSignal,
  ): Promise<DomainResult<EncodedFile>> {
    return Promise.resolve(
      fail(failure('test.no-encoder', FailureKind.Rejected, 'This test encodes nothing.')),
    );
  }
}
