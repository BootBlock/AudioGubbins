/**
 * Every worker the page starts, started under the page's security policy.
 *
 * The policy is a `<meta>` tag the build writes into the page, and a worker
 * started from its script's own URL takes the policy of that script's
 * response instead (CSP Level 3), which a static host sends none of: the
 * worker could fetch from anywhere, and the inference and storage workers are
 * the threads that fetch at all. A worker started from a `blob:` URL inherits
 * the policy of the document that made it, so each is started from a module
 * of one line made here that imports its script by the script's absolute URL:
 * the script then runs in that worker under the page's policy, its
 * `connect-src` among it, and `worker-src` allows `blob:` for the module. The
 * module's URL is let go once the worker is made, since the worker holds what
 * it names from then.
 */

/** A worker started from its script's URL, as `Worker` is, under the page's policy. */
export type ModuleWorkerClass = new (script: string, name?: string) => Worker;

let made: ModuleWorkerClass | undefined;

/**
 * The kind of worker every worker of the page is, which a worker that must do
 * something of its own as it is made or terminated extends. Made when first
 * asked for, not as the module loads, since `Worker` is a global of a
 * browser's page alone.
 */
export function moduleWorkerClass(): ModuleWorkerClass {
  made ??= class ModuleWorker extends Worker {
    constructor(script: string, name?: string) {
      const absolute = new URL(script, document.baseURI).href;
      const module = URL.createObjectURL(
        new Blob([`import ${JSON.stringify(absolute)};\n`], { type: 'text/javascript' }),
      );
      super(module, { type: 'module', ...(name === undefined ? {} : { name }) });
      URL.revokeObjectURL(module);
    }
  };
  return made;
}
