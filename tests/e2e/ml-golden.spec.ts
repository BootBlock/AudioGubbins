import { expect } from '@playwright/test';

import { ML_GOLDENS } from '../../packages/processors/src/testing/ml-goldens.js';
import { test } from './test.js';

/**
 * The machine-learning goldens in every browser the suite drives (ADR-0062):
 * each pack's pinned render, run in the browser through the real inference
 * worker over the pack's own files, makes the samples whose SHA-256 the Node
 * goldens hold it to, one digest for every engine, from the one table of
 * them (`ml-goldens.ts`). A browser whose bits differ fails here: one hash,
 * or a tolerance documented and tested, is ADR-0062's choice to make, never
 * this spec's.
 *
 * The harness (`ml-golden/`) is served beside the application by the
 * suite's own server, which serves the built packs from the cache
 * `AUDIOGUBBINS_PACK_CACHE` names (`pnpm packs:build`). Without the packs
 * the test fails, saying how to make them; it is never skipped.
 */

/** Where the harness is served. */
const HARNESS = 'http://127.0.0.1:4175/';

/**
 * How long a golden may take: MossFormer2's two segments on one thread take
 * about fifteen seconds in the slowest engine here.
 */
const RENDER = 300_000;

/** The harness's answer, as the page gives it. */
interface Answer {
  readonly kind: string;
  readonly samples?: number;
  readonly sha256?: string;
  readonly reason?: string;
}

test('renders every pack’s golden to its SHA-256 through the inference worker', async ({
  page,
}) => {
  test.setTimeout(ML_GOLDENS.length * RENDER);
  expect(
    process.env['AUDIOGUBBINS_PACK_CACHE'] ?? '',
    'AUDIOGUBBINS_PACK_CACHE names no pack cache: build the packs with `pnpm packs:build` and name its cache.',
  ).not.toBe('');
  await page.goto(HARNESS);
  for (const golden of ML_GOLDENS) {
    await test.step(golden.name, async () => {
      const answer = await page.evaluate(async (name): Promise<Answer> => {
        const render: unknown = Reflect.get(window, 'renderGolden');
        if (typeof render !== 'function') {
          return { kind: 'failed', reason: 'No harness on the page.' };
        }
        const answered: unknown = await Reflect.apply(render, undefined, [name]);
        return typeof answered === 'object' && answered !== null
          ? { ...answered, kind: String(Reflect.get(answered, 'kind')) }
          : { kind: 'failed', reason: 'The harness gave no answer.' };
      }, golden.name);
      // Soft, so one golden's failure leaves the others measured and said.
      expect.soft(answer.reason, `${golden.name} failed in the browser`).toBeUndefined();
      expect
        .soft({ samples: answer.samples, sha256: answer.sha256 }, golden.name)
        .toEqual({ samples: golden.samples, sha256: golden.sha256 });
    });
  }
});
