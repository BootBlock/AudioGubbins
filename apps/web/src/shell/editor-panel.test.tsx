import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_THEME_PREFERENCES,
  ThemeProvider,
  UNKNOWN_SYSTEM_APPEARANCE,
  fixedSystemAppearance,
} from '@audiogubbins/design-system';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';

import { fakePanelParts } from '../testing/editor-fakes.js';
import { buildShellContext } from '../testing/shell-context.js';
import { EditorPanel } from './editor-panel.js';

const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('editor');

describe('the Editor panel', () => {
  it('says that markers and selections are not kept, and what keeping them waits for', () => {
    // The editor opens the test assets and a picture's sound, none of them an
    // asset of the project, so what is marked on them lasts for the session
    // alone until audio is imported into a project at its own rate (ADR-0021).
    const { context } = buildShellContext();
    const tones = context.assets.find('test:tone-bursts');
    if (tones === undefined) throw new Error('No tone bursts.');
    context.editorViews.open('editor', tones);

    render(
      <ThemeProvider
        preferences={DEFAULT_THEME_PREFERENCES}
        system={fixedSystemAppearance(UNKNOWN_SYSTEM_APPEARANCE)}
      >
        <EditorPanel panel="editor" title="Editor" parts={fakePanelParts(context, logger)} />
      </ThemeProvider>,
    );

    expect(
      screen.getByText(
        'Markers and selections last for this session. Keeping them in a project arrives with importing audio into projects.',
      ),
    ).toBeVisible();
  });
});
