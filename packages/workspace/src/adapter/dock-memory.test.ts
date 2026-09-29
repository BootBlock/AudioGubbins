import { afterEach, describe, expect, it } from 'vitest';

import { KEYBOARD_HOME, createDockMemory, remember } from './dock-memory.js';

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

/** A focusable control named `name`, drawn in `contents`. */
function control(contents: HTMLElement, name: string): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute('role', 'application');
  element.setAttribute('aria-label', name);
  element.tabIndex = 0;
  contents.append(element);
  return element;
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

  it('puts the keyboard back on the control it was on, once the panel draws it again', async () => {
    // The keyboard went to the panel's contents, which take no key of an
    // editor's, so the arrows did nothing until the reader tabbed back.
    const memory = createDockMemory();
    const before = group('editor');
    const surface = control(before.contents, 'Waveform of Tone bursts');
    const forget = remember(engine([before]), memory, 'editor');
    surface.focus();
    forget();
    before.element.remove();

    const after = group('editor');
    remember(engine([after]), memory, 'editor');
    const drawn = control(after.contents, 'Waveform of Tone bursts');
    await frames(2);

    expect(document.activeElement).toBe(drawn);
  });

  it('gives a panel a command made the one in use the keyboard on its keyboard home', async () => {
    // Opening another view of an asset made the new view the one in use and
    // left the keyboard on the page, then on the view's contents.
    const memory = createDockMemory();
    const first = group('editor');
    const forget = remember(engine([first]), memory, 'editor');
    control(first.contents, 'Waveform of Tone bursts').focus();
    forget();
    first.element.remove();

    const again = group('editor');
    const second = group('editor-2');
    remember(engine([again, second]), memory, 'editor-2');
    control(again.contents, 'Waveform of Tone bursts');
    const home = control(second.contents, 'Waveform of Tone bursts');
    home.setAttribute(KEYBOARD_HOME, '');
    await frames(2);

    expect(document.activeElement).toBe(home);
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
