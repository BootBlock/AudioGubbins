/**
 * Making a recording whose capture has ended into an asset of the project
 * (ADR-0071, REQ-REC-020, REQ-STOR-166), as a stop does and as recovering an
 * interrupted session does.
 *
 * The manifest is rewritten first with how capture ended and the asset the
 * recording is being made into, so a session cut short from here on keeps why
 * it ended, and one whose asset the project holds is known to be finished. The
 * recording's file is a 32-bit float WAV header followed by the chunks as they
 * stand, stored as `stored-wav.ts` stores every file the storage makes itself:
 * hashed first, so the media store writes it once, and read back through the
 * read contract before anything names it, as an import is. The asset and the
 * take its purpose names are added as one change, with the store's hold on the
 * file released as an import's is, and the session's chunks and manifest are
 * removed only once the project's journal holds that change. Until then, and
 * wherever a step fails, the session stays, to be recovered.
 */

import type { Clock } from '@audiogubbins/diagnostics';
import {
  AssetOrigin,
  fail,
  succeed,
  type Asset,
  type AssetId,
  type DomainResult,
  type Take,
  type TakeStackId,
} from '@audiogubbins/domain';
import type { MediaObjectStore } from '@audiogubbins/media-store';
import {
  TreeFailure,
  storageKeyOf,
  type AssetSource,
  type RecordedProvenance,
  type RecordingEnding,
} from '@audiogubbins/project-format';

import { audioShape } from './in-place-import.js';
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
import {
  STORED_WAV_MEDIA_TYPE,
  storeFloatWav,
  storedWavMedia,
  type StoredWav,
} from './stored-wav.js';

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

/** Stores the recording's file under its identity and reads it back (see the module comment). */
async function storedFile(
  kept: RecordingFiles,
  audio: RecordedAudio,
  services: FinishingServices,
  signal?: AbortSignal,
): Promise<DomainResult<StoredWav>> {
  const { sampleRate, layout } = kept.manifest.start;
  return await storeFloatWav(
    audio.data,
    { sampleRate, layout },
    audio.frames,
    services,
    (difference) => recordingReadBackDiffers(kept.manifest.session, difference),
    signal,
  );
}

/** Adds the asset and its take as one change, then removes the session once storage holds it. */
async function added(
  session: ProjectSession,
  kept: RecordingFiles,
  id: AssetId,
  stored: StoredWav,
  recording: RecordedProvenance,
  services: FinishingServices,
): Promise<DomainResult<FinishedRecording>> {
  const audio = audioShape(stored.format);
  const media = storedWavMedia(stored);
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
      byteLength: media.byteLength,
      mediaType: STORED_WAV_MEDIA_TYPE,
      originProjectId: session.project,
      audio,
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
