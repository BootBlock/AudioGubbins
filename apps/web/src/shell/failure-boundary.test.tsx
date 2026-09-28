import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ThemeProvider,
  DEFAULT_THEME_PREFERENCES,
  UNKNOWN_SYSTEM_APPEARANCE,
  fixedSystemAppearance,
} from '@audiogubbins/design-system';
import {
  LogSeverity,
  createDiagnosticCentre,
  createLogStore,
  type LogStore,
} from '@audiogubbins/diagnostics';

import { ApplicationFailure, FailureBoundary, PanelFailure } from './failure-boundary.js';

/**
 * A throw below the composition root.
 *
 * With no boundary to catch it, a panel's crash on its first paint, as the
 * diagnostic log panel's was, would unmount the whole tree and leave an empty
 * page. These hold each boundary to containing a failure where it happens,
 * telling the user, and recording it.
 */

/** Whether the child throws, which a test changes to show a retry succeeding. */
let broken = true;

/** A component that fails while `broken` is set. */
function Fragile(): React.ReactNode {
  if (broken) throw new Error('The waveform could not be drawn.');
  return <p>Drawn.</p>;
}

/** A store at the most verbose level, so what the boundary logged can be read. */
function logsAndLogger(): {
  readonly logs: LogStore;
  readonly logger: ReturnType<ReturnType<typeof createDiagnosticCentre>['loggerFor']>;
} {
  const logs = createLogStore();
  const centre = createDiagnosticCentre(
    logs,
    { now: () => 0 },
    { defaultSeverity: LogSeverity.Trace, categoryOverrides: {} },
  );
  return { logs, logger: centre.loggerFor('shell') };
}

afterEach(() => {
  broken = true;
  vi.restoreAllMocks();
});

/** React reports a caught failure to the console as well; the test reads the log. */
function quietConsole(): void {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
}

describe('a panel that fails', () => {
  function renderPanel(logger: ReturnType<typeof logsAndLogger>['logger']) {
    return render(
      <ThemeProvider
        preferences={DEFAULT_THEME_PREFERENCES}
        system={fixedSystemAppearance(UNKNOWN_SYSTEM_APPEARANCE)}
      >
        <p>The menus still work.</p>
        <FailureBoundary
          part="panel:editor"
          logger={logger}
          notice={({ failure, retry }) => (
            <PanelFailure title="Editor" failure={failure} retry={retry} />
          )}
        >
          <Fragile />
        </FailureBoundary>
      </ThemeProvider>,
    );
  }

  it('is replaced by a notice, and everything around it stays', () => {
    quietConsole();
    const { logger } = logsAndLogger();

    renderPanel(logger);

    expect(
      screen.getByRole('heading', { name: 'The Editor panel stopped working' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Error: The waveform could not be drawn.')).toBeInTheDocument();
    expect(screen.getByText('The menus still work.')).toBeInTheDocument();
  });

  it('is recorded in the log with where it failed and a sanitised stack', () => {
    quietConsole();
    const { logs, logger } = logsAndLogger();

    renderPanel(logger);

    const [record] = logs.snapshot().filter((one) => one.severity === LogSeverity.Error);
    expect(record?.fields).toMatchObject({
      part: 'panel:editor',
      failure: 'Error',
      detail: 'The waveform could not be drawn.',
    });
    expect(record?.stack?.frames.length).toBeGreaterThan(0);
    for (const frame of record?.stack?.frames ?? []) expect(frame).not.toMatch(/[A-Za-z]:[\\/]/);
  });

  it('draws again when the user asks and the failure has passed', async () => {
    quietConsole();
    const { logger } = logsAndLogger();
    renderPanel(logger);

    broken = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try the panel again' }));

    expect(screen.getByText('Drawn.')).toBeInTheDocument();
  });
});

describe('the application failing outside every panel', () => {
  it('says so, says what went wrong, and offers a reload', () => {
    quietConsole();
    const { logger } = logsAndLogger();

    render(
      <FailureBoundary
        part="application"
        logger={logger}
        notice={({ failure }) => <ApplicationFailure failure={failure} />}
      >
        <Fragile />
      </FailureBoundary>,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'AudioGubbins stopped working' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Error: The waveform could not be drawn.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload AudioGubbins' })).toBeInTheDocument();
  });

  it('describes a thrown value that is not an error', () => {
    quietConsole();
    const { logger } = logsAndLogger();

    function ThrowsText(): React.ReactNode {
      // Anything can be thrown, and the notice has to say something useful
      // about it rather than "undefined: undefined".
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the case under test
      throw 'the decoder gave up';
    }

    render(
      <FailureBoundary
        part="application"
        logger={logger}
        notice={({ failure }) => <ApplicationFailure failure={failure} />}
      >
        <ThrowsText />
      </FailureBoundary>,
    );

    expect(screen.getByText('string: the decoder gave up')).toBeInTheDocument();
  });
});
