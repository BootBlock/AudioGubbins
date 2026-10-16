/**
 * Exports, served to the page (ADR-0092): staging an export the codec worker
 * encodes, delivering it to a destination the page chose, with the person
 * asked where a name is taken and the rules ask, and recording it in the
 * project's history; a download answered as a file of the staged parts, read
 * where they lie.
 *
 * The staging area is the worker's own, made once, so an export staged by one
 * call is delivered by another, as often as a refused delivery is retried.
 */

import { fileDestination, folderDestination } from '@audiogubbins/browser-storage';
import { fail, succeed, type DomainResult } from '@audiogubbins/domain';
import { nobleSha256 } from '@audiogubbins/model-packs';
import { ExportDestinationKind, type ExportCodec } from '@audiogubbins/project-format';
import {
  ExportStaging,
  deliverStaged,
  exportRecordOf,
  mediaSharingOf,
  stagedExportMissing,
  type DeliveryDestination,
  type DeliveryServices,
  type ProjectSession,
} from '@audiogubbins/storage';

import {
  stagingStream,
  type CrossingDestination,
  type DeliveryAnswer,
} from '../protocol/export-operations.js';
import type { PagePort } from '../protocol/page-operations.js';
import type { AreaHandlers, HostChannel } from '../protocol/storage-operations.js';
import { portEncodedStream } from './credited-stream-port.js';
import type { HostServices } from './host-services.js';
import type { OpenProjects } from './open-projects.js';
import { pagePrompt } from './remote-page-ports.js';

/** The operations of exports, over the worker's staging area and open projects. */
export function exportHandlers(
  services: HostServices,
  projects: OpenProjects,
  channel: HostChannel,
): AreaHandlers<'exports'> {
  const staging = new ExportStaging({
    tree: services.tree,
    sha256: nobleSha256,
    nextToken: services.nextToken,
    sharing: mediaSharingOf(services.coordinator),
  });
  const delivering: DeliveryServices = {
    sha256: nobleSha256,
    ids: services.ids,
    clock: services.clock,
  };
  return {
    'exports.stage': async ({ handle, stream, origin, report }, { signal }) => {
      const staged = await staging.stage(
        projects.session(handle).project,
        origin,
        portEncodedStream(stream),
        (bytesStaged) => {
          channel.emit(stagingStream(report), { bytesStaged });
        },
        signal,
      );
      if (!staged.ok) return staged;
      const { token, bytes, sha256, dropped } = staged.value;
      return succeed({ token, bytes, sha256, dropped });
    },
    'exports.deliver': async ({ handle, token, encoder, destination, prompt }, { signal }) => {
      const session = projects.session(handle);
      if (destination.kind === 'download') {
        return await download(
          session,
          staging,
          { token, encoder },
          destination,
          services,
          delivering,
        );
      }
      return await deliverStaged(
        session,
        staging,
        token,
        encoder,
        destinationOf(destination, channel, prompt),
        delivering,
        signal,
      );
    },
    'exports.discard': async ({ token }) => {
      await staging.discard(token);
      return undefined;
    },
  };
}

/**
 * The staged export as a file to download, of its parts as they lie in the
 * staging, recorded as delivered: the browser's download takes it from here,
 * and the page gives the staging up once it has.
 */
async function download(
  session: ProjectSession,
  staging: ExportStaging,
  { token, encoder }: { readonly token: string; readonly encoder: ExportCodec },
  destination: Extract<CrossingDestination, { readonly kind: 'download' }>,
  services: HostServices,
  delivering: DeliveryServices,
): Promise<DomainResult<DeliveryAnswer>> {
  const staged = staging.staged(token);
  const parts: Blob[] = [];
  const paths =
    staged === undefined ? [] : [staged.paths.head, staged.paths.body, staged.paths.tail];
  for (const path of paths) {
    const part = await services.fileAt(path);
    if (part !== undefined) parts.push(part);
  }
  if (staged === undefined || parts.length !== paths.length) {
    await staging.discard(token);
    return fail(stagedExportMissing(token));
  }
  const record = exportRecordOf(
    staged,
    encoder,
    { kind: ExportDestinationKind.Download },
    destination.name,
    delivering,
  );
  const kept = await session.recordExport(record);
  return succeed({
    kind: 'download',
    file: new Blob(parts, { type: destination.mediaType }),
    record,
    ...(kept.ok ? {} : { unrecorded: kept.failures[0] }),
  });
}

/** A destination as the storage delivers to it, over the handle the page passed. */
function destinationOf(
  destination: Exclude<CrossingDestination, { readonly kind: 'download' }>,
  channel: HostChannel,
  prompt: PagePort | undefined,
): DeliveryDestination {
  if (destination.kind === 'file') {
    return { kind: 'file', file: fileDestination(destination.handle) };
  }
  return {
    kind: 'folder',
    folder: folderDestination(destination.handle),
    path: destination.path,
    wanted: destination.wanted,
    policy: destination.policy,
    remembered: destination.remembered,
    trusted: destination.trusted,
    prompt: pagePrompt(channel, prompt),
  };
}
