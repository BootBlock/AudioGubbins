/**
 * The model packs, served to the page (ADR-0062, REQ-AUDIO-139): the worker's
 * one installer over the store it keeps packs in, and each change of an
 * installation sent on the stream of packs.
 *
 * The installer learns what the store keeps once, before the first operation
 * that needs it, and follows every change after, a cleanup's removals among
 * them, since each goes through it. A download asks the catalogue the page
 * names, over HTTP, for the version's files and nothing else; it is never
 * begun but by the page's asking. A file read for a model to run is checked
 * as it is read, and its buffer moved to the page rather than copied. A
 * version a project needs, as the pins say, is refused removal unless the
 * person removes it knowingly.
 */

import { succeed, type DomainResult } from '@audiogubbins/domain';
import { HttpPackSource } from '@audiogubbins/model-packs';

import { Transferring, type Answered } from '../protocol/operations.js';
import type { AreaHandlers, HostChannel } from '../protocol/storage-operations.js';
import type { HostServices } from './host-services.js';

/** The packs' operations, over the worker's installer, telling the page each change on `channel`. */
export function packHandlers(services: HostServices, channel: HostChannel): AreaHandlers<'packs'> {
  const { packInstaller: installer, packPins } = services;
  services.onPackChanged((ref, state) => {
    channel.emit('packs', { ref, state });
  });
  let restored: Promise<DomainResult<void>> | undefined;
  /**
   * `work`'s answer once the installer has learnt what the store keeps: once,
   * a failed reading tried again by the next operation.
   */
  const known = async <TValue>(
    work: () => Promise<Answered<DomainResult<TValue>>>,
  ): Promise<Answered<DomainResult<TValue>>> => {
    restored ??= installer.restore();
    const learnt = await restored;
    if (!learnt.ok) {
      restored = undefined;
      return learnt;
    }
    return await work();
  };
  return {
    'packs.installations': () => known(() => Promise.resolve(succeed(installer.installations()))),
    'packs.catalogue': ({ catalogue }, { signal }) =>
      new HttpPackSource(catalogue).catalogue(signal),
    'packs.download': ({ catalogue, manifest }, { signal }) =>
      known(() => installer.download(manifest, new HttpPackSource(catalogue), signal)),
    'packs.resume': ({ catalogue, ref }, { signal }) =>
      known(() => installer.resume(ref, new HttpPackSource(catalogue), signal)),
    'packs.retry': ({ catalogue, ref }, { signal }) =>
      known(() => installer.retry(ref, new HttpPackSource(catalogue), signal)),
    'packs.pause': (ref) => Promise.resolve(installer.pause(ref)),
    'packs.cancel': (ref) => known(() => installer.cancel(ref)),
    'packs.remove': ({ ref, knowingly }, { signal }) =>
      known(async () => {
        const pins = await packPins(signal);
        // Where the pins cannot be told, any version may be needed, so each
        // is treated as needed: removed only knowingly.
        const pinned = pins.ok ? pins.value : [ref];
        return await installer.remove(ref, { pinned, knowingly });
      }),
    'packs.read': ({ ref, path }, { signal }) =>
      known(async () => {
        const read = await installer.read(ref, path, signal);
        // The installer reads a file into a buffer of its own, sized by the
        // manifest, so moving the buffer moves the file and nothing beside it.
        return read.ok ? new Transferring(read, [read.value.bytes.buffer]) : read;
      }),
  };
}
