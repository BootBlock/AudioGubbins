/**
 * Making a recording whose capture has ended into an asset of the project
 * (ADR-0071, REQ-REC-020, REQ-STOR-166), as a stop does and as recovering an
 * interrupted session does.
 *
 * The manifest is rewritten first with how capture ended and the asset the
 * recording is being made into, so a session cut short from here on keeps why
 * it ended, and one whose asset the project holds is known to be finished. The
 * recording's file is a 32-bit float WAV header followed by the chunks as they
 * stand: its identity is hashed over the header and the chunks first, so the
 * media store writes it once, under that identity, then it is read back through
 * the read contract before anything names it, as an import is. The asset and
 * the take its purpose names are added as one change, with the store's hold on
 * the file released as an import's is, and the session's chunks and manifest
 * are removed only once the project's journal holds that change. Until then,
 * and wherever a step fails, the session stays, to be recovered.
 */

import { openAudio, recordedWavHeader, type AudioFormatDescriptor } from '@audiogubbins/codecs';
import type { Clock } from '@audiogubbins/diagnostics';
import {
  AssetOrigin,
  fail,
  layoutsMatch,
  succeed,
  type Asset,
  type AssetId,
  type DomainResult,
  type SampleCount,
  type Take,
  type TakeStackId,
} from '@audiogubbins/domain';
import type { MediaObjectStore } from '@audiogubbins/media-store';
import {
  TreeFailure,
  contentIdOf,
  storageKeyOf,
  type AssetSource,
  type ByteSource,
  type ContentIdentity,
  type RecordedProvenance,
  type RecordingEnding,
} from '@audiogubbins/project-format';

import { audioShape } from './audio-import.js';
import { whenSettled, runHolding } from './media-holds.js';
import type { ProjectSession } from './project-session.js';
import { readRecordedAudio, type RecordedAudio } from './recorded-audio.js';
import type { RecordingServices } from './recording-capture.js';
import {
  nothingRecorded,
  recordingNotWritable,
  recordingReadBackDiffers,
} from './recording-failures.js';
import { writeManifest, type RecordingFiles } from './recording-manifests.js';
import { takeChange, type RecordingCommands } from './recording-takes.js';
import type { ChangeOutcome } from './session-contracts.js';
import { refusalsReported } from './storage-failures.js';

/** The media type a recording's file is stored as, RF64 among them. */
const RECORDED_MEDIA_TYPE = 'audio/wav';

/** What finishing a recording works with, each made once by the composition root. */
export interface FinishingServices extends RecordingServices {
  readonly store: MediaObjectStore;
  readonly clock: Clock;
  readonly commands: RecordingCommands;
}

/** A recording made into an asset of the project. */
export interface FinishedRecording {
  readonly outcome: ChangeOutcome;
  readonly asset: Asset;
  readonly take: Take;
  readonly stack: TakeStackId;
  readonly recording: RecordedProvenance;
}

/**
 * Makes the recording `kept`, whose capture ended as `ending`, into the asset
 * and take its purpose names in the project `session` writes, named and placed
 * as its manifest says (see the module comment). A window that does not hold
 * the project to change it writes nothing, and a session that committed no
 * frame is removed, and refused as nothing recorded.
 */
export async function finishRecording(
  session: ProjectSession,
  kept: RecordingFiles,
  ending: RecordingEnding,
  services: FinishingServices,
  signal?: AbortSignal,
): Promise<DomainResult<FinishedRecording>> {
  const { access } = session.getSnapshot();
  if (access.kind !== 'writable') return fail(recordingNotWritable(access));
  return await refusalsReported(async () => {
    const asset = services.ids.next<'AssetId'>();
    const ended = await writeManifest(
      kept.records,
      kept.paths,
      { ...kept.manifest, end: { ending, asset } },
      kept.pair,
      signal,
    );
    if (!ended.ok) return ended;
    const { start } = kept.manifest;
    const audio = await readRecordedAudio(
      services.tree,
      kept.paths,
      start.layout.roles.length,
      signal,
    );
    if (audio.frames === 0) {
      await services.tree.remove(kept.paths.directory);
      return fail(nothingRecorded(kept.manifest.session));
    }
    const recording: RecordedProvenance = {
      ...start,
      length: audio.frames,
      ending,
      ...(audio.gaps === undefined ? {} : { gaps: audio.gaps }),
    };
    const stored = await storedFile(kept, audio, services, signal);
    if (!stored.ok) return stored;
    return await added(session, kept, asset, stored.value, recording, services);
  });
}

/** The recording's file as stored and read back, held by the store until released. */
interface StoredFile {
  readonly identity: ContentIdentity;
  readonly format: AudioFormatDescriptor;
  readonly release: () => void;
}

/** Stores the recording's file under its identity and reads it back (see the module comment). */
async function storedFile(
  kept: RecordingFiles,
  audio: RecordedAudio,
  services: FinishingServices,
  signal?: AbortSignal,
): Promise<DomainResult<StoredFile>> {
  const { sampleRate, layout } = kept.manifest.start;
  const header = recordedWavHeader({ sampleRate, layout }, audio.frames);
  if (!header.ok) return header;
  const file = headed(header.value.bytes, audio.data);
  const options = signal === undefined ? {} : { signal };
  const identity = await contentIdOf(file, services.digest, options);
  if (!identity.ok) return identity;
  const { contentId } = identity.value;
  const put = await services.store.putNamed(file, contentId, options);
  if (!put.ok) return put;
  const release = (): void => {
    services.store.release(contentId);
  };
  const read = await readBack(kept, contentId, audio.frames, services.store, signal);
  if (!read.ok) release();
  return read.ok ? succeed({ identity: identity.value, format: read.value, release }) : read;
}

/** The stored file's format, where the read contract reads it as the recording it was written as. */
async function readBack(
  kept: RecordingFiles,
  contentId: ContentIdentity['contentId'],
  frames: SampleCount,
  store: MediaObjectStore,
  signal?: AbortSignal,
): Promise<DomainResult<AudioFormatDescriptor>> {
  const opened = await store.open(contentId);
  if (!opened.ok) return opened;
  const reader = await openAudio(opened.value, signal);
  if (!reader.ok) return fail(recordingReadBackDiffers(kept.manifest.session, 'unreadable'));
  const { format } = reader.value;
  const { start } = kept.manifest;
  const differs =
    format.sampleRate !== start.sampleRate
      ? 'sample-rate'
      : !layoutsMatch(format.layout, start.layout)
        ? 'layout'
        : format.frames !== frames || format.declaredFrames !== frames
          ? 'length'
          : undefined;
  return differs === undefined
    ? succeed(format)
    : fail(recordingReadBackDiffers(kept.manifest.session, differs));
}

/** Adds the asset and its take as one change, then removes the session once storage holds it. */
async function added(
  session: ProjectSession,
  kept: RecordingFiles,
  id: AssetId,
  stored: StoredFile,
  recording: RecordedProvenance,
  services: FinishingServices,
): Promise<DomainResult<FinishedRecording>> {
  const { contentId, byteLength } = stored.identity;
  const media = { kind: 'managed', contentId, byteLength, mediaType: RECORDED_MEDIA_TYPE } as const;
  const asset: Asset = {
    id,
    displayName: kept.manifest.take.name,
    origin: AssetOrigin.Recorded,
    sampleRate: recording.sampleRate,
    channelLayout: recording.layout,
    length: recording.length,
    storageKey: storageKeyOf(id, media),
    edits: [],
  };
  const source: AssetSource = {
    media,
    provenance: {
      importedAt: services.clock.now(),
      byteLength,
      mediaType: RECORDED_MEDIA_TYPE,
      originProjectId: session.project,
      audio: audioShape(stored.format),
      recording,
    },
  };
  const change = takeChange(
    session.getSnapshot().model.state,
    kept.manifest,
    { asset, source },
    services.ids,
    services.commands,
  );
  if (!change.ok) {
    stored.release();
    return change;
  }
  const { description, invocations, take, stack } = change.value;
  const ran = await runHolding(
    session,
    stored.release,
    async () => await session.runGroup(description, invocations),
  );
  if (!ran.ok) return ran;
  if (ran.value.kind === 'applied') await removeOnceHeld(session, kept, ran.value, services);
  return succeed({ outcome: ran.value, asset, take, stack, recording });
}

/**
 * Removes the session's files once the journal holds the change that made it
 * an asset: at once where the change was written, and otherwise once the
 * session has written everything, never where it stopped writing first.
 */
async function removeOnceHeld(
  session: ProjectSession,
  kept: RecordingFiles,
  outcome: Extract<ChangeOutcome, { readonly kind: 'applied' }>,
  services: FinishingServices,
): Promise<void> {
  const remove = async (): Promise<void> => {
    try {
      await services.tree.remove(kept.paths.directory);
    } catch (error) {
      // A session left behind names an asset the project holds, so the next
      // opening of the project finds it finished and removes it.
      if (!(error instanceof TreeFailure)) throw error;
    }
  };
  if (outcome.saved.kind === 'written') {
    await remove();
    return;
  }
  void whenSettled(session).then(async (settled) => {
    if (settled === 'saved') await remove();
  });
}

/** `header` followed by `data`, as one source. */
function headed(header: Uint8Array, data: ByteSource): ByteSource {
  const size = header.length + data.size;
  return {
    size,
    read: async (offset, length, signal) => {
      const end = Math.min(offset + length, size);
      const bytes = new Uint8Array(Math.max(0, end - offset));
      if (offset < header.length) bytes.set(header.subarray(offset, Math.min(end, header.length)));
      if (end <= header.length) return bytes;
      const from = Math.max(offset, header.length);
      const part = await data.read(from - header.length, end - from, signal);
      bytes.set(part, from - offset);
      return part.length === end - from ? bytes : bytes.slice(0, from - offset + part.length);
    },
  };
}
