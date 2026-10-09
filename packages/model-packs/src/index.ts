/**
 * The public contract of AudioGubbins model packs (ADR-0062, REQ-AUDIO-139).
 *
 * A pack's manifest, `ModelPackManifest`, and the one reader that admits a
 * manifest or a catalogue from text nobody here wrote; the install state
 * machine (REQ-ARCH-153); the integrity check over an injected SHA-256, and the
 * streaming SHA-256 to inject, the same in the browser and in Node; the source
 * port a catalogue is listed and a file read through, with its two
 * implementations, the download over HTTP, one of the two modules in the
 * repository that reach the network, and the files a person already has, read
 * from a pack's folder; the store port the storage package keeps packs through;
 * the installer that composes them; and which of REQ-AUDIO-139's conditions
 * holds for a processor or detector a project names, and for one pack version
 * as the pack manager lists it. Everything absent from this list is internal
 * and may change without being a contract change (REQ-REPO-186).
 */

export {
  type ModelPackManifest,
  type PackFile,
  type PackLicence,
  type PackRef,
  type PackRuntime,
  type PackServes,
  packKey,
  refOf,
} from './manifest.js';
export { PackCapability } from './pack-capability.js';
export { PackTier } from './pack-tier.js';
export { manifestConverter, readModelPackManifest } from './manifest-reading.js';
export { readPackCatalogue } from './catalogue-reading.js';
export { manifestJson } from './manifest-writing.js';

export { type InstallEvent, type InstallState, nextInstallState } from './install-state.js';
export { type KeptFile, type Sha256, type Sha256Run } from './integrity.js';
export { nobleSha256, nobleTextSha256 } from './adapter/noble-sha256.js';

export { type FileRange, type PackSource, type ReceiveChunk } from './pack-source.js';
export {
  HttpPackSource,
  type PackBodyRead,
  type PackBodyReader,
  type PackFetch,
  type PackRequest,
  type PackResponse,
} from './adapter/http-pack-source.js';
export { ImportedPackSource } from './imported-pack-source.js';
export { type ImportedPack, type PackFolder, readPackFolder } from './pack-folder.js';

export { type KeptPack, type PackStore } from './pack-store.js';
export {
  type InstallerServices,
  PackInstaller,
  type Retention,
  VERSION_PINNED,
} from './pack-installer.js';
export { type Installation, VERSION_BUSY } from './installations.js';
export { type UpdateOutcome, updatePack } from './pack-update.js';

export {
  type AvailabilityContext,
  type KnownPack,
  type LocalInferenceSupport,
  type PackAvailability,
  type PackNeed,
} from './availability-context.js';
export { availabilityOf } from './availability.js';
export { type VersionAvailability, versionAvailability } from './version-availability.js';
export { type PackVersionCondition, packVersionCondition } from './pack-conditions.js';
