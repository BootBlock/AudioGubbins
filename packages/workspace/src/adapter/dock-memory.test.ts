import { afterEach, describe, expect, it } from 'vitest';

import { createDockMemory, remember } from './dock-memory.js';

/**
 * A group as the engine draws one: its element, with a tab panel whose
 * contents scroll, and the panel it shows.
 */
function group(panel: string, room = 1_000) {
  const element = document.createElement('div');
  const contents = document.createElement('div');
  contents.setAttribute('role', 'tabpanel');
  contents.tabIndex = 0;
  Object.defineProperty(contents, 'scrollHeight', { configurable: true, get: () => room + 100 });
  Object.defineProperty(contents, 'clientHeight', { configurable: true, get: () => 100 });
  Object.defineProperty(contents, 'scrollTo', {
    value: (left: number, top: number) => {
      contents.scrollLeft = left;
      contents.scrollTop = top;
    },
  });
  element.append(contents);
  document.body.append(element);
  return { element, contents, activePanel: { id: panel } };
}

function engine(groups: readonly ReturnType<typeof group>[]) {
  return {
    groups,
    getPanel: (id: string) => {
      const found = groups.find((each) => each.activePanel.id === id);
      return found === undefined ? undefined : { group: found };
    },
  };
}

/** Lets `count` display frames pass. */
async function frames(count: number): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('the dock memory', () => {
  it('keeps how far each panel was scrolled, and gives it back to the panel when mounted again', async () => {
    const memory = createDockMemory();
    const before = group('transport');
    const forget = remember(engine([before]), memory, 'transport');
    before.contents.scrollTop = 240;
    before.contents.dispatchEvent(new Event('scroll'));
    forget();

    const after = group('transport');
    remember(engine([after]), memory, 'transport');
    await frames(2);

    expect(after.contents.scrollTop).toBe(240);
  });

  it('waits for contents to be drawn tall enough before it scrolls them', async () => {
    const memory = createDockMemory();
    memory.scrolls.set('transport', { top: 500, left: 0 });
    let room = 0;
    const after = group('transport');
    Object.defineProperty(after.contents, 'scrollHeight', { get: () => room + 100 });

    remember(engine([after]), memory, 'transport');
    await frames(2);
    expect(after.contents.scrollTop).toBe(0);
    room = 800;
    await frames(2);

    expect(after.contents.scrollTop).toBe(500);
  });

  it('leaves the keyboard where it is on the first mount, which no command caused', () => {
    remember(engine([group('editor')]), createDockMemory(), 'editor');

    expect(document.activeElement).toBe(document.body);
  });

  it('puts a keyboard left on the page back in the panel in use once mounted again', () => {
    const memory = createDockMemory();
    remember(engine([group('editor')]), memory, 'editor');
    const shown = group('editor');

    remember(engine([shown]), memory, 'editor');

    expect(document.activeElement).toBe(shown.contents);
  });

  it('waits for a dialogue that ran the command to give the keyboard back', async () => {
    const memory = createDockMemory();
    remember(engine([group('editor')]), memory, 'editor');
    const shown = group('editor');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const field = document.createElement('input');
    dialog.append(field);
    document.body.append(dialog);
    field.focus();

    remember(engine([shown]), memory, 'editor');
    dialog.remove();
    await frames(2);

    expect(document.activeElement).toBe(shown.contents);
  });

  it('leaves a keyboard in a field outside the dock where it is', () => {
    const memory = createDockMemory();
    remember(engine([group('editor')]), memory, 'editor');
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();

    remember(engine([group('editor')]), memory, 'editor');

    expect(document.activeElement).toBe(field);
  });
});
