/**
 * The model packs' catalogue as this build configures it
 * (`model-pack-serving.ts` beside the build configuration): the application's
 * own origin under its base by default, or the absolute directory the build
 * was told to use.
 *
 * Reached by `import()` alone, from `pack-manager-part.ts`, as the inference
 * runtime's facts are: the build makes this module's source, and the
 * catalogue is needed only once the person asks for it.
 */

import { PACK_CATALOGUE } from 'virtual:audiogubbins/model-packs';

/** The catalogue's URL, absolute, for a page on `origin`. */
export function catalogueOn(origin: string): string {
  return PACK_CATALOGUE.kind === 'absolute'
    ? PACK_CATALOGUE.url
    : new URL(PACK_CATALOGUE.path, origin).href;
}
