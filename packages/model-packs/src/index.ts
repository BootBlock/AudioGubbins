/**
 * The public contract of AudioGubbins model packs (ADR-0062, REQ-AUDIO-139).
 *
 * A pack's manifest, `ModelPackManifest`, and the one reader that admits a
 * manifest or a catalogue from text nobody here wrote; the install state
 * machine (REQ-ARCH-153); the integrity check over an injected SHA-256; the
 * source port a catalogue is listed and a file read through, with its two
 * implementations, the download over HTTP, which is the one module in the
 * repository that reaches the network, and the files a person already has; the
 * store port the storage package keeps packs through; the installer that
 * composes them; and which of REQ-AUDIO-139's conditions holds for a processor
 * or detector a project names. Everything absent from this list is internal and
 * may change without being a contract change (REQ-REPO-186).
 */

export {
  type ModelPackManifest,
  PackCapability,
  type PackFile,
  type PackLicence,
  type PackRef,
  type PackRuntime,
  type PackServes,
  packKey,
  refOf,
} from './manifest.js';
export { manifestConverter, readModelPackManifest } from './manifest-reading.js';
export { readPackCatalogue } from './catalogue-reading.js';
export { manifestJson } from './manifest-writing.js';

export { type InstallEvent, type InstallState, nextInstallState } from './install-state.js';
export { type Sha256, type Sha256Run } from './integrity.js';

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

export { type KeptPack, type PackStore } from './pack-store.js';
export { type InstallerServices, PackInstaller, type Retention } from './pack-installer.js';
export { type Installation } from './installations.js';
export { type UpdateOutcome, updatePack } from './pack-update.js';

export {
  type AutomaticDownload,
  type AvailabilityContext,
  type KnownPack,
  type LocalInferenceSupport,
  type PackAvailability,
  type PackNeed,
  availabilityOf,
  packsToFetch,
} from './availability.js';
