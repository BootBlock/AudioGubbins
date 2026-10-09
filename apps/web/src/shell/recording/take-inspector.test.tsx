import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { unsafeBrandId, type TakeStack } from '@audiogubbins/domain';

import { CaptureWriter } from '../../testing/capture-writer.js';
import { reasonsIn } from '../../testing/command-availability.js';
import { projectWorld, type ProjectWindow } from '../../testing/project-context.js';
import { inputOpened } from '../../testing/recording-fakes.js';
import { buildShellContext } from '../../testing/shell-context.js';
import type { PanelCommands } from '../command-button.js';
import { TakeInspector } from './take-inspector.js';

/** The rate the fake input records at. */
const RATE = 48_000;

const windows: ProjectWindow[] = [];
afterEach(() => {
  for (const window of windows.splice(0)) window.takeDown();
});

/** How the Inspector runs the window's commands. */
function commandsOf(window: ProjectWindow): PanelCommands {
  return {
    run: (id, args) => {
      window.run(id, args);
    },
    unavailableReason: reasonsIn(window.context),
  };
}

/** The project's only take stack, as `window` holds it now. */
function stackOf(window: ProjectWindow): TakeStack {
  const open = window.projects.project.get();
  const [stack] = open.kind === 'open' ? open.snapshot.model.state.project.takeStacks.values() : [];
  if (stack === undefined) throw new Error('No take stack was made.');
  return stack;
}

/** A window with a project holding one take, recorded through the input. */
async function withATake(): Promise<ProjectWindow> {
  const window = await projectWorld().window();
  windows.push(window);
  await window.runAndHear('file.create-project', { name: 'Harbour' });
  expect(window.run('recording.arm').kind).toBe('applied');
  const capture = await inputOpened(window.recording);
  expect(window.run('recording.record').kind).toBe('applied');
  const take = new CaptureWriter(capture, 0);
  take.begin();
  take.post(RATE / 2, () => 0.25);
  await vi.waitFor(() => {
    expect(window.context.recording.takes.progress.get().kind).toBe('recording');
  });
  window.run('recording.stop');
  take.end();
  await vi.waitFor(() => {
    expect(window.said.some((said) => said.includes('is recorded'))).toBe(true);
  });
  return window;
}

describe("the Inspector's take", () => {
  it('shows the take, whether it is chosen, and its recording', async () => {
    const window = await withATake();
    const stack = stackOf(window);
    const take = stack.takes[0];
    if (take === undefined) throw new Error('No take was recorded.');
    render(
      <TakeInspector
        subject={{ stack: stack.id, take: take.id }}
        projects={window.projects}
        commands={commandsOf(window)}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Take in Recording 1' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Take 1');
    expect(screen.getByText('It is the chosen take.')).toBeInTheDocument();
    expect(screen.getByText(/^Its recording is the asset /u)).toBeInTheDocument();
    expect(
      screen.getByText('The placement moves where the take is read from, never its samples.'),
    ).toBeInTheDocument();
  });

  it('renames the take by its command, and shows the name the project holds', async () => {
    const window = await withATake();
    const stack = stackOf(window);
    const take = stack.takes[0];
    if (take === undefined) throw new Error('No take was recorded.');
    render(
      <TakeInspector
        subject={{ stack: stack.id, take: take.id }}
        projects={window.projects}
        commands={commandsOf(window)}
      />,
    );
    const name = screen.getByRole('textbox', { name: 'Name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Chorus');
    await userEvent.click(screen.getByRole('button', { name: 'Rename the take' }));
    await vi.waitFor(() => {
      expect(stackOf(window).takes[0]?.name).toBe('Chorus');
    });
    expect(await screen.findByRole('heading', { name: 'Take in Recording 1' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Chorus');
  });

  it('shows a stack, its takes and the one chosen, when no take is named', async () => {
    const window = await withATake();
    const stack = stackOf(window);
    render(
      <TakeInspector
        subject={{ stack: stack.id }}
        projects={window.projects}
        commands={commandsOf(window)}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Take stack' })).toBeInTheDocument();
    expect(screen.getByText('1 take; Take 1 is chosen.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename the stack' })).toBeInTheDocument();
  });

  it('says a take or a stack is gone rather than showing nothing', async () => {
    const window = await withATake();
    const stack = stackOf(window);
    const { rerender } = render(
      <TakeInspector
        subject={{ stack: stack.id, take: unsafeBrandId<'TakeId'>('take-gone') }}
        projects={window.projects}
        commands={commandsOf(window)}
      />,
    );
    expect(screen.getByText('That take is no longer in its stack.')).toBeInTheDocument();
    rerender(
      <TakeInspector
        subject={{ stack: unsafeBrandId<'TakeStackId'>('stack-gone') }}
        projects={window.projects}
        commands={commandsOf(window)}
      />,
    );
    expect(screen.getByText('That take stack is no longer in the project.')).toBeInTheDocument();
  });

  it('says no project is open where none is', () => {
    const { context } = buildShellContext();
    render(
      <TakeInspector
        subject={{ stack: unsafeBrandId<'TakeStackId'>('stack') }}
        projects={undefined}
        commands={{ run: () => undefined, unavailableReason: reasonsIn(context) }}
      />,
    );
    expect(screen.getByText('No project is open.')).toBeInTheDocument();
  });
});
