import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import {
  LiveRegion,
  NOTICE_DURATION,
  NoticeProvider,
  NoticeSurface,
  type LiveAnnouncement,
} from './announcement.js';
import { ModalDialog } from './overlays.js';

/**
 * The two channels an announcement travels on (REQ-UX-005, REQ-EDIT-073).
 *
 * Each defect these cover is one measured in a real browser. Put in one region,
 * three repeated refusals would make no DOM mutation in it at all, because
 * React sees the same string and leaves the text node alone; with nothing in
 * the status bar, a sighted user who ran an unavailable command would get no
 * signal whatever; and `aria-live` mutated between polite and assertive on one
 * element is unreliable across screen readers, because politeness is read when
 * a region is created rather than when its text changes.
 */

/** Every live region, in the order they are rendered. */
function regions(): readonly HTMLElement[] {
  return [...screen.getAllByRole('status'), ...screen.getAllByRole('alert')];
}

/** What each region currently says. */
function said(): readonly string[] {
  return regions().map((region) => region.textContent);
}

/** Builds an announcement. */
function announcement(text: string, sequence: number, urgent = false): LiveAnnouncement {
  return { text, sequence, urgent };
}

/** The surface over the page, handed `notice` as the application hands it one. */
function surface(notice?: LiveAnnouncement): ReactNode {
  return (
    <NoticeProvider notice={notice}>
      <NoticeSurface />
    </NoticeProvider>
  );
}

describe('the live region', () => {
  it('keeps a region for each politeness, so no attribute is ever mutated', () => {
    render(<LiveRegion />);

    for (const region of screen.getAllByRole('status')) {
      expect(region).toHaveAttribute('aria-live', 'polite');
      expect(region).toHaveAttribute('aria-atomic', 'true');
    }
    for (const region of screen.getAllByRole('alert')) {
      expect(region).toHaveAttribute('aria-live', 'assertive');
    }
  });

  it('says nothing when there is nothing to say', () => {
    render(<LiveRegion />);

    expect(said().join('')).toBe('');
  });

  it('puts an ordinary announcement in a polite region', () => {
    render(<LiveRegion announcement={announcement('The panel is closed.', 1)} />);

    expect(screen.getAllByRole('status').map((one) => one.textContent)).toContain(
      'The panel is closed.',
    );
    expect(
      screen
        .getAllByRole('alert')
        .map((one) => one.textContent)
        .join(''),
    ).toBe('');
  });

  it('puts an urgent announcement in an assertive region', () => {
    render(<LiveRegion announcement={announcement('That cannot be done.', 1, true)} />);

    expect(screen.getAllByRole('alert').map((one) => one.textContent)).toContain(
      'That cannot be done.',
    );
    expect(
      screen
        .getAllByRole('status')
        .map((one) => one.textContent)
        .join(''),
    ).toBe('');
  });

  it('moves the same sentence to the other region when it is said again', () => {
    // The defect: saying the same thing twice put the same string into the same
    // region, React left the text node alone, and the second refusal was
    // silent. A live region fires on a text change and on nothing else.
    const text = 'The interface is already at its brightest.';
    const view = render(<LiveRegion announcement={announcement(text, 1, true)} />);

    const first = screen.getAllByRole('alert').findIndex((one) => one.textContent === text);
    expect(first).toBeGreaterThanOrEqual(0);

    view.rerender(<LiveRegion announcement={announcement(text, 2, true)} />);

    const second = screen.getAllByRole('alert').findIndex((one) => one.textContent === text);
    expect(second).toBeGreaterThanOrEqual(0);
    expect(second).not.toBe(first);
  });

  it('empties the region it just left, so one sentence is never in two places', () => {
    const text = 'The interface is already at its brightest.';
    const view = render(<LiveRegion announcement={announcement(text, 1, true)} />);
    view.rerender(<LiveRegion announcement={announcement(text, 2, true)} />);

    expect(screen.getAllByRole('alert').filter((one) => one.textContent === text)).toHaveLength(1);
  });

  it('empties the polite regions when an urgent announcement follows a polite one', () => {
    const view = render(<LiveRegion announcement={announcement('Saved.', 1)} />);
    view.rerender(<LiveRegion announcement={announcement('That cannot be done.', 2, true)} />);

    expect(
      screen
        .getAllByRole('status')
        .map((one) => one.textContent)
        .join(''),
    ).toBe('');
  });
});

describe('the visible notice', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows nothing when there is nothing to show', () => {
    render(surface());

    expect(document.querySelector('.ag-notice')).toBeNull();
  });

  it('shows the same sentence the live region is saying', () => {
    render(surface(announcement('The panel is closed.', 1)));

    expect(document.querySelector('.ag-notice')).toHaveTextContent('The panel is closed.');
  });

  it('shows nothing for an announcement that is said and not shown', () => {
    // A chord waiting for its next key is in the status bar already, and shown
    // again as a notice it stayed over the palette the chord had just opened.
    render(surface({ ...announcement('Ctrl+K pressed.', 1), shown: false }));

    expect(document.querySelector('.ag-notice')).toBeNull();
    expect(said()).toContain('Ctrl+K pressed.');
  });

  it('is said by the live region the provider holds, from the one notice it is handed', () => {
    // The two halves were handed the announcement separately, so one could be
    // given a notice the other never was.
    render(surface(announcement('The panel is closed.', 1)));

    expect(said()).toContain('The panel is closed.');
    expect(document.querySelector('.ag-notice')).toHaveTextContent('The panel is closed.');
  });

  it('fails outside a provider, rather than showing nothing', () => {
    // A channel that defaulted to nothing made a surface rendered outside the
    // provider silent, and nothing said so.
    //
    // React reports each throw on the console as well. Silenced for this test
    // alone: left in place, it would hide every later test's errors.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    onTestFinished(() => {
      quiet.mockRestore();
    });

    expect(() => render(<NoticeSurface />)).toThrow(/outside a NoticeProvider/);
    expect(() =>
      render(
        <ModalDialog open onOpenChange={() => undefined} title="Export" description="Choose.">
          <p>What it holds.</p>
        </ModalDialog>,
      ),
    ).toThrow(/outside a NoticeProvider/);
  });

  it('is hidden from assistive technology, so the sentence is not announced twice', () => {
    render(surface(announcement('The panel is closed.', 1)));

    expect(document.querySelector('.ag-notice')).toHaveAttribute('aria-hidden', 'true');
  });

  it('marks an urgent notice, so a refusal does not look like a confirmation', () => {
    render(surface(announcement('That cannot be done.', 1, true)));

    expect(document.querySelector('.ag-notice')).toHaveAttribute('data-ag-notice', 'urgent');
  });

  it('keeps an urgent notice longer, because a refusal takes longer to act on', () => {
    render(surface(announcement('That cannot be done.', 1, true)));

    act(() => {
      vi.advanceTimersByTime(NOTICE_DURATION.ordinary);
    });
    expect(document.querySelector('.ag-notice')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(NOTICE_DURATION.urgent - NOTICE_DURATION.ordinary);
    });
    expect(document.querySelector('.ag-notice')).toBeNull();
  });

  it('keeps a long notice on screen long enough to be read', () => {
    // The fixed times are right for a sentence and wrong for a paragraph. The
    // notice about storage that could not be read ran to about a hundred and
    // forty words, which at an unhurried pace is over forty seconds of
    // reading, and it was shown for eight.
    const long = Array.from({ length: 60 }, () => 'word').join(' ');
    render(surface(announcement(long, 1, true)));

    act(() => {
      vi.advanceTimersByTime(NOTICE_DURATION.urgent);
    });
    expect(document.querySelector('.ag-notice')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(60 * 1_000);
    });
    expect(document.querySelector('.ag-notice')).toBeNull();
  });

  it('takes a notice away in the end, however much it says', () => {
    // Length as a floor was right and length as the whole answer was not: the
    // rule had no ceiling, so a notice quoting stored text stayed as long as
    // its word count said, over a surface the reader may be using. What is
    // longer than a reader will take on the way past belongs in the status
    // bar.
    const enormous = Array.from({ length: 5_000 }, () => 'word').join(' ');
    render(surface(announcement(enormous, 1, true)));

    act(() => {
      vi.advanceTimersByTime(60 * 1_000);
    });
    expect(document.querySelector('.ag-notice')).toBeNull();
  });

  it('keeps a short notice for the fixed time, so length is a floor and not a rule', () => {
    render(surface(announcement('Saved.', 1)));

    act(() => {
      vi.advanceTimersByTime(NOTICE_DURATION.ordinary - 1);
    });
    expect(document.querySelector('.ag-notice')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(document.querySelector('.ag-notice')).toBeNull();
  });

  it('keeps a refusal as long, however politely it is spoken', () => {
    render(surface({ ...announcement('It is already so.', 1), refusal: true }));

    act(() => {
      vi.advanceTimersByTime(NOTICE_DURATION.ordinary);
    });
    expect(document.querySelector('.ag-notice')).not.toBeNull();
    // Drawn as what it is, a polite answer, and not as an error.
    expect(document.querySelector('.ag-notice')).toHaveAttribute('data-ag-notice', 'ordinary');

    act(() => {
      vi.advanceTimersByTime(NOTICE_DURATION.urgent - NOTICE_DURATION.ordinary);
    });
    expect(document.querySelector('.ag-notice')).toBeNull();
  });

  it('shows a repeat again, and starts its time over', () => {
    const text = 'The interface is already at its brightest.';
    const view = render(surface(announcement(text, 1, true)));

    act(() => {
      vi.advanceTimersByTime(NOTICE_DURATION.urgent - 1_000);
    });
    view.rerender(surface(announcement(text, 2, true)));

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    // Still there: the second announcement restarted the clock rather than
    // inheriting what was left of the first one's.
    expect(document.querySelector('.ag-notice')).toHaveTextContent(text);
  });
});

/**
 * A notice raised while a dialogue is open (WCAG 2.4.11): shown in the
 * dialogue's own flow, above its actions, where it covers nothing and is cut
 * by nothing.
 *
 * Nothing is laid out here. The browser suite measures the same rule against a
 * real dialogue.
 */
describe('a notice raised while a dialogue is open', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** The page, with a dialogue open or not, and the latest notice. */
  function page(open: boolean, notice?: LiveAnnouncement): ReactNode {
    return (
      <NoticeProvider notice={notice}>
        <ModalDialog
          open={open}
          onOpenChange={() => undefined}
          title="Export a report"
          description="Choose what the report holds."
          actions={<button type="button">Save</button>}
        >
          <p>What the report holds.</p>
        </ModalDialog>
        <NoticeSurface />
      </NoticeProvider>
    );
  }

  /** The notice in the dialogue, or `null`. */
  function inTheDialogue(): HTMLElement | null {
    return document.querySelector<HTMLElement>('.ag-dialog .ag-dialog-notice');
  }

  /** The notice over the page, or `null`. */
  function overThePage(): HTMLElement | null {
    return document.querySelector<HTMLElement>('.ag-notice');
  }

  it('is shown in the dialogue, above its actions, and not over the page', () => {
    const view = render(page(true));
    view.rerender(page(true, announcement('That cannot be done.', 1, true)));

    expect(inTheDialogue()).toHaveTextContent('That cannot be done.');
    expect(inTheDialogue()?.nextElementSibling).toHaveClass('ag-dialog-actions');
    expect(inTheDialogue()).toHaveAttribute('data-ag-notice', 'urgent');
    expect(overThePage()).toBeNull();
  });

  it('is plain text a screen reader can find again, and not a second voice', () => {
    // Not hidden, so a screen-reader user whose announcement was cut off finds
    // it again beside the control they pressed: the live region lies outside
    // the dialogue, and is reached only by browsing out of it. The live region
    // says it once, and a paragraph is not said as it appears.
    const view = render(page(true));
    view.rerender(page(true, announcement('That cannot be done.', 1, true)));

    const line = inTheDialogue();
    expect(line).not.toBeNull();
    for (let element = line; element !== null; element = element.parentElement) {
      expect(element).not.toHaveAttribute('aria-hidden');
      expect(element).not.toHaveAttribute('aria-live');
      expect(element.getAttribute('role') ?? '').not.toMatch(/^(status|alert|log)$/);
    }
    expect(screen.getByRole('dialog')).toHaveTextContent('That cannot be done.');
  });

  it('stays until the next notice, and a notice that is not shown takes it away', () => {
    // It covers nothing, so nothing is gained by timing it out, and a long
    // refusal timed out was taken from a reader part of the way through it.
    vi.useFakeTimers();
    const view = render(page(true));
    view.rerender(page(true, announcement('That cannot be done.', 1, true)));

    act(() => {
      vi.advanceTimersByTime(10 * 60 * 1_000);
    });
    expect(inTheDialogue()).toHaveTextContent('That cannot be done.');

    view.rerender(page(true, { ...announcement('Ctrl+K pressed.', 2), shown: false }));
    expect(inTheDialogue()).toBeNull();
  });

  it('goes with its dialogue, and is not shown again when the dialogue opens again', () => {
    const refusal = announcement('That name is taken.', 1, true);
    const view = render(page(true));
    view.rerender(page(true, refusal));

    view.rerender(page(false, refusal));
    expect(overThePage()).toBeNull();

    view.rerender(page(true, refusal));
    expect(inTheDialogue()).toBeNull();
  });

  it('shows over the page a notice raised as its dialogue closes', () => {
    // A command that closes its dialogue and then reports, as saving the
    // diagnostic report does, is reporting to the page it returned to.
    const view = render(page(true));
    view.rerender(page(false, announcement('The report was saved.', 1)));

    expect(overThePage()).toHaveTextContent('The report was saved.');
  });

  it('takes a notice over the page away when a dialogue opens over it', () => {
    const notice = announcement('The panel is closed.', 1);
    const view = render(page(false, notice));
    expect(overThePage()).not.toBeNull();

    view.rerender(page(true, notice));
    expect(overThePage()).toBeNull();
    expect(inTheDialogue()).toBeNull();
  });

  it('brings itself into view as it arrives, and then the control the reader is on', () => {
    // The control wins where the dialogue's visible part cannot hold both:
    // the notice is in the flow, so the reader can scroll to it.
    const view = render(page(true));
    screen.getByRole('button', { name: 'Save' }).focus();
    const brought = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(() => undefined);

    view.rerender(page(true, announcement('That cannot be done.', 1, true)));

    expect((brought.mock.contexts as Element[]).map((element) => element.tagName)).toEqual([
      'P',
      'BUTTON',
    ]);
  });

  it('brings only itself into view while the dialogue itself holds focus', () => {
    // A click on the dialogue's text focuses the dialogue, and a dialogue is
    // no control to keep in view.
    const view = render(page(true));
    screen.getByRole('dialog').focus();
    const brought = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(() => undefined);

    view.rerender(page(true, announcement('That cannot be done.', 1, true)));

    expect((brought.mock.contexts as Element[]).map((element) => element.tagName)).toEqual(['P']);
  });
});
