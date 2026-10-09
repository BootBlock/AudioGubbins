/**
 * Distinct identifier types for every domain entity.
 *
 * Every identifier is a string at runtime, so without branding the compiler
 * would happily accept an `AssetId` where a `TrackId` belongs. In a model that
 * REQ-ARCH-004 requires to carry projects, assets, clips, regions, tracks,
 * processors and buses at once, that mistake is easy to make and invisible in
 * review. Branding makes it a compile error and costs nothing at runtime.
 *
 * REQ-PROD-056 requires identifiers to stay stable independently of display
 * names, so nothing here derives an identifier from a label.
 */

declare const BrandTag: unique symbol;

/** A string identifier that cannot be confused with another entity's. */
export type Branded<TBrand extends string> = string & { readonly [BrandTag]: TBrand };

/** Identifies a project. */
export type ProjectId = Branded<'ProjectId'>;

/** Identifies an immutable source asset. */
export type AssetId = Branded<'AssetId'>;

/** Identifies a clip: a placement of an asset region on a track. */
export type ClipId = Branded<'ClipId'>;

/** Identifies a named time range. */
export type RegionId = Branded<'RegionId'>;

/** Identifies a point marker on the timeline. */
export type MarkerId = Branded<'MarkerId'>;

/**
 * Identifies one edit operation in an asset's chain or a region's processing,
 * so an undo withdraws exactly the operation it was given.
 */
export type EditOperationId = Branded<'EditOperationId'>;

/** Identifies a track. */
export type TrackId = Branded<'TrackId'>;

/** Identifies a bus. */
export type BusId = Branded<'BusId'>;

/** Identifies a processor instance within an effect chain. */
export type ProcessorId = Branded<'ProcessorId'>;

/** Identifies a parallel group of processors within an effect chain. */
export type ProcessorGroupId = Branded<'ProcessorGroupId'>;

/** Identifies an effect chain. */
export type EffectChainId = Branded<'EffectChainId'>;

/** Identifies an automatable parameter on a processor. */
export type ParameterId = Branded<'ParameterId'>;

/** Every entity identifier the domain defines. */
export type EntityId =
  | ProjectId
  | AssetId
  | ClipId
  | RegionId
  | MarkerId
  | EditOperationId
  | TrackId
  | BusId
  | ProcessorId
  | ProcessorGroupId
  | EffectChainId
  | ParameterId;

/**
 * The shape an AudioGubbins identifier must have.
 *
 * Deliberately narrow: lower-case hexadecimal and hyphens only, between 8 and
 * 64 characters. A project file is shared, diffed and embedded in Godot
 * resources, so an identifier has to survive a filename, a URL fragment and a
 * GDScript string literal without escaping.
 */
const IDENTIFIER_PATTERN = /^[0-9a-f][0-9a-f-]{6,62}[0-9a-f]$/;

/**
 * Whether a string is shaped like an AudioGubbins identifier.
 *
 * This validates shape only. Whether the entity exists is a question for the
 * project that holds it.
 */
export function isWellFormedId(candidate: string): boolean {
  return IDENTIFIER_PATTERN.test(candidate);
}

/**
 * Brands an already-validated string as an identifier.
 *
 * Reserved for the identifier generator and for deserialisation code that has
 * checked the string with {@link isWellFormedId} first. Application code
 * obtains identifiers from the entities that own them, never by casting a
 * string.
 */
export function unsafeBrandId<TBrand extends string>(value: string): Branded<TBrand> {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- a brand is minted here and nowhere else
  return value as Branded<TBrand>;
}
