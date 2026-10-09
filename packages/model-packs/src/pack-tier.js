/**
 * A model pack's tier, REQ-AUDIO-139's "quality/performance tier": how quick
 * the pack's model is to run against how thorough its result is, a fact of
 * the model alone, which a person weighs when choosing between packs that
 * serve one purpose.
 *
 * It is no render mode. Every render and preview quality runs a model the same
 * pinned way (ADR-0062), so nothing set for quality changes a pack's tier or is
 * changed by it, and the tiers share no name with those levels.
 *
 * JavaScript with its types in JSDoc, which the package's compiler checks, so
 * the pack build tool holds a definition's tier to this one list in Node,
 * which runs no compiler. It imports nothing.
 */

/** The tiers, from the quickest model to the most thorough. */
export const PackTier = /** @type {const} */ ({
  /** Quick to run, with a lighter result. */
  Light: 'light',
  /** Between the two. */
  Balanced: 'balanced',
  /** The slowest to run, with the most thorough result. */
  Thorough: 'thorough',
});

/** @typedef {(typeof PackTier)[keyof typeof PackTier]} PackTier */

/** Every tier, in the order of {@link PackTier}. */
export const PACK_TIERS = /** @type {readonly PackTier[]} */ (Object.values(PackTier));
