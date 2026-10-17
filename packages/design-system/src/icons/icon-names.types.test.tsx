/**
 * A type test: the package's typecheck, not only this test's run, is what it
 * proves. An icon name with no glyph has to be refused by the compiler (Phase
 * 16, "an icon name with no glyph is a type error, not a blank square at
 * runtime"), so the directive below expects that error, and the typecheck fails
 * the day the name becomes valid, or the day `IconName` widens to `string`.
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { Icon } from './icon.js';
import { ICON_GLYPHS } from './vocabulary.js';

describe('an icon name with no glyph', () => {
  it('is refused by the compiler, and draws no blank square if it is forced through', () => {
    // @ts-expect-error -- a type test: "no-such-glyph" is not in the vocabulary.
    const element = <Icon name="no-such-glyph" />;

    expect(Object.hasOwn(ICON_GLYPHS, 'no-such-glyph')).toBe(false);
    expect(() => render(element)).toThrow();
  });
});
