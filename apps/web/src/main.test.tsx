import { afterEach, describe, expect, it, vi } from 'vitest';

import { mount } from './app.js';

/**
 * The entry point's own two decisions.
 *
 * `frame-ancestors` is the header that would refuse a framed page, and a
 * `meta` element cannot carry it, so a static host sends nothing of the kind.
 * Framed, AudioGubbins can be drawn under a page that steers a click onto
 * Save the report, Delete profile or Reset shortcuts.
 */

vi.mock('./app.js', () => ({ mount: vi.fn() }));

/** Loads the entry point afresh, as a page does, and gives back what it threw. */
async function start(): Promise<unknown> {
  vi.resetModules();
  try {
    await import('./main.js');
    return undefined;
  } catch (error: unknown) {
    return error;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(mount).mockClear();
  document.body.innerHTML = '';
});

describe('starting AudioGubbins', () => {
  it('mounts into the container the shipped document carries', async () => {
    const container = document.createElement('div');
    container.id = 'audiogubbins';
    document.body.append(container);

    expect(await start()).toBeUndefined();

    expect(mount).toHaveBeenCalledWith(container);
  });

  it('refuses to run inside another page, and says so rather than going blank', async () => {
    const container = document.createElement('div');
    container.id = 'audiogubbins';
    document.body.append(container);
    vi.stubGlobal('top', { name: 'another page' });

    const thrown = await start();

    expect(mount).not.toHaveBeenCalled();
    expect(document.body.textContent).toBe(
      'AudioGubbins does not run inside another page. Open it in a window of its own.',
    );
    expect(String(thrown)).toContain('framed by another site');

    // The way out, which the sentence names. A reader inside another site's
    // frame is told to open AudioGubbins in a window of its own, and the
    // address bar shows the framing page's address, so the sentence alone
    // gave them nowhere to go.
    const out = document.querySelector('a');
    expect(out?.href).toBe(window.location.href);
    expect(out?.target).toBe('_top');
    expect(out?.rel).toBe('noreferrer');
  });

  it('fails loudly when the page has no container, rather than inventing one', async () => {
    // Its absence means the page has been altered, and rendering into a
    // container invented here would put AudioGubbins somewhere unpredictable
    // in whatever page it landed in.
    const thrown = await start();

    expect(mount).not.toHaveBeenCalled();
    expect(String(thrown)).toContain('no #audiogubbins element');
  });
});
