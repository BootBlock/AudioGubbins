/**
 * A model pack read for a golden render from the cache the pack build fills
 * (`tools/model-packs/build-packs.mjs`), outside the repository, which never
 * holds a pack's files (REQ-REPO-191). `AUDIOGUBBINS_PACK_CACHE` names the
 * cache; without it, or without the pack in it, a golden fails, saying how to
 * make the pack, and never skips.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { succeed, type ModelIdentity } from '@audiogubbins/domain';

import type { ModelLibrary } from '../ml/model-library.js';
import { sha256Of } from './model-services.js';

/** Where the pack build writes the pack `identity` names, under the cache; throws where it is not. */
function packFolder({ pack, version }: ModelIdentity): string {
  const how =
    `Build the pack with \`node tools/model-packs/build-packs.mjs ${pack}\` and set ` +
    'AUDIOGUBBINS_PACK_CACHE to the cache it used.';
  const cache = process.env['AUDIOGUBBINS_PACK_CACHE'];
  if (cache === undefined || cache === '') {
    throw new Error(
      `The golden render reads ${pack} from the pack cache, which no variable names. ${how}`,
    );
  }
  const folder = join(cache, 'catalogue', pack, version);
  if (!existsSync(folder))
    throw new Error(`The pack cache holds no ${pack} ${version} at ${folder}. ${how}`);
  return folder;
}

/**
 * The model library over the pack build's output of the pack `identity`
 * names, each file hashed as it is read, so the sessions check its bytes
 * against the definition as they would an installed pack's.
 */
export function packCacheLibrary(identity: ModelIdentity): ModelLibrary {
  const folder = packFolder(identity);
  return {
    // The folder was found as the library was made, or it throws.
    available: () => Promise.resolve(succeed(undefined)),
    file: (_pack, _version, path) => {
      const bytes = new Uint8Array(readFileSync(join(folder, path)));
      return Promise.resolve(succeed({ bytes, sha256: sha256Of(bytes) }));
    },
  };
}
