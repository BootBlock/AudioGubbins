/**
 * What an import is, decided before anything of it is stored (ADR-0090,
 * REQ-AUDIO-220, REQ-EXEC-216).
 *
 * The file's format is recognised from its bytes and routed by the codec
 * registry: read where it lies by the read contract, whose header gives the
 * audio's description at once, with the file's metadata read beside it;
 * decoded into a rendition, whose description the codec worker reads from the
 * stream's header and sends first; or refused with the sentence that names
 * what the file is and what can be read.
 *
 * The storage the import needs is stated against the storage estimate before
 * a byte is written: the file itself where a copy of it is kept, and the
 * rendition, whose size is its frames times its channels times four bytes and
 * its header, where the stream states its frames. A stream that states none
 * cannot be sized, so its rendition is not counted, and a write the storage
 * refuses while it is decoded ends the import as a cancelled one does, with
 * nothing kept. An estimate the browser does not give is never taken for
 * room, nor for its lack: the import goes ahead and the storage refuses what
 * it cannot hold.
 */

import {
  METADATA_READERS,
  importRoute,
  openAudio,
  recogniseAudio,
  recordedWavLength,
  type AudioFormatDescriptor,
  type CodecId,
  type ContainerId,
  type MetadataMap,
  type RecognisedFormat,
  type RecordedWavFormat,
} from '@audiogubbins/codecs';
import {
  fail,
  succeed,
  type DomainFailure,
  type DomainResult,
  type SampleCount,
} from '@audiogubbins/domain';
import { SourceHandling, type ExternalFile, type ImportChoice } from '@audiogubbins/media-store';

import { importNeedsRoom } from './import-failures.js';

/** A file's metadata as read beside its audio, or why its metadata was refused. */
export type FileMetadata =
  | { readonly kind: 'read'; readonly metadata: MetadataMap }
  | { readonly kind: 'refused'; readonly failure: DomainFailure };

/**
 * What an import is (see the module comment), with the format its bytes were
 * recognised as, which the import reports so the person sees what each file
 * is while it is brought in.
 */
export type ImportAnalysis =
  | {
      /** Read where it lies, by the read contract. */
      readonly kind: 'in-place';
      readonly recognised: RecognisedFormat;
      readonly format: AudioFormatDescriptor;
      readonly metadata: FileMetadata;
    }
  | {
      /** Decoded once into a rendition; `codec` is the codec its container states, where it states one. */
      readonly kind: 'decode';
      readonly recognised: RecognisedFormat;
      readonly container: ContainerId;
      readonly codec: CodecId | undefined;
    };

/** The room the storage has left, in bytes, as the estimate gives it, or nothing where it gives none. */
export type StorageRoom = () => Promise<number | undefined>;

/** What `file` is and how it is imported, or why it is refused (see the module comment). */
export async function analyseFile(
  file: ExternalFile,
  signal?: AbortSignal,
): Promise<DomainResult<ImportAnalysis>> {
  const recognised = await recogniseAudio(file.source, signal);
  if (!recognised.ok) return recognised;
  const route = importRoute(recognised.value);
  switch (route.kind) {
    case 'refuse':
      return fail(route.failure);
    case 'decode':
      return succeed({
        kind: 'decode',
        recognised: recognised.value,
        container: route.container,
        codec: route.codec,
      });
    case 'read-in-place': {
      const opened = await openAudio(file.source, signal);
      if (!opened.ok) return opened;
      const { format } = opened.value;
      return succeed({
        kind: 'in-place',
        recognised: recognised.value,
        format,
        metadata: await metadataOf(file, format.container, signal),
      });
    }
  }
}

/**
 * The file's metadata, by its container's reader. A file whose metadata
 * breaks its format's rules keeps its audio, which the read contract read
 * whole, and the import says why its metadata was not kept.
 */
async function metadataOf(
  file: ExternalFile,
  container: ContainerId,
  signal?: AbortSignal,
): Promise<FileMetadata> {
  const reader = METADATA_READERS.get(container);
  if (reader === undefined) return { kind: 'read', metadata: {} };
  const read = await reader(file.source, signal);
  return read.ok
    ? { kind: 'read', metadata: read.value }
    : { kind: 'refused', failure: read.failures[0] };
}

/** Whether an import keeps a copy of the file itself in the store. */
export function keepsCopy(choice: ImportChoice): boolean {
  return choice.mode === SourceHandling.Copy || choice.keepProtectedCopy;
}

/**
 * The bytes of the rendition a stream of `format` decodes to, where the stream
 * states its `frames`, or why no WAV file could hold it.
 */
export function renditionBytes(
  format: RecordedWavFormat,
  frames: SampleCount | undefined,
): DomainResult<number | undefined> {
  return frames === undefined ? succeed(undefined) : recordedWavLength(format, frames);
}

/**
 * Whether the storage has room for `needed` bytes, read from `room` now:
 * refused where the estimate says it has not, and allowed where it gives none.
 */
export async function checkRoom(needed: number, room: StorageRoom): Promise<DomainResult<void>> {
  if (needed === 0) return succeed(undefined);
  const available = await room();
  return available === undefined || needed <= available
    ? succeed(undefined)
    : fail(importNeedsRoom(needed, available));
}
