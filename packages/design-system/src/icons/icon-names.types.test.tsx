/**
 * A type test: the package's typecheck, not only this test's run, is what it
 * proves. An icon name with no glyph has to be refused by the compiler (Phase
 * 16, "an icon name with no glyph is a type error, not a blank square at
 * runtime"), so the directive below expects that error, and the typecheck fails
 * the day the name becomes valid, or the day `IconName` widens to `string`.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import { render } from '@testing-library/react';

import { AUDIO_ICONS } from './audio-icons.js';
import { Icon } from './icon.js';
import { PANEL_ICONS } from './panel-icons.js';
import { PROJECT_ICONS } from './project-icons.js';
import { SHELL_ICONS } from './shell-icons.js';
import { ICON_GLYPHS } from './vocabulary.js';

describe('an icon name with no glyph', () => {
  it('is refused by the compiler, and draws no blank square if it is forced through', () => {
    // @ts-expect-error -- a type test: "no-such-glyph" is not in the vocabulary.
    const element = <Icon name="no-such-glyph" />;

    expect(Object.hasOwn(ICON_GLYPHS, 'no-such-glyph')).toBe(false);
    expect(() => render(element)).toThrow();
  });
});

/**
 * The names two parts share. A name in two parts would let one glyph silently
 * replace the other when the parts are joined, where one map refused it as a
 * duplicate key; this keeps that refusal: `NoNameShared` fails to compile
 * unless the parts share no name.
 */
type Shared<A, B> = keyof A & keyof B;
type Nothing<T extends never> = T;
type NoNameShared = [
  Nothing<Shared<typeof SHELL_ICONS, typeof AUDIO_ICONS>>,
  Nothing<Shared<typeof SHELL_ICONS, typeof PANEL_ICONS>>,
  Nothing<Shared<typeof SHELL_ICONS, typeof PROJECT_ICONS>>,
  Nothing<Shared<typeof AUDIO_ICONS, typeof PANEL_ICONS>>,
  Nothing<Shared<typeof AUDIO_ICONS, typeof PROJECT_ICONS>>,
  Nothing<Shared<typeof PANEL_ICONS, typeof PROJECT_ICONS>>,
];

describe('an icon name in two parts of the vocabulary', () => {
  it('is refused by the compiler, so no glyph silently replaces another in the join', () => {
    expectTypeOf<NoNameShared>().toEqualTypeOf<[never, never, never, never, never, never]>();

    const names = [SHELL_ICONS, AUDIO_ICONS, PANEL_ICONS, PROJECT_ICONS].flatMap(Object.keys);
    expect(Object.keys(ICON_GLYPHS)).toHaveLength(names.length);
  });
});
