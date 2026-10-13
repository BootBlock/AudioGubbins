import { describe, expect, it } from 'vitest';

import { codecDescriptorIn } from './codec-in-environment.js';
import { codecDescriptor } from './codec-registry.js';
import { WINDOWS_AAC_BIT_RATES, WINDOWS_BROWSER_BIT_RATES } from './testing/browser-bit-rates.js';

describe('a codec’s descriptor as a runtime serves it', () => {
  it("states the bit rates the browser's encoder was probed to take for the codec it writes", () => {
    const aac = codecDescriptorIn({ browserBitRates: WINDOWS_BROWSER_BIT_RATES }, 'aac-lc');
    expect(aac.write?.bitRates).toEqual(WINDOWS_AAC_BIT_RATES);
    expect(aac.read).toBe(codecDescriptor('aac-lc').read);
  });

  it('leaves what the browser does not serve as the registry states it', () => {
    const environment = { browserBitRates: WINDOWS_BROWSER_BIT_RATES };
    expect(codecDescriptorIn(environment, 'mp3')).toEqual(codecDescriptor('mp3'));
    expect(codecDescriptorIn(environment, 'he-aac')).toEqual(codecDescriptor('he-aac'));
  });

  it('states no bit rates for a browser codec the probe found none for', () => {
    expect(codecDescriptorIn({ browserBitRates: new Map() }, 'aac-lc').write?.bitRates).toBe(
      undefined,
    );
  });

  it('makes the descriptors of one probe once', () => {
    const environment = { browserBitRates: WINDOWS_BROWSER_BIT_RATES };
    expect(codecDescriptorIn(environment, 'aac-lc')).toBe(
      codecDescriptorIn({ ...environment }, 'aac-lc'),
    );
  });
});
