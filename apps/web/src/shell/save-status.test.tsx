import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { FailureKind, failure } from '@audiogubbins/domain';
import type { ProjectSnapshot, SaveStatus as Saving } from '@audiogubbins/storage';

import type { OpenProjectState } from '../state/open-project-store.js';
import { projectWorld } from '../testing/project-context.js';
import { SaveStatus } from './save-status.js';

let made: ProjectSnapshot;

beforeAll(async () => {
  const window = await projectWorld().window();
  await window.runAndHear('file.create-project', { name: 'Harbour' });
  const open = window.projects.project.get();
  if (open.kind !== 'open') throw new Error('No project opened.');
  made = open.snapshot;
});

const FULL = failure(
  'storage.full',
  FailureKind.Retryable,
  'The storage is full; the change is kept in memory and is written once room is made.',
);

/** The project open to change, saved as `save` says. */
function saving(save: Saving): OpenProjectState {
  return { kind: 'open', snapshot: { ...made, save } };
}

describe('whether the open project is saved', () => {
  it('says the project is saved, and is being saved', () => {
    const { rerender } = render(
      <SaveStatus open={saving({ kind: 'saved' })} run={() => true} announce={() => undefined} />,
    );
    expect(screen.getByText('Saved')).toBeVisible();

    rerender(
      <SaveStatus
        open={saving({ kind: 'saving', pending: 2 })}
        run={() => true}
        announce={() => undefined}
      />,
    );
    expect(screen.getByText('Saving…')).toBeVisible();
  });

  it('says why changes are not saved, aloud once, and tries again by command', async () => {
    const run = vi.fn((_id: string, _args?: unknown) => true);
    const announce = vi.fn();
    const { rerender } = render(
      <SaveStatus open={saving({ kind: 'saved' })} run={run} announce={announce} />,
    );

    act(() => {
      rerender(
        <SaveStatus
          open={saving({ kind: 'not-saved', pending: 1, cause: FULL })}
          run={run}
          announce={announce}
        />,
      );
    });
    rerender(
      <SaveStatus
        open={saving({ kind: 'not-saved', pending: 2, cause: FULL })}
        run={run}
        announce={announce}
      />,
    );

    expect(screen.getByText(`Not saved. ${FULL.summary}`)).toBeVisible();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(
      `Your changes are not being saved. ${FULL.summary}`,
      true,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try saving again' }));
    expect(run).toHaveBeenCalledWith('project.retry-save');
  });

  it('says nothing of a project open to read, or of none', () => {
    const { container, rerender } = render(
      <SaveStatus
        open={{
          kind: 'open',
          snapshot: { ...made, access: { kind: 'read-only', reason: { kind: 'requested' } } },
        }}
        run={() => true}
        announce={() => undefined}
      />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(<SaveStatus open={{ kind: 'none' }} run={() => true} announce={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
