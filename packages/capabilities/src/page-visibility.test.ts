import { describe, expect, it } from 'vitest';

import {
  readPageVisibility,
  watchPageVisibility,
  type VisibilityDocument,
} from './page-visibility.js';

/** A document whose visibility a test changes, as sending the tab to the background does. */
class FakeDocument extends EventTarget implements VisibilityDocument {
  visibilityState: string | undefined;

  constructor(visibilityState: string | undefined) {
    super();
    this.visibilityState = visibilityState;
  }

  become(state: string): void {
    this.visibilityState = state;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

describe('page visibility', () => {
  it('reads whether the page is visible', () => {
    expect(readPageVisibility(new FakeDocument('visible'))).toBe('visible');
    expect(readPageVisibility(new FakeDocument('hidden'))).toBe('hidden');
  });

  it('is not known where the document does not say, or says something else', () => {
    expect(readPageVisibility(new FakeDocument(undefined))).toBeUndefined();
    expect(readPageVisibility(new FakeDocument('prerender'))).toBeUndefined();
  });

  it('is not known where reading it is refused', () => {
    const refusing = new FakeDocument('visible');
    Object.defineProperty(refusing, 'visibilityState', {
      get: () => {
        throw new DOMException('Refused.', 'SecurityError');
      },
    });
    expect(readPageVisibility(refusing)).toBeUndefined();
  });

  it('reports each change, until the watch stops', () => {
    const page = new FakeDocument('visible');
    const heard: string[] = [];
    const stop = watchPageVisibility(page, (visibility) => heard.push(visibility));
    page.become('hidden');
    page.become('visible');
    stop();
    page.become('hidden');
    expect(heard).toEqual(['hidden', 'visible']);
  });

  it('reports no change to a state it cannot name', () => {
    const page = new FakeDocument('visible');
    const heard: string[] = [];
    watchPageVisibility(page, (visibility) => heard.push(visibility));
    page.become('prerender');
    expect(heard).toEqual([]);
  });
});
