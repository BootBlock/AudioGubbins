import { describe, expect, it } from 'vitest';

import { buildShellContext } from '../testing/shell-context.js';
import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { versionFound } from './stored-value.js';

/**
 * What the stores take from storage, which can hold any text: another
 * version, another tab or a hand edit can put anything there.
 */

describe('versionFound', () => {
  it('records a stored version only where it is a whole number', () => {
    expect(versionFound(3)).toBe(3);
    expect(versionFound('Jane Smith')).toBe(-1);
    expect(versionFound(1.5)).toBe(-1);
    expect(versionFound(undefined)).toBe(-1);
  });

  it('keeps the text of a stored preferences version out of the log', () => {
    // Recorded as it stood, a version written as text reached the log, and the
    // log goes into a diagnostic bundle by default.
    const raw = ephemeralStorage();
    raw.write('audiogubbins.preferences', JSON.stringify({ schemaVersion: 'Jane Smith' }));

    const { logs } = buildShellContext(raw);

    const [record] = logs
      .snapshot()
      .filter((one) => one.message.startsWith('Stored preferences were written for another'));
    expect(record?.fields['found']).toBe(-1);
  });
});
