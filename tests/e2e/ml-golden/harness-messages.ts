/**
 * What the golden harness's page and its thread say to each other: a render
 * asked for by the golden's name, and its answer.
 */

/** A render of the golden named `name`. */
export interface RenderRequest {
  readonly kind: 'render';
  readonly name: string;
}

/** A golden rendered: the samples it made and the SHA-256 of their bytes, or why it failed. */
export type FromHarnessThread =
  | {
      readonly kind: 'rendered';
      readonly name: string;
      readonly samples: number;
      readonly sha256: string;
    }
  | { readonly kind: 'failed'; readonly name: string; readonly reason: string };

/** Whether `value` is a {@link RenderRequest}. */
export function isRenderRequest(value: unknown): value is RenderRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    Reflect.get(value, 'kind') === 'render' &&
    typeof Reflect.get(value, 'name') === 'string'
  );
}

/** Whether `value` is an answer from the thread. */
export function isHarnessAnswer(value: unknown): value is FromHarnessThread {
  if (typeof value !== 'object' || value === null) return false;
  const kind: unknown = Reflect.get(value, 'kind');
  return (
    typeof Reflect.get(value, 'name') === 'string' &&
    ((kind === 'rendered' &&
      typeof Reflect.get(value, 'samples') === 'number' &&
      typeof Reflect.get(value, 'sha256') === 'string') ||
      (kind === 'failed' && typeof Reflect.get(value, 'reason') === 'string'))
  );
}
