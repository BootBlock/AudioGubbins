import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { ShortcutKeys } from './shortcut-keys.js';

/** The presses the caps of `shortcut` are drawn for. */
function pressesOf(shortcut: string): readonly (string | null)[] {
  const { container, unmount } = render(<ShortcutKeys shortcut={shortcut} />);
  const caps = [...container.querySelectorAll('kbd')].map((cap) => cap.textContent);
  unmount();
  return caps;
}

describe('a shortcut as key caps', () => {
  it('takes a chord apart press by press, keeping a key whose label is a comma whole', () => {
    expect(pressesOf('Ctrl+K, Ctrl+I')).toEqual(['Ctrl+K', 'Ctrl+I']);
    expect(pressesOf('Ctrl+,, Ctrl+I')).toEqual(['Ctrl+,', 'Ctrl+I']);
    expect(pressesOf(',, X')).toEqual([',', 'X']);
    expect(pressesOf('⌘⇧P')).toEqual(['⌘⇧P']);
  });

  it('draws a cap for each press, and reads as the shortcut the platform wrote', () => {
    const { container } = render(<ShortcutKeys shortcut="Ctrl+K, Ctrl+P" />);

    expect([...container.querySelectorAll('kbd')].map((cap) => cap.textContent)).toEqual([
      'Ctrl+K',
      'Ctrl+P',
    ]);
    expect(container).toHaveTextContent('Ctrl+K, Ctrl+P');
  });
});
