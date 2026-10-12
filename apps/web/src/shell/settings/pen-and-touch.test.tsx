import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { LOADING_TIME, loadTheApplication } from '../../testing/application-modules.js';
import { everythingQueued } from '../../testing/waiting.js';

/**
 * The pressure choice in Settings, as the application is wired (REQ-UX-068,
 * ADR-0082): its own section, whose controls run the `tools.*` commands and
 * show the choice the person's preferences keep, after a reload too.
 */

beforeAll(loadTheApplication, LOADING_TIME);

let unmount: (() => void) | undefined;

afterEach(() => {
  act(() => {
    unmount?.();
  });
  unmount = undefined;
  document.body.replaceChildren();
  window.localStorage.clear();
});

/** Mounts the application and opens Settings at its Pen and touch section. */
async function openPenAndTouch(): Promise<void> {
  const { mount } = await import('../../app.js');
  const container = document.createElement('div');
  document.body.append(container);
  await act(async () => {
    unmount = mount(container);
    await everythingQueued();
  });
  await act(async () => {
    fireEvent.keyDown(document.body, { code: 'Comma', key: ',', ctrlKey: true });
    await Promise.resolve();
  });
  await userEvent.click(await screen.findByRole('tab', { name: 'Pen and touch' }));
}

// Each test mounts the whole application, which takes seconds under the
// whole suite's load.
describe('the Pen and touch settings', { timeout: 30_000 }, () => {
  it('turns pen pressure off, and keeps the choice across a reload', async () => {
    await openPenAndTouch();
    const pressure = screen.getByRole('switch', { name: 'Let pen pressure set the strength' });
    expect(pressure).toBeChecked();

    await userEvent.click(pressure);
    expect(
      screen.getByRole('switch', { name: 'Let pen pressure set the strength' }),
    ).not.toBeChecked();

    act(() => {
      unmount?.();
    });
    document.body.replaceChildren();
    await openPenAndTouch();
    expect(
      screen.getByRole('switch', { name: 'Let pen pressure set the strength' }),
    ).not.toBeChecked();
  });

  it('shows the fixed strength the person’s preferences keep', async () => {
    await openPenAndTouch();
    expect(screen.getByRole('slider', { name: 'Fixed strength' })).toHaveAttribute(
      'aria-valuetext',
      '75%',
    );
  });
});
