/**
 * One file of an export, rendered, encoded and staged (ADR-0092): the
 * canonical render of its span through the export's graph, the render
 * worker's blocks sent over a channel of their own to the codec worker, and
 * the codec worker's bytes over another to the storage worker, which stages
 * them. The page starts the three and hears how far they have got; no sample
 * and no byte passes through it.
 *
 * The render is the one every render of the page is: the render host the test
 * signal renders on, the span's audio described as playback describes it, its
 * edits and racks included (`EditorAsset.describe`), queued on the same
 * scheduler, at the highest quality, since an export is a final render
 * (REQ-AUDIO-143). The graph converts to the export's rate and layout; the
 * codec worker quantises and dithers before an integer encoder.
 *
 * The three stop together. Where one fails the others are called off, and
 * each worker ends the streams it holds with the reason, so none waits on a
 * stream that will not come and the staging keeps nothing. The failure said
 * is the first in the stream's order: the render's, then the encoder's, then
 * the staging's, since each later one is only the earlier one passed on.
 */

import type { MetadataPart } from '@audiogubbins/codecs';
import type { ExportEncodeRequest } from '@audiogubbins/codec-runtime';
import {
  FailureKind,
  MAXIMUM_QUALITY,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';
import type { PcmDescription } from '@audiogubbins/audio-engine';
import type { RenderHost } from '@audiogubbins/audio-runtime';
import type { PlannedFile, StagedFile } from '@audiogubbins/import-export';
import type { ExportCodec } from '@audiogubbins/project-format';
import type { ExportOrigin } from '@audiogubbins/storage';
import type { ExportsClient, RemoteProjectSession } from '@audiogubbins/storage-runtime';

import type { RenderRun } from '../audio/render-control.js';
import type { CodecServices } from '../codecs/codec-services.js';

/** What the runner works with, each made once by the composition root. */
export interface ExportRunnerParts {
  /** The page's render host, made on first use. */
  readonly host: () => Promise<DomainResult<RenderHost>>;

  /** How a render of that shape runs here: its chunks, its tables' budget and its priority. */
  readonly planRender: (shape: {
    readonly frames: SampleCount;
    readonly channels: number;
    readonly sampleRate: SampleRate;
  }) => DomainResult<RenderRun>;
  readonly codecs: Pick<CodecServices, 'encode'>;
  readonly exports: Pick<ExportsClient, 'stage' | 'discard'>;
}

/** One file to stage: what it is, the audio its span is of, how it is encoded, and what made it. */
export interface FileToStage {
  readonly file: PlannedFile;

  /** The audio of the span's asset or region, described as playback describes it. */
  readonly source: PcmDescription;
  readonly encode: ExportEncodeRequest;
  readonly origin: ExportOrigin;
}

/** A file staged: its token, what it is, the encoder that wrote it, and the metadata it dropped. */
export interface StagedRun {
  readonly token: string;
  readonly staged: StagedFile;
  readonly encoder: ExportCodec;
  readonly dropped: readonly MetadataPart[];
}

/** How far a file has got: its frames rendered and its bytes staged, neither going back. */
export type StagingProgress = (framesRendered: number, bytesStaged: number) => void;

/** A render, an encode or a staging that stopped in a way it could not answer. */
function stopped(what: string, thrown: unknown): DomainFailure {
  return failure(
    'export.stopped',
    FailureKind.Unrecoverable,
    `The export's ${what} stopped: ${thrown instanceof Error ? thrown.message : 'no reason was given'}.`,
  );
}

/** An encoder that answered other than the frames the render made. */
function framesDisagree(rendered: number, encoded: number): DomainFailure {
  return failure(
    'export.frames-disagree',
    FailureKind.IntegrityViolation,
    `The render made ${String(rendered)} frames and the encoder took ${String(encoded)}, so the file was not kept.`,
  );
}

/** The first failure of the three, in the stream's order (see the module comment). */
function firstFailure(...results: readonly DomainResult<unknown>[]): DomainFailure {
  for (const result of results) if (!result.ok) return result.failures[0];
  throw new Error('No step of the export failed.');
}

/** The answer of `work`, or what it threw as a failure, calling `off` either way it fails. */
async function settled<T>(
  work: Promise<DomainResult<T>>,
  what: string,
  off: () => void,
): Promise<DomainResult<T>> {
  try {
    const result = await work;
    if (!result.ok) off();
    return result;
  } catch (thrown) {
    off();
    return fail(stopped(what, thrown));
  }
}

/**
 * Renders, encodes and stages `job` for the project `session` writes, telling
 * `progress` how far it has got (see the module comment). Answers the file
 * staged, or the first failure; where `signal` aborts, the work is called off
 * and the staging keeps nothing, and the caller, which aborted it, says so.
 */
export async function stageFile(
  parts: ExportRunnerParts,
  session: RemoteProjectSession,
  job: FileToStage,
  progress: StagingProgress,
  signal: AbortSignal,
): Promise<DomainResult<StagedRun>> {
  const { render } = job.file;
  const frames = render.range.length;
  const run = parts.planRender({
    frames,
    channels: render.layout.roles.length,
    sampleRate: render.sampleRate,
  });
  if (!run.ok) return run;
  const host = await parts.host();
  if (!host.ok) return host;

  const together = new AbortController();
  const off = (): void => {
    together.abort(signal.reason);
  };
  signal.addEventListener('abort', off, { once: true });
  const rendered = new MessageChannel();
  const encoded = new MessageChannel();
  let framesRendered = 0;
  let bytesStaged = 0;
  const told = (): void => {
    progress(framesRendered, bytesStaged);
  };
  try {
    const rendering = settled(
      host.value.render(
        {
          graph: render.graph,
          sampleRate: render.sampleRate,
          range: render.range,
          chunkFrames: run.value.chunkFrames,
          quality: MAXIMUM_QUALITY,
          sources: [{ ...job.source, node: render.input }],
          ...(run.value.coefficientBudgetBytes === undefined
            ? {}
            : { coefficientBudgetBytes: run.value.coefficientBudgetBytes }),
        },
        {
          priority: run.value.priority,
          signal: together.signal,
          onProgress: (reached) => {
            framesRendered = Math.min(frames, Math.max(framesRendered, reached.framesRendered));
            told();
          },
          sinks: new Map(),
          channels: new Map([[render.output, rendered.port1]]),
        },
      ),
      'render',
      off,
    );
    const encoding = settled(
      parts.codecs.encode(
        job.encode,
        { rendered: rendered.port2, stream: encoded.port1 },
        () => undefined,
        together.signal,
      ),
      'encoder',
      off,
    );
    const staging = settled(
      parts.exports.stage(
        session,
        { stream: encoded.port2, origin: job.origin },
        (bytes) => {
          bytesStaged = Math.max(bytesStaged, bytes);
          told();
        },
        together.signal,
      ),
      'staging',
      off,
    );
    const [renderedFile, encodedFile, stagedFile] = await Promise.all([
      rendering,
      encoding,
      staging,
    ]);
    if (!renderedFile.ok || !encodedFile.ok || !stagedFile.ok) {
      // A file staged beside a render or an encoder that failed is not the export's.
      if (stagedFile.ok) await parts.exports.discard(stagedFile.value.token);
      return fail(firstFailure(renderedFile, encodedFile, stagedFile));
    }
    if (renderedFile.value.frames !== frames || encodedFile.value.frames !== frames) {
      await parts.exports.discard(stagedFile.value.token);
      return fail(framesDisagree(renderedFile.value.frames, encodedFile.value.frames));
    }
    framesRendered = frames;
    bytesStaged = stagedFile.value.bytes;
    told();
    const { token, bytes, sha256, dropped } = stagedFile.value;
    return succeed({
      token,
      staged: { bytes, hash: sha256, reproducible: job.origin.reproducible },
      encoder: encodedFile.value.encoder,
      dropped,
    });
  } finally {
    signal.removeEventListener('abort', off);
    // Each end was given to a worker; one a worker refused before taking it
    // would stay open here, and closing one a worker took does nothing.
    rendered.port1.close();
    encoded.port2.close();
  }
}
