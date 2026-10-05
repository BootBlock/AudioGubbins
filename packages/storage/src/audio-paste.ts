/**
 * Running a paste the clipboard planned as one change undo reverses
 * (ADR-0053): adding the records of the media another project's copy reads,
 * then applying the paste's edits to the asset.
 *
 * A record is added only once its media is shown to be there, so a missing or
 * changed source refuses the paste and leaves the destination as it was. A
 * stored object is proved where it lies, never copied, and held, as an import's
 * copy is, until storage holds the change that refers to it; a linked file is
 * found through the page and must still be the file its identity names, or the
 * protected copy it keeps must be stored. The commands are the project
 * commands', whose builders the caller gives.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import {
  FailureKind,
  fail,
  failure,
  succeed,
  type Asset,
  type AssetId,
  type DomainFailure,
  type DomainResult,
  type EditOperation,
} from '@audiogubbins/domain';
import { classifySource, examineFile } from '@audiogubbins/media-store';
import type { AssetRecord, ContentId, ExternalMedia } from '@audiogubbins/project-format';

import type { ConsolidationServices } from './consolidation.js';
import { runHolding } from './media-holds.js';
import type { ProjectSession } from './project-session.js';
import type { ChangeOutcome } from './session-contracts.js';

/** A planned paste, as the clipboard planned it. */
export interface AudioPaste {
  /** What the history calls the change. */
  readonly description: string;

  /** The records of the media the paste reads that the project lacks. */
  readonly records: readonly AssetRecord[];
  readonly asset: AssetId;
  readonly operations: readonly [EditOperation, ...EditOperation[]];
}

/** What a paste works with, each made once by the composition root. */
export interface AudioPasteServices extends Pick<
  ConsolidationServices,
  'store' | 'digest' | 'yieldToHost' | 'locate'
> {
  /** The project commands' `addAssetInvocation`. */
  readonly addAsset: (asset: Asset, source: AssetRecord['source']) => CommandInvocation;

  /** The project commands' `applyInvocation`. */
  readonly applyEdit: (asset: Pick<Asset, 'id'>, operation: EditOperation) => CommandInvocation;
}

function mediaGone(record: AssetRecord, why: string): DomainFailure {
  return failure(
    'paste.media-unavailable',
    FailureKind.Conflict,
    `The copied audio reads “${record.asset.displayName}”, ${why}, so nothing was pasted.`,
  );
}

/** Runs `paste` in the session's project (see the module comment). */
export async function pasteAudio(
  session: ProjectSession,
  paste: AudioPaste,
  services: AudioPasteServices,
  signal?: AbortSignal,
): Promise<DomainResult<ChangeOutcome>> {
  const held: ContentId[] = [];
  const release = (): void => {
    for (const contentId of held) services.store.release(contentId);
  };
  return await runHolding(session, release, async () => {
    for (const record of paste.records) {
      const shown = await mediaShown(record, services, signal);
      if (!shown.ok) return shown;
      if (shown.value !== undefined) held.push(shown.value);
    }
    const [first, ...rest] = [
      ...paste.records.map((record) => services.addAsset(record.asset, record.source)),
      ...paste.operations.map((operation) => services.applyEdit({ id: paste.asset }, operation)),
    ];
    if (first === undefined) throw new Error('A paste applies at least one edit.');
    signal?.throwIfAborted();
    return await session.runGroup(paste.description, [first, ...rest]);
  });
}

/**
 * Shows the record's media is there: the stored object it names, held until
 * released, or the linked file it names, unchanged, or its protected copy.
 */
async function mediaShown(
  record: AssetRecord,
  services: AudioPasteServices,
  signal?: AbortSignal,
): Promise<DomainResult<ContentId | undefined>> {
  const { media } = record.source;
  if (media.kind === 'managed') return await stored(record, media.contentId, services, signal);
  const unchanged = await linkedUnchanged(record, media, services, signal);
  if (!unchanged.ok) return unchanged;
  if (unchanged.value) return succeed(undefined);
  return media.retainedCopy === undefined
    ? fail(mediaGone(record, 'whose linked file has changed or cannot be found'))
    : await stored(record, media.retainedCopy, services, signal);
}

/** Proves the stored object where it lies and holds it, or says it is gone. */
async function stored(
  record: AssetRecord,
  contentId: ContentId,
  services: AudioPasteServices,
  signal?: AbortSignal,
): Promise<DomainResult<ContentId>> {
  const opened = await services.store.open(contentId);
  if (!opened.ok) return fail(mediaGone(record, 'which this browser no longer stores'));
  const proved = await services.store.putNamed(
    opened.value,
    contentId,
    signal === undefined ? {} : { signal },
  );
  return proved.ok ? succeed(contentId) : proved;
}

/** Whether the linked file is still the one the record's identity names. */
async function linkedUnchanged(
  record: AssetRecord,
  media: ExternalMedia,
  services: AudioPasteServices,
  signal?: AbortSignal,
): Promise<DomainResult<boolean>> {
  const located = await services.locate(record.asset.id, media.identity, signal);
  if (located.kind === 'absent') return succeed(false);
  const observed = await examineFile(media.identity, located.file, services, signal);
  if (!observed.ok) return observed;
  const classified = classifySource(media.identity, { kind: 'present', file: observed.value });
  return succeed(classified.kind === 'unchanged');
}
