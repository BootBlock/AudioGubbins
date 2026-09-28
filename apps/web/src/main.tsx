/**
 * The entry point.
 *
 * Deliberately tiny: it refuses a framed page, finds the container and hands
 * over. Everything else that decides anything is in `app.tsx`.
 */

import { mount } from './app.js';

/*
 * Nothing runs inside another site's frame.
 *
 * `frame-ancestors` is the header that would say this, and a `meta` element
 * cannot carry it: a static host sends no header of its own, so the policy in
 * `vite.config.ts` cannot reach this one. Framed, AudioGubbins could be drawn
 * under a page that steers a click onto Save the report, Delete profile or
 * Reset shortcuts, which is what a top-frame check refuses.
 *
 * The document is left with its own message rather than a blank page, and
 * nothing is mounted. The message carries the way out with it: told to open
 * AudioGubbins in a window of its own and given nothing to open, a reader
 * inside a hostile frame would have only the address bar, which is where a
 * framing page has put its own address. `target="_top"` replaces the whole
 * frame set rather than the frame, and `rel="noreferrer"` keeps the framing
 * page's address out of the request that follows.
 *
 * The best answer available, not a guarantee. A top-level navigation from a
 * framed page needs the frame not to be sandboxed against it: a page that
 * frames AudioGubbins with `sandbox="allow-scripts"` and without
 * `allow-top-navigation-by-user-activation` gets the sentence and a link that
 * does nothing. Nothing in a framed page can defeat that, and the sentence is
 * still worth saying.
 */
if (window.top !== window.self) {
  const notice = document.createElement('p');
  notice.textContent = 'AudioGubbins does not run inside another page. ';

  const out = document.createElement('a');
  out.href = window.location.href;
  out.target = '_top';
  out.rel = 'noreferrer';
  out.textContent = 'Open it in a window of its own.';
  notice.append(out);

  document.body.replaceChildren(notice);
  throw new Error('AudioGubbins could not start: the page is framed by another site.');
}

const container = document.getElementById('audiogubbins');

if (container === null) {
  // The container is part of the shipped document, so its absence means the
  // page has been altered rather than that something went wrong at run time.
  // Failing loudly beats rendering into a container invented here, which would
  // put AudioGubbins somewhere unpredictable in whatever page it landed in.
  throw new Error('AudioGubbins could not start: the page has no #audiogubbins element.');
}

mount(container);
