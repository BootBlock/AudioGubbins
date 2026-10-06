import { describe, expect, it } from 'vitest';

import { compareVersions, versionWithin } from './pack-version.js';

describe('pack and runtime versions', () => {
  it('orders versions part by part, as numbers', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.9.9', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('0.0.10', '0.0.9')).toBeGreaterThan(0);
  });

  it.each(['1.2', '1.2.3.4', '01.2.3', '1.2.3-beta', 'v1.2.3', '', '1234567.0.0'])(
    'compares nothing with %j, which is not a version',
    (text) => {
      expect(compareVersions(text, '1.0.0')).toBeUndefined();
      expect(versionWithin(text, '0.0.0', '9.0.0')).toBe(false);
    },
  );

  it('holds a version from the minimum up to but not including the bound below', () => {
    expect(versionWithin('1.30.0', '1.30.0', '2.0.0')).toBe(true);
    expect(versionWithin('1.99.99', '1.30.0', '2.0.0')).toBe(true);
    expect(versionWithin('2.0.0', '1.30.0', '2.0.0')).toBe(false);
    expect(versionWithin('1.29.9', '1.30.0', '2.0.0')).toBe(false);
  });
});
