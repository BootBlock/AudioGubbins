/**
 * A `decode` request (ADR-0090): a file opened, described and decoded from
 * start to end into a stream to the storage worker, never on the page. The
 * stream carries the description, with the file's metadata, then the blocks,
 * then the end; every way the request can end before its stream does, a file
 * refused, unreadable or cancelled, still ends the stream with the reason,
 * so the storage worker never waits on a stream that will not come.
 */

import type { SyncAudioBytes } from '@audiogubbins/codecs';
import { FailureKind, failure, type DomainFailure } from '@audiogubbins/domain';
import type { DecodedStreamMessage } from '@audiogubbins/import-export';

import type { DecodedBlocks } from '../decoding/decoded-blocks.js';
import { sendDecodedStream } from '../decoding/decode-stream.js';
import { asyncAudioBytes } from '../files/async-file-bytes.js';
import { openFileSource, type FileSource } from '../files/file-source.js';
import type { FileReaderSyncLike } from '../files/sync-file-bytes.js';
import { CreditedSender } from '../streams/credited-sender.js';
import type { MessagePortLike } from '../streams/stream-port.js';
import { WORK_CANCELLED } from '../work-cancelled.js';
import type { MetadataOutcome } from './codec-worker-messages.js';
import {
  decodedBlocksOf,
  openImport,
  readMetadata,
  type ImportServices,
} from './import-opening.js';
import { endOfThrown, type JobContext, type JobEnd } from './job-end.js';

/** The refusal of a file read where it lies, which is never decoded. */
const READ_IN_PLACE: DomainFailure = failure(
  'codec-runtime.read-in-place',
  FailureKind.Rejected,
  'The file is read where it lies, block by block, so it is not decoded.',
);

/** Ends the stream with `reason`, unless its receiver ended it, and answers the request so. */
async function failedWith(
  sender: CreditedSender<DecodedStreamMessage>,
  reason: DomainFailure,
  end: JobEnd,
): Promise<JobEnd> {
  if (sender.refusal === undefined) await sender.send({ kind: 'failed', failure: reason }, []);
  return end;
}

/** Decodes the file `source` names into the stream over `stream`. */
export async function runDecode(
  source: FileSource,
  stream: MessagePortLike,
  reader: FileReaderSyncLike,
  services: ImportServices,
  context: JobContext,
): Promise<JobEnd> {
  const sender = new CreditedSender<DecodedStreamMessage>(stream);
  try {
    const file = await openFileSource(source, reader);
    if (!file.ok) {
      return await failedWith(sender, file.failures[0], {
        kind: 'failed',
        failure: file.failures[0],
      });
    }
    try {
      return await decodeOpened(file.value.bytes, sender, services, context);
    } catch (error) {
      const end = endOfThrown(error, context.signal);
      if (end === undefined) throw error;
      return await failedWith(sender, end.kind === 'failed' ? end.failure : WORK_CANCELLED, end);
    } finally {
      file.value.close();
    }
  } finally {
    sender.close();
  }
}

/** Decodes an opened file into the stream. */
async function decodeOpened(
  file: SyncAudioBytes,
  sender: CreditedSender<DecodedStreamMessage>,
  services: ImportServices,
  context: JobContext,
): Promise<JobEnd> {
  const { signal } = context;
  const bytes = asyncAudioBytes(file);
  const opened = await openImport(file, bytes, services, signal);
  if (opened.kind === 'refused') {
    return await failedWith(sender, opened.failure, { kind: 'failed', failure: opened.failure });
  }
  if (opened.kind === 'read-in-place') {
    return await failedWith(sender, READ_IN_PLACE, { kind: 'failed', failure: READ_IN_PLACE });
  }
  const { session, stream, decoder } = opened.opened;
  let blocks: DecodedBlocks | undefined;
  let metadata: MetadataOutcome;
  try {
    metadata = await readMetadata(stream.container, bytes, signal);
    const made = await decodedBlocksOf(opened.opened, bytes, services.platform, signal);
    if (!made.ok) {
      return await failedWith(sender, made.failures[0], {
        kind: 'failed',
        failure: made.failures[0],
      });
    }
    blocks = made.value;
  } finally {
    // Blocks made own the session; until then it is this job's.
    if (blocks === undefined) session.release();
  }
  try {
    const outcome = await sendDecodedStream(
      blocks,
      {
        sampleRate: stream.sampleRate,
        layout: stream.layout,
        statedFrames: stream.statedFrames,
        // Metadata the file's reader refused is said by analysis; the rendition keeps none of it.
        metadata: metadata.kind === 'read' ? metadata.metadata : {},
      },
      sender,
      context,
    );
    return outcome.kind === 'decoded'
      ? { kind: 'decoded', frames: outcome.frames, decoder }
      : outcome;
  } finally {
    blocks.release();
  }
}
