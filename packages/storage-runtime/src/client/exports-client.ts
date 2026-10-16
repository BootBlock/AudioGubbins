/**
 * Exports, as the page asks the storage worker for them (ADR-0092): staging
 * what the codec worker encodes, delivering it where the person chose, and
 * giving it up.
 *
 * The page holds the destinations: a save dialog's file, a folder it chose,
 * and the folders kept trusted, whose records of what was exported into each
 * it keeps (`TrustedFolders` in `@audiogubbins/browser-storage`). A delivery
 * into a folder may go into a relative folder inside it (ADR-0102). A delivery
 * into a trusted folder crosses with its records, and the record of the file
 * written is kept once it is delivered, under its path from the trusted folder
 * (`trustedRecordName`), so the next export to the same path overwrites it
 * without asking while it stays as written.
 */

import { FailureKind, fail, failure, type DomainResult } from '@audiogubbins/domain';
import type { TrustedFolders } from '@audiogubbins/browser-storage';
import type {
  CollisionAnswer,
  CollisionPolicy,
  ExportFileName,
  ExportedFileRecord,
} from '@audiogubbins/import-export';
import type { ExportCodec } from '@audiogubbins/project-format';
import { trustedRecordName, type CollisionPrompt, type ExportOrigin } from '@audiogubbins/storage';

import {
  stagingStream,
  type CrossingDestination,
  type DeliveryAnswer,
  type StagedFile,
} from '../protocol/export-operations.js';
import type { ClientChannel } from '../protocol/storage-operations.js';
import type { LendingCall } from './page-ports.js';
import type { RemoteProjectSession } from './remote-project.js';

/** What every folder delivery decides a taken name by, and the folder inside it the file goes into. */
interface FolderRules {
  /**
   * The folders inside the one chosen or trusted that the file goes into,
   * outermost first, made where they are not there; absent, the file goes
   * into that folder itself, as an export from the Export dialog does.
   */
  readonly path?: readonly string[];
  readonly wanted: ExportFileName;
  readonly policy: CollisionPolicy;

  /** The answer given for the rest of the batch, if one was. */
  readonly remembered: CollisionAnswer | undefined;

  /** Asks the person what to do with a taken name, from the control they used. */
  readonly prompt: CollisionPrompt;
}

/** The path of a delivery into the folder chosen or trusted itself. */
const THE_FOLDER_ITSELF: readonly string[] = [];

/** Where the page delivers a staged export. */
export type PageDestination =
  | { readonly kind: 'file'; readonly handle: FileSystemFileHandle }
  | ({ readonly kind: 'folder'; readonly handle: FileSystemDirectoryHandle } & FolderRules)
  | ({
      readonly kind: 'trusted-folder';
      readonly folders: TrustedFolders;

      /** The key the folder is kept trusted under. */
      readonly key: string;
    } & FolderRules)
  | { readonly kind: 'download'; readonly name: string; readonly mediaType: string };

/** An export to stage: the port the codec worker writes it to, and what it was made from. */
export interface ExportStage {
  readonly stream: MessagePort;
  readonly origin: ExportOrigin;
}

/** Staging, delivering and giving up exports. */
export interface ExportsClient {
  /**
   * Stages the export of the project `session` writes that the codec worker
   * encodes to `request.stream`, telling `staged` the body's bytes as they
   * are written. Called off, it keeps nothing.
   */
  stage(
    session: RemoteProjectSession,
    request: ExportStage,
    staged: (bytesStaged: number) => void,
    signal?: AbortSignal,
  ): Promise<DomainResult<StagedFile>>;

  /**
   * Delivers the export staged as `token` to `destination`, recorded in the
   * history of the project `session` writes as written by `encoder`; a
   * refused delivery keeps it staged for a retry or another destination.
   */
  deliver(
    session: RemoteProjectSession,
    token: string,
    encoder: ExportCodec,
    destination: PageDestination,
    signal?: AbortSignal,
  ): Promise<DomainResult<DeliveryAnswer>>;

  /** Gives up the export staged as `token`: downloaded, or no longer wanted. */
  discard(token: string): Promise<void>;
}

/** A staged export, and the encoder that wrote it, which its record names. */
interface Staged {
  readonly token: string;
  readonly encoder: ExportCodec;
}

/** A trusted folder the page no longer keeps. */
function trustedFolderMissing(): DomainResult<never> {
  return fail(
    failure(
      'export.trusted-folder-missing',
      FailureKind.Conflict,
      'That trusted folder is no longer kept; choose it again, or another destination. The export is kept.',
    ),
  );
}

/** Staging and delivering exports, over calls to the worker and calls that lend a prompt. */
export function exportsClient(channel: ClientChannel, call: LendingCall): ExportsClient {
  let staging = 0;
  return {
    stage: async (session, { stream, origin }, staged, signal) => {
      staging += 1;
      const report = `export-${String(staging)}`;
      const stop = channel.listen(stagingStream(report), ({ bytesStaged }) => {
        staged(bytesStaged);
      });
      try {
        return await channel.call(
          'exports.stage',
          { handle: session.handle, stream, origin, report },
          { signal, transfer: [stream] },
        );
      } finally {
        stop();
      }
    },
    deliver: async (session, token, encoder, destination, signal) =>
      destination.kind === 'trusted-folder'
        ? await deliveredTrusted(call, session, { token, encoder }, destination, signal)
        : await delivered(
            call,
            session,
            { token, encoder },
            crossingOf(destination, undefined),
            signal,
          ),
    discard: async (token) => {
      await channel.call('exports.discard', { token });
    },
  };
}

/** Delivers a staged export to a destination as it crosses, lending its prompt where it asks. */
async function delivered(
  call: LendingCall,
  session: RemoteProjectSession,
  staged: Staged,
  { crossing, prompt }: ReturnType<typeof crossingOf>,
  signal: AbortSignal | undefined,
): Promise<DomainResult<DeliveryAnswer>> {
  return await call(
    'exports.deliver',
    (lend) => ({
      handle: session.handle,
      token: staged.token,
      encoder: staged.encoder,
      destination: crossing,
      ...(prompt === undefined ? {} : { prompt: lend.prompt(prompt) }),
    }),
    signal,
  );
}

/**
 * Delivers a staged export into a folder kept trusted, with the records of
 * what was exported there before, and keeps the record of the file written.
 */
async function deliveredTrusted(
  call: LendingCall,
  session: RemoteProjectSession,
  staged: Staged,
  destination: Extract<PageDestination, { readonly kind: 'trusted-folder' }>,
  signal: AbortSignal | undefined,
): Promise<DomainResult<DeliveryAnswer>> {
  const kept = await destination.folders.find(destination.key);
  if (kept === undefined) return trustedFolderMissing();
  const crossing = crossingOf(
    { ...destination, kind: 'folder', handle: kept.folder },
    kept.records,
  );
  const answer = await delivered(call, session, staged, crossing, signal);
  if (answer.ok && answer.value.kind === 'delivered') {
    const { name, record } = answer.value;
    const file = record.file;
    if (file !== undefined) {
      await destination.folders.record(destination.key, [
        {
          name: trustedRecordName(destination.path ?? THE_FOLDER_ITSELF, name),
          size: file.byteLength,
          hash: file.sha256,
        },
      ]);
    }
  }
  return answer;
}

/**
 * A destination as it crosses to the worker, with the records of what was
 * exported there before where it is kept trusted, and the prompt it lends,
 * where a folder may ask.
 */
function crossingOf(
  destination: Exclude<PageDestination, { readonly kind: 'trusted-folder' }>,
  trusted: readonly ExportedFileRecord[] | undefined,
): { readonly crossing: CrossingDestination; readonly prompt: CollisionPrompt | undefined } {
  switch (destination.kind) {
    case 'file':
      return { crossing: { kind: 'file', handle: destination.handle }, prompt: undefined };
    case 'download':
      return {
        crossing: { kind: 'download', name: destination.name, mediaType: destination.mediaType },
        prompt: undefined,
      };
    case 'folder':
      return {
        crossing: {
          kind: 'folder',
          handle: destination.handle,
          path: destination.path ?? THE_FOLDER_ITSELF,
          wanted: destination.wanted,
          policy: destination.policy,
          remembered: destination.remembered,
          trusted,
        },
        prompt: destination.prompt,
      };
  }
}
