/**
 * The modules the codec worker loads, each once, on the first request that
 * needs it (ADR-0090, ADR-0091): the codec module, and the MP3 and Vorbis
 * encoder modules. The page compiles each from the bytes it bundles and hands
 * it over (`ModuleSource`); the worker instantiates the codec module and
 * hands the encoders' modules to the encoders that instantiate them.
 *
 * A load that fails stays failed, and says why: the formats the module serves
 * are unavailable here with that reason, and every other format keeps working
 * (the packet's failure behaviour). A module the page had none of has failed
 * from the start, so its formats are unavailable before any request finds it
 * so. Each load's progress is reported as the registry's `ModuleLoad`, so the
 * worker tells the page whenever one changes.
 *
 * Why a load failed is the error that failed it, as the browser or the module
 * says it: the page's, where it could not load or compile the module's bytes,
 * or the worker's, where it could not instantiate the module. The person reads
 * it wherever the formats are said to be unavailable, an import's refusal and
 * the Export dialog among them, so it is redacted here, where it becomes the
 * load's reason, by the rules that redact the person's diagnostics: a URL or a
 * path in a browser's message never reaches them.
 */

import type { ModuleLoad } from '@audiogubbins/codecs';
import { previewRedaction } from '@audiogubbins/diagnostics';
import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';

import { instantiateCodecModule, type CodecModule } from '../codec-module.js';
import type { ModuleSource } from './codec-worker-messages.js';

const NOT_LOADED: ModuleLoad = { kind: 'not-loaded' };
const LOADED: ModuleLoad = { kind: 'loaded' };

/** A load that failed, with why. */
type FailedLoad = Extract<ModuleLoad, { readonly kind: 'failed' }>;

/** A load that failed for `reason`, redacted for the person to read. */
function failedFor(reason: string): FailedLoad {
  return { kind: 'failed', reason: previewRedaction(reason).text };
}

/** The failure of a request that needs a module whose load failed for `load.reason`. */
function loadFailure(what: string, load: FailedLoad): DomainResult<never> {
  return fail(
    failure(
      'codec-runtime.module-load-failed',
      FailureKind.Unrecoverable,
      `The ${what} could not be loaded: ${load.reason}`,
      { details: { module: what } },
    ),
  );
}

/** A module loaded at most once, on first use, and how far its load has gone. */
export class OnceLoaded<TModule> {
  readonly #load: () => Promise<DomainResult<TModule>>;
  readonly #changed: () => void;
  #loading: Promise<DomainResult<TModule>> | undefined;
  #state: ModuleLoad = NOT_LOADED;

  /** `changed` hears each change of the load's state. */
  constructor(load: () => Promise<DomainResult<TModule>>, changed: () => void) {
    this.#load = load;
    this.#changed = changed;
  }

  /**
   * A load of `what` that failed before it began, as `state` says, answering
   * its failure whenever it is asked.
   */
  static failed<TModule>(what: string, state: FailedLoad): OnceLoaded<TModule> {
    const failed = loadFailure(what, state);
    const load = new OnceLoaded<TModule>(
      () => Promise.resolve(failed),
      () => undefined,
    );
    load.#state = state;
    load.#loading = Promise.resolve(failed);
    return load;
  }

  get state(): ModuleLoad {
    return this.#state;
  }

  /** The module, loading it on the first call; every later call answers the same. */
  get(): Promise<DomainResult<TModule>> {
    this.#loading ??= this.#load().then((loaded) => {
      this.#state = loaded.ok ? LOADED : failedFor(loaded.failures[0].summary);
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
  if (source.kind === 'unavailable') {
    return OnceLoaded.failed('codec module', failedFor(source.reason));
  }
  const { module } = source;
  return new OnceLoaded(() => instantiateCodecModule(module), changed);
}

/** An encoder module `source` names, compiled, loaded once. */
export function encoderModuleLoad(
  name: string,
  source: ModuleSource,
  changed: () => void,
): OnceLoaded<WebAssembly.Module> {
  if (source.kind === 'unavailable') {
    return OnceLoaded.failed(`${name} encoder`, failedFor(source.reason));
  }
  const compiled = succeed(source.module);
  return new OnceLoaded(() => Promise.resolve(compiled), changed);
}
