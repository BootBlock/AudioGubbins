import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceWidth } from './use-workspace-width.js';

/** Waits for the tasks queued so far, as the watch waits to ask where focus went. */
async function aTaskLater(): Promise<void> {
  await new Promise((settle) => {
    setTimeout(settle, 0);
  });
}

/**
 * Crossing the width the workspace needs, and what moves when it is crossed.
 *
 * The browser suite drives a real window across the width and reads the notice
 * and the focus. What it cannot show is a crossing while a dialogue is open:
 * the focus scope of a real dialogue puts focus back where it was, so the move
 * this hook must not make is undone before a browser test can see it.
 */

/** The media query list the hook watches, with the change it answers. */
function watchingTheWidth(): { cross: (tooNarrow: boolean) => void } {
  let matches = false;
  let answer: (() => void) | undefined;

  // Defined rather than spied on: this project's setup does not give jsdom a
  // `matchMedia`, and the watcher asks whether one exists before it watches.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) =>
      ({
        get matches() {
          return matches;
        },
        media: query,
        onchange: null,
        addEventListener: (_: string, listener: EventListenerOrEventListenerObject) => {
          answer = () => {
            if (typeof listener === 'function') listener(new Event('change'));
          };
        },
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) satisfies MediaQueryList,
  });

  return {
    cross: (tooNarrow) => {
      matches = tooNarrow;
      answer?.();
    },
  };
}

/** The elements the hook moves focus between, and the places a reader can be instead. */
function page(): {
  heading: HTMLElement;
  workspace: HTMLElement;
  inTheWorkspace: HTMLElement;
  inADialogue: HTMLElement;
  inAMenu: HTMLElement;
  inTheStatusBar: HTMLElement;
} {
  document.body.innerHTML = `
    <h2 class="ag-too-narrow-heading" tabindex="-1">too narrow</h2>
    <main class="ag-workspace" tabindex="-1"><button type="button">A panel control</button></main>
    <div role="dialog"><button type="button">Appearance</button></div>
    <div role="menu"><button type="button" role="menuitem">Save the workspace</button></div>
    <footer class="ag-status-bar"><button type="button">Dismiss notice</button></footer>
  `;

  const found = (selector: string): HTMLElement => {
    const element = document.querySelector<HTMLElement>(selector);
    if (element === null) throw new Error(`${selector} is not in the page.`);
    return element;
  };

  return {
    heading: found('.ag-too-narrow-heading'),
    workspace: found('.ag-workspace'),
    inTheWorkspace: found('.ag-workspace button'),
    inADialogue: found('[role="dialog"] button'),
    inAMenu: found('[role="menu"] button'),
    inTheStatusBar: found('.ag-status-bar button'),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'matchMedia');
  document.body.innerHTML = '';
});

describe('crossing the width the workspace needs', () => {
  it('says so and moves the reader to what has taken the workspace', () => {
    const said: { text: string; urgent: boolean | undefined }[] = [];
    const watch = watchingTheWidth();
    const { heading, workspace } = page();
    workspace.focus();

    renderHook(() => {
      useWorkspaceWidth((text, urgent) => {
        said.push({ text, urgent });
      });
    });

    watch.cross(true);
    expect(said.at(-1)?.text).toContain('too narrow');
    expect(document.activeElement).toBe(heading);

    watch.cross(false);
    expect(said.at(-1)?.text).toContain('The workspace is back.');
    expect(document.activeElement).toBe(workspace);
  });

  it('keeps focus in a dialogue that holds it as the width is crossed both ways, and says each crossing', () => {
    // A modal dialogue holds focus and hides the rest of the document from
    // assistive technology, so focusing the notice behind it would send the
    // reader to what they have been told is not there. Zooming a 1280-pixel
    // window to 200 per cent crosses this width, which is how a reader with low
    // vision reads a dialogue in the first place, and zooming back crosses it
    // again. The table below holds the narrowing for every place that is not
    // the workspace; this holds the whole round trip for the one that is modal.
    const said: string[] = [];
    const watch = watchingTheWidth();
    const { inADialogue } = page();
    inADialogue.focus();

    renderHook(() => {
      useWorkspaceWidth((text) => {
        said.push(text);
      });
    });

    watch.cross(true);
    expect(said.at(-1)).toContain('too narrow');
    expect(document.activeElement).toBe(inADialogue);

    watch.cross(false);
    expect(said.at(-1)).toBe('The workspace is back.');
    expect(document.activeElement).toBe(inADialogue);
  });

  it.each([
    ['a dialogue', (places: ReturnType<typeof page>) => places.inADialogue],
    ['a menu', (places: ReturnType<typeof page>) => places.inAMenu],
    ['the status bar', (places: ReturnType<typeof page>) => places.inTheStatusBar],
  ])('leaves focus where it is while %s holds it, and still says so', (_where, focusOn) => {
    // Focus is moved only from the workspace, which is what the width takes
    // away. A dialogue is not the only other place a reader can be: a menu is
    // not modal and a status-bar button is in neither, and a crossing made
    // while the reader was in one of those pulled them to the notice and
    // closed the menu under them.
    const said: string[] = [];
    const watch = watchingTheWidth();
    const places = page();
    const where = focusOn(places);
    where.focus();

    renderHook(() => {
      useWorkspaceWidth((text) => {
        said.push(text);
      });
    });

    watch.cross(true);

    expect(said.at(-1)).toContain('too narrow');
    expect(document.activeElement).toBe(where);
  });

  it('moves the reader on from inside the workspace, and from the body it fell to', () => {
    // The two shapes the crossing arrives in. A browser drops focus to the
    // body when the media query takes the focused element out of the box
    // tree, so the body is the workspace for this purpose and not a reader
    // who has gone elsewhere.
    for (const from of ['inside', 'the body'] as const) {
      const watch = watchingTheWidth();
      const places = page();

      const { unmount } = renderHook(() => {
        useWorkspaceWidth(() => undefined);
      });

      places.inTheWorkspace.focus();
      // The workspace takes the reader's element with it, and the browser
      // drops focus to the body.
      if (from === 'the body') places.inTheWorkspace.remove();
      expect([from, document.activeElement]).toEqual([
        from,
        from === 'inside' ? places.inTheWorkspace : document.body,
      ]);

      watch.cross(true);
      expect([from, document.activeElement]).toEqual([from, places.heading]);
      unmount();
    }
  });

  it('leaves a reader on the body for a reason of their own where they are, and still says so', async () => {
    // The body stands in for the workspace only where the workspace dropped
    // the reader there. Counted whatever put focus on it, the watch moved a
    // reader who had just opened the page, and one who had clicked on
    // nothing focusable, away from the element they had left while it was
    // still drawn.
    for (const why of ['nothing focused yet', 'a click on nothing focusable'] as const) {
      const said: string[] = [];
      const watch = watchingTheWidth();
      const places = page();

      const { unmount } = renderHook(() => {
        useWorkspaceWidth((text) => {
          said.push(text);
        });
      });

      if (why === 'a click on nothing focusable') {
        places.inTheWorkspace.focus();
        // Still drawn as it loses focus, which jsdom cannot say for itself.
        const rects = [new DOMRect(0, 0, 40, 20)];
        const drawn: DOMRectList = Object.assign(rects, {
          item: (index: number) => rects[index] ?? null,
        });
        vi.spyOn(places.inTheWorkspace, 'getClientRects').mockReturnValue(drawn);
        vi.spyOn(document, 'hasFocus').mockReturnValue(true);
        places.inTheWorkspace.blur();
        await aTaskLater();
      }
      expect([why, document.activeElement]).toEqual([why, document.body]);

      watch.cross(true);
      expect([why, said.at(-1)]).toEqual([why, expect.stringContaining('too narrow')]);
      expect([why, document.activeElement]).toEqual([why, document.body]);
      unmount();
    }
  });

  it('moves a reader on whose page lost focus to the browser before the width was crossed', async () => {
    // The browser's own menu takes focus from the page as a click on nothing
    // takes it from an element, and a reader who zooms from that menu is
    // still in the workspace when the crossing drops them to the body.
    const watch = watchingTheWidth();
    const places = page();
    const { unmount } = renderHook(() => {
      useWorkspaceWidth(() => undefined);
    });

    places.inTheWorkspace.focus();
    const rects = [new DOMRect(0, 0, 40, 20)];
    const drawn: DOMRectList = Object.assign(rects, {
      item: (index: number) => rects[index] ?? null,
    });
    vi.spyOn(places.inTheWorkspace, 'getClientRects').mockReturnValue(drawn);
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    places.inTheWorkspace.blur();
    await aTaskLater();
    expect(document.activeElement).toBe(document.body);

    watch.cross(true);
    expect(document.activeElement).toBe(places.heading);
    unmount();
  });

  it('moves back only what it moved, so a reader who has gone on is left alone', () => {
    // Moved whatever the reader was doing, a reader who had gone on to the
    // status bar or the menu bar was pulled into the workspace by a change of
    // window size.
    const watch = watchingTheWidth();
    page();

    renderHook(() => {
      useWorkspaceWidth(() => undefined);
    });

    watch.cross(true);
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    elsewhere.focus();

    watch.cross(false);

    expect(document.activeElement).toBe(elsewhere);
  });
});
