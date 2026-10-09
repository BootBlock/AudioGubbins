import { describe, expect, it } from 'vitest';

import { isSameDevice } from './device-identity.js';

const REMEMBERED = { id: 'input-1', group: 'group-1', label: 'Interface In' };

describe('a device remembered (ADR-0070)', () => {
  it('is found again by its identifier, then by its group and label together', () => {
    expect(isSameDevice(REMEMBERED, { id: 'input-1' })).toBe(true);
    expect(
      isSameDevice(REMEMBERED, { id: 'renewed', group: 'group-1', label: 'Interface In' }),
    ).toBe(true);
    expect(isSameDevice(REMEMBERED, { id: 'renewed', label: 'Interface In' })).toBe(false);
    expect(isSameDevice(REMEMBERED, { id: 'renewed', group: 'group-1', label: 'Other' })).toBe(
      false,
    );
  });

  it('is never found by an identifier or a group the browser withheld', () => {
    expect(isSameDevice({ id: '' }, { id: '' })).toBe(false);
    expect(
      isSameDevice({ id: 'a', group: '', label: 'Mic' }, { id: 'b', group: '', label: 'Mic' }),
    ).toBe(false);
    expect(
      isSameDevice({ id: 'a', group: 'g', label: '' }, { id: 'b', group: 'g', label: '' }),
    ).toBe(false);
  });
});
