/**
 * Drawing a surface as the shell draws it, inside the notices every dialogue
 * reports through, for the tests of the surfaces that open one.
 */

import { render } from '@testing-library/react';
import type { ReactNode } from 'react';

import { NoticeProvider } from '@audiogubbins/design-system';

/** Renders inside the notices, as the application renders every dialogue. */
export function renderInTheShell(ui: ReactNode): ReturnType<typeof render> {
  return render(<NoticeProvider notice={undefined}>{ui}</NoticeProvider>);
}
