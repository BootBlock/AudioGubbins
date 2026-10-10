/**
 * What the page knows the codecs can do here (ADR-0090): before the codec
 * worker has said anything, only whether WebAssembly runs, which the page's
 * capabilities read, with no module loaded and no browser codec probed; and
 * from then on, what the worker last said, replaced whole by each environment
 * it sends. A module that fails to load, or that the page had none of, makes
 * its codecs unavailable through it, with the reason.
 *
 * Read by whatever offers a format, such as the Export dialog, so a capability
 * is asked of the environment as it stands, never remembered.
 */

import {
  codecCapability,
  type CodecCapability,
  type CodecEnvironment,
  type CodecId,
  type CodecUse,
} from '@audiogubbins/codecs';

import { observable, type Observable } from '../state/observable.js';

/** The codecs' environment as the page holds it. */
export interface CodecEnvironmentStore extends Observable<CodecEnvironment> {
  /** Takes the environment the worker sent, in place of the one before. */
  adopt(environment: CodecEnvironment): void;

  /** What the environment as it stands can do with `codec` in `use`. */
  capability(codec: CodecId, use: CodecUse): CodecCapability;
}

/** The environment of a page whose codec worker has said nothing yet. */
function unstartedEnvironment(webAssembly: boolean): CodecEnvironment {
  return {
    webAssembly,
    codecModule: 'not-loaded',
    prebuiltModules: new Map(),
    browserDecoders: new Set(),
    browserEncoders: new Set(),
  };
}

/** The store, at first knowing only whether WebAssembly runs. */
export function createCodecEnvironmentStore(webAssembly: boolean): CodecEnvironmentStore {
  const environment = observable(unstartedEnvironment(webAssembly));
  return {
    get: environment.get,
    subscribe: environment.subscribe,
    adopt: environment.set,
    capability: (codec, use) => codecCapability(environment.get(), codec, use),
  };
}
