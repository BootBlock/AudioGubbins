import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';

import type { JsonValue } from './canonical-json.js';
import { startReading, type Converter } from './document-reading.js';
import { writeExternalIdentity, writeMediaSource } from './project-writing.js';
import { readExternalIdentity, readMediaSource } from './source-reading.js';
import { randomIdentity, randomMedia, seededRandom } from './testing/random-values.js';

/** Reads one value alone, at the place `at`, as a command reads its argument. */
function readAlone<TValue>(convert: Converter<TValue>, value: JsonValue, at: string) {
  const reading = startReading();
  return reading.outcome(convert(reading, value, '', at));
}

describe('one source read and written alone', () => {
  it('reads back as the media and identity it was written from', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const random = seededRandom(seed);
      const media = randomMedia(random);
      const identity = randomIdentity(random);
      const context = `seed ${String(seed)}`;

      expect(
        expectSuccess(readAlone(readMediaSource, writeMediaSource(media), '')),
        context,
      ).toEqual(media);
      expect(
        expectSuccess(readAlone(readExternalIdentity, writeExternalIdentity(identity), '')),
        context,
      ).toEqual(identity);
    }
  });

  it('names each problem from the place the value is read at', () => {
    const result = readAlone(readMediaSource, { kind: 'external', policy: 'freeze' }, 'media');

    expect(
      result.ok ? [] : result.failures.map((problem) => [problem.code, problem.details?.['at']]),
    ).toEqual([
      ['schema.missing-member', 'media.identity'],
      ['source.freeze-without-retained-copy', 'media.policy'],
    ]);
  });
});
