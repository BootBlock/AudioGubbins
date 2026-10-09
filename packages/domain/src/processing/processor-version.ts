/**
 * What made a processor instance's sound, kept with the instance.
 *
 * REQ-AUDIO-145 asks for a processor's type, implementation version and
 * parameter schema version in authoritative state, with a model's identity and
 * version for an ML processor and the resampler's version where a conversion
 * is part of the processing. ADR-0061 persists them with every instance, so a
 * project names the algorithm that made each sound rather than leaving the
 * build that opens it to guess. Before 1.0 a version the reader does not know
 * is refused with the reason (REQ-STOR-052); from 1.0 a change that alters a
 * processor's output raises its version.
 */

import { failure, FailureKind, fail, succeed, type DomainResult } from '../result.js';

/**
 * A model an ML processor runs, as its pack names it, and the runtime build
 * that runs it, each by the hash of its bytes (ADR-0062).
 */
export interface ModelIdentity {
  /** The pack's stable name, for example `deepfilternet-3`. */
  readonly pack: string;
  /** The pack's version, as its manifest states it. */
  readonly version: string;
  /**
   * The SHA-256, in lower-case hexadecimal, of the listing of every file of
   * the pack's version, as {@link modelHashOf} takes it. A version is one
   * unit, its licences and notice with its models, so it is named by one
   * rule that anything holding its manifest can compute, and a change to
   * any of its files changes the name.
   */
  readonly modelHash: string;
  /** The SHA-256 of the inference runtime's WebAssembly, in lower-case hexadecimal. */
  readonly runtimeHash: string;
}

/** A file of a model pack as its manifest lists it: its path within the pack and its SHA-256. */
export interface ListedFile {
  readonly path: string;
  /** In lower-case hexadecimal. */
  readonly sha256: string;
}

/** The SHA-256 of a text's UTF-8 bytes, in lower-case hexadecimal. */
export type TextSha256 = (text: string) => string;

/** Two files in the code-unit order of their paths, which a pack's ASCII paths make byte order. */
function byPath(one: ListedFile, other: ListedFile): number {
  return one.path < other.path ? -1 : one.path > other.path ? 1 : 0;
}

/**
 * The model hash of a pack's version whose manifest lists `files`: the
 * SHA-256 of their listing as `sha256sum` writes one, for each file a line
 * of its hash, two spaces, its path and a line feed, sorted by path. The
 * digest is the caller's, `sha256`, because the domain depends on nothing
 * and reaches no platform global, and a hash is the platform's to give.
 */
export function modelHashOf(files: readonly ListedFile[], sha256: TextSha256): string {
  return sha256(
    files
      .toSorted(byPath)
      .map((file) => `${file.sha256}  ${file.path}\n`)
      .join(''),
  );
}

/** The versions an instance was made with. */
export interface ProcessorStateVersion {
  readonly implementation: number;
  readonly parameters: number;
  /** The resampler's version, where the processing converts a rate. */
  readonly resampler?: number;
  /** The model, for an ML processor. */
  readonly model?: ModelIdentity;
}

/**
 * State an instance holds that is not a parameter: a learned noise profile or
 * a mask. Its meaning is the processor's, and it is versioned with the
 * instance, so it is never read by a version that did not write it.
 */
export interface ProcessorState {
  /** What the values are, as the processor names them, for example `noise-profile`. */
  readonly kind: string;
  readonly values: readonly number[];
}

/** The most values a processor's state may hold: a spectrum of 65 536 bins and more. */
export const MAXIMUM_STATE_VALUES = 262_144;

const HASH = /^[0-9a-f]{64}$/;

/** Whether `identity` names a model by well-formed hashes. */
export function isModelIdentity(identity: ModelIdentity): boolean {
  return (
    identity.pack.length > 0 &&
    identity.version.length > 0 &&
    HASH.test(identity.modelHash) &&
    HASH.test(identity.runtimeHash)
  );
}

/** A model as a reader names it: its pack, its version and its hash. */
function modelName(model: ModelIdentity): string {
  return `${model.pack} ${model.version} (${model.modelHash})`;
}

/**
 * Whether two instances name one model: the same pack, version and hash of
 * the files it runs, or no model at all. The runtime is compared apart, so a
 * refusal says which of the two changed.
 */
function sameModel(found: ModelIdentity | undefined, implemented: ModelIdentity | undefined) {
  return (
    found?.pack === implemented?.pack &&
    found?.version === implemented?.version &&
    found?.modelHash === implemented?.modelHash
  );
}

/**
 * The instance's version where it is the one this build implements, or why
 * not, naming the processor so the person knows which to replace.
 */
export function checkStateVersion(
  typeKey: string,
  found: ProcessorStateVersion,
  implemented: ProcessorStateVersion,
): DomainResult<ProcessorStateVersion> {
  const differs: string[] = [];
  if (found.implementation !== implemented.implementation) differs.push('implementation');
  if (found.parameters !== implemented.parameters) differs.push('parameter schema');
  if (found.resampler !== implemented.resampler) differs.push('resampler');
  if (!sameModel(found.model, implemented.model)) differs.push('model');
  if (found.model?.runtimeHash !== implemented.model?.runtimeHash) {
    differs.push('inference runtime');
  }
  if (differs.length === 0) return succeed(found);
  return fail(
    failure(
      'processor.version-unknown',
      FailureKind.Unrecoverable,
      `This build does not have the ${differs.join(', ')} version that processor "${typeKey}" was saved with.`,
      {
        details: {
          typeKey,
          foundImplementation: found.implementation,
          implementedImplementation: implemented.implementation,
          foundParameters: found.parameters,
          implementedParameters: implemented.parameters,
          ...(found.model === undefined
            ? {}
            : { foundModel: modelName(found.model), foundRuntime: found.model.runtimeHash }),
          ...(implemented.model === undefined
            ? {}
            : {
                implementedModel: modelName(implemented.model),
                implementedRuntime: implemented.model.runtimeHash,
              }),
        },
      },
    ),
  );
}
