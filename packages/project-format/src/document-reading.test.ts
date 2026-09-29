import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import {
  entitiesOf,
  listConverter,
  pathOf,
  startReading,
  type Converter,
} from './document-reading.js';
import { asId, textConverter } from './scalar-reading.js';

describe('pathOf', () => {
  it('writes a member after a dot and an item in brackets, from the root without a dot', () => {
    expect(pathOf('', 'project')).toBe('project');
    expect(pathOf('project', 'clips')).toBe('project.clips');
    expect(pathOf('project.clips', 3)).toBe('project.clips[3]');
  });
});

describe('startReading', () => {
  it('reports every problem, each with where it was', () => {
    const reading = startReading();
    const readName = textConverter({ maximumLength: 3 });
    const names = listConverter(10, readName);
    names(reading, ['ok', 'long', 7, 'yes', 'longer'], 'names', 'list');

    const result = reading.outcome<string>(undefined);
    expect(
      result.ok ? [] : result.failures.map((problem) => [problem.code, problem.details?.['at']]),
    ).toEqual([
      ['schema.text-too-long', 'names.list[1]'],
      ['schema.not-a-string', 'names.list[2]'],
      ['schema.text-too-long', 'names.list[4]'],
    ]);
  });

  it('lists at most a hundred problems and counts the rest', () => {
    const reading = startReading();
    const items = Array.from({ length: 130 }, () => 'not an id');
    listConverter(200, asId<'TrackId'>)(reading, items, '', 'tracks');

    const result = reading.outcome<unknown>(undefined);
    const failures = result.ok ? [] : result.failures;
    expect(failures).toHaveLength(101);
    expect(failures.at(-1)).toMatchObject({
      code: 'schema.further-problems',
      details: { omitted: 30 },
    });
  });

  it('keeps a domain failure as the cause of the integrity violation it becomes', () => {
    const reading = startReading();
    const domainFailure = {
      code: 'time.sample-rate-out-of-range',
      kind: 'rejected',
      summary: 'Too fast.',
    } as const;
    reading.refuseAll([domainFailure], 'project.settings.sampleRate');
    const result = reading.outcome<unknown>(undefined);
    expect(result.ok ? undefined : result.failures[0]).toEqual({
      code: 'time.sample-rate-out-of-range',
      kind: 'integrity-violation',
      summary: 'Too fast.',
      details: { at: 'project.settings.sampleRate' },
      cause: domainFailure,
    });
  });

  it('succeeds with the value when nothing was refused', () => {
    expect(expectSuccess(startReading().outcome(42))).toBe(42);
  });

  it('throws when a reader returns nothing without refusing anything, which is a bug', () => {
    expect(() => startReading().outcome(undefined)).toThrow('recorded no problem');
  });
});

describe('entitiesOf', () => {
  it('refuses a missing list and a second entity with one identifier', () => {
    const readEntity: Converter<{ readonly id: string }> = (reading, value, parent, key) => {
      const id = asId<'MarkerId'>(reading, value, parent, key);
      return id === undefined ? undefined : { id };
    };

    const missing = startReading();
    expect(entitiesOf(missing, {}, 'project', 'markers', 10, readEntity)).toBeUndefined();
    expect(expectFailureCode(missing.outcome<unknown>(undefined))).toBe('schema.missing-member');

    const repeated = startReading();
    const id = 'abcdef0123456789';
    const read = entitiesOf(repeated, { markers: [id, id] }, 'project', 'markers', 10, readEntity);
    expect([...(read?.keys() ?? [])]).toEqual([id]);
    const result = repeated.outcome<unknown>(undefined);
    expect(result.ok ? undefined : result.failures[0]).toMatchObject({
      code: 'schema.duplicate-id',
      details: { at: 'project.markers[1]' },
    });
  });

  it('refuses a list longer than its bound', () => {
    const reading = startReading();
    entitiesOf(reading, { markers: [1, 2, 3] }, 'project', 'markers', 2, () => undefined);
    expect(expectFailureCode(reading.outcome<unknown>(undefined))).toBe('schema.too-many-items');
  });
});
