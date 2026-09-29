import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { PRODUCT_VERSION, SCHEMA_VERSIONS } from '@audiogubbins/version';

import { compatibilityOf, readCompatibleHeader, readFormatHeader } from './compatibility.js';

const CURRENT = SCHEMA_VERSIONS.projectDocument;

describe('compatibilityOf', () => {
  it('reads the version this build writes', () => {
    expect(compatibilityOf(CURRENT, 'projectDocument')).toEqual({ kind: 'current' });
  });

  it('refuses an older version, with no migration before 1.0', () => {
    expect(compatibilityOf(CURRENT - 1, 'projectDocument')).toEqual({
      kind: 'incompatible',
      found: CURRENT - 1,
      current: CURRENT,
      direction: 'older',
    });
  });

  it('refuses a newer version', () => {
    expect(compatibilityOf(CURRENT + 5, 'projectDocument')).toEqual({
      kind: 'incompatible',
      found: CURRENT + 5,
      current: CURRENT,
      direction: 'newer',
    });
  });

  it('judges each schema by its own version', () => {
    expect(compatibilityOf(SCHEMA_VERSIONS.portableBundle, 'portableBundle')).toEqual({
      kind: 'current',
    });
    expect(compatibilityOf(SCHEMA_VERSIONS.projectStorage + 1, 'projectStorage').kind).toBe(
      'incompatible',
    );
  });

  it('is the pre-1.0 rule, which a 1.0 release must replace on purpose', () => {
    // The module refuses to load past 0.x; this says why a version bump fails
    // here rather than in a user's browser.
    expect(PRODUCT_VERSION.startsWith('0.')).toBe(true);
  });
});

describe('readFormatHeader', () => {
  it('reads the format and schema version, leaving other members to the document', () => {
    expect(
      expectSuccess(
        readFormatHeader(
          { format: 'audiogubbins.project', schemaVersion: 3, extra: [] },
          'audiogubbins.project',
        ),
      ),
    ).toEqual({ format: 'audiogubbins.project', schemaVersion: 3 });
  });

  it.each([
    ['a value that is not an object', [], 'schema.not-an-object'],
    ['a missing format', { schemaVersion: 1 }, 'schema.missing-member'],
    ['a missing version', { format: 'audiogubbins.project' }, 'schema.missing-member'],
    [
      'another format',
      { format: 'audiogubbins.bundle', schemaVersion: 1 },
      'format.unexpected-format',
    ],
    [
      'a version that is text',
      { format: 'audiogubbins.project', schemaVersion: '1' },
      'schema.not-a-number',
    ],
    [
      'a fractional version',
      { format: 'audiogubbins.project', schemaVersion: 1.5 },
      'schema.not-an-integer',
    ],
    [
      'a version of zero',
      { format: 'audiogubbins.project', schemaVersion: 0 },
      'schema.number-out-of-range',
    ],
  ])('refuses %s', (_case, value, code) => {
    expect(expectFailureCode(readFormatHeader(value, 'audiogubbins.project'))).toBe(code);
  });
});

describe('readCompatibleHeader', () => {
  it('passes the header of this build’s version', () => {
    const header = { format: 'audiogubbins.project', schemaVersion: CURRENT };
    expect(
      expectSuccess(readCompatibleHeader(header, 'audiogubbins.project', 'projectDocument')),
    ).toEqual(header);
  });

  it('refuses another version as unrecoverable, saying which way it differs', () => {
    const result = readCompatibleHeader(
      { format: 'audiogubbins.project', schemaVersion: CURRENT + 1 },
      'audiogubbins.project',
      'projectDocument',
    );
    expect(expectFailureCode(result)).toBe('format.schema-incompatible');
    expect(result.ok ? undefined : result.failures[0]).toMatchObject({
      kind: 'unrecoverable',
      details: {
        schema: 'projectDocument',
        found: CURRENT + 1,
        current: CURRENT,
        direction: 'newer',
      },
    });
  });
});
