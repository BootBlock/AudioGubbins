/**
 * The modules the codec worker loads, each once, on the first request that
 * needs it (ADR-0090, ADR-0091): the codec module, and the prebuilt MP3 and
 * Vorbis encoders. The page compiles each from the bytes it bundles and hands
 * it over (`ModuleSource`); the worker instantiates the codec module and
 * hands the encoders' modules to the encoders that instantiate them.
 *
 * A load that fails stays failed, and says why: the formats the module serves
 * are unavailable here with that reason, and every other format keeps
 * working (the packet's failure behaviour). Each load's progress is reported
 * as the registry's `ModuleLoad`, so the worker tells the page whenever one
 * changes.
 */

import type { ModuleLoad } from '@audiogubbins/codecs';
import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';

import { instantiateCodecModule, type CodecModule } from '../codec-module.js';
import type { ModuleSource } from './codec-worker-messages.js';

/** The module `source` names, or why the page had none, saying what it is. */
function compiledModule(what: string, source: ModuleSource): DomainResult<WebAssembly.Module> {
  if (source.kind === 'compiled') return succeed(source.module);
  return fail(
    failure(
      'codec-runtime.module-load-failed',
      FailureKind.Unrecoverable,
      `The ${what} could not be loaded: ${source.reason}`,
      { details: { module: what } },
    ),
  );
}
/** A module loaded at most once, on first use, and how far its load has gone. */
export class OnceLoaded<TModule> {
  readonly #load: () => Promise<DomainResult<TModule>>;
  readonly #changed: () => void;
  #loading: Promise<DomainResult<TModule>> | undefined;
  #state: ModuleLoad = 'not-loaded';

  /** `changed` hears each change of the load's state. */
  constructor(load: () => Promise<DomainResult<TModule>>, changed: () => void) {
    this.#load = load;
    this.#changed = changed;
  }

  get state(): ModuleLoad {
    return this.#state;
  }

  /** The module, loading it on the first call; every later call answers the same. */
  get(): Promise<DomainResult<TModule>> {
    this.#loading ??= this.#load().then((loaded) => {
      this.#state = loaded.ok ? 'loaded' : 'failed';
      this.#changed();
      return loaded;
    });
    return this.#loading;
  }
}

/** The codec module `source` names, instantiated and checked, loaded once. */
export function codecModuleLoad(
  source: ModuleSource,
  changed: () => void,
): OnceLoaded<CodecModule> {
  return new OnceLoaded(async () => {
    const compiled = compiledModule('codec module', source);
    return compiled.ok ? await instantiateCodecModule(compiled.value) : compiled;
  }, changed);
}

/** A prebuilt encoder's module `source` names, compiled, loaded once. */
export function prebuiltModuleLoad(
  name: string,
  source: ModuleSource,
  changed: () => void,
): OnceLoaded<WebAssembly.Module> {
  return new OnceLoaded(() => Promise.resolve(compiledModule(`${name} encoder`, source)), changed);
}
