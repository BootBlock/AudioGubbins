/**
 * What the storage worker keeps model packs with (ADR-0062, REQ-AUDIO-139):
 * the store beside the projects, the worker's one installer over it, which
 * the page's operations and a cleanup's removals both go through, so every
 * change of a version is a step of its state machine and one pack downloads
 * at a time, and the pins that say which versions the projects need.
 */

import {
  PackInstaller,
  nobleSha256,
  type InstallState,
  type PackRef,
} from '@audiogubbins/model-packs';
import type { Digest, StorageTree } from '@audiogubbins/project-format';
import {
  ModelPackStore,
  projectPackPins,
  type LeaseCoordinator,
  type PackPins,
} from '@audiogubbins/storage';

/** How each state a version's installation enters is heard. */
export type PackChanged = (ref: PackRef, state: InstallState) => void;

/** What the worker keeps model packs with (see the module comment). */
export interface PackServices {
  readonly packs: ModelPackStore;
  readonly packInstaller: PackInstaller;
  readonly packPins: PackPins;

  /** Hears each state a version's installation enters, until the answer is called. */
  readonly onPackChanged: (listener: PackChanged) => () => void;
}

/** The packs kept in `tree`, whose transfers share `coordinator`'s storage-wide lock. */
export function packServices(
  tree: StorageTree,
  digest: Digest,
  coordinator: LeaseCoordinator | undefined,
): PackServices {
  const packs = new ModelPackStore(tree, digest, coordinator);
  const listeners = new Set<PackChanged>();
  return {
    packs,
    packInstaller: new PackInstaller({
      store: packs,
      sha256: nobleSha256,
      changed: (ref, state) => {
        for (const listener of [...listeners]) listener(ref, state);
      },
    }),
    packPins: projectPackPins(tree, digest),
    onPackChanged: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
