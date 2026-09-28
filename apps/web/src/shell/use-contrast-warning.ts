/**
 * Logs a palette that cannot reach its contrast target.
 *
 * Where a diagnostic report can carry it. The solver records the shortfall, and
 * with nothing to read it, the guarantee would hold only in a unit test.
 */

import { useEffect, useRef } from 'react';

import type { Theme } from '@audiogubbins/design-system';
import type { Logger } from '@audiogubbins/diagnostics';

/**
 * Warns once for each distinct set of tokens that fall short, not on every
 * new theme.
 *
 * Every step of the brightness slider makes a theme, and warned on every one, a
 * drag would write the same warning many times a second into the log the user
 * reads, pushing out the records worth reading. Compared with the last set
 * alone, a drag between two settings that each fall short would still write it
 * at every step.
 */
export function useContrastWarning(theme: Theme, logger: Logger): void {
  const warnedAbout = useRef(new Set<string>());

  useEffect(() => {
    const shortfalls = theme.palette.contrastShortfalls;
    // The tokens that fell short, named as colours: a field called `tokens`
    // holds a credential by every redaction list there is, so under that name
    // the one record saying which colours fell short would say `<redacted>`,
    // and every report of a session with no secret in it would say a credential
    // had been removed.
    const colours = shortfalls.map((one) => one.token).join(', ');
    if (colours === '' || warnedAbout.current.has(colours)) return;
    warnedAbout.current.add(colours);

    logger.warning('Some colours could not reach the contrast they are meant to.', {
      colours,
      worstRatio: Math.min(...shortfalls.map((one) => one.ratio)),
      required: Math.max(...shortfalls.map((one) => one.required)),
    });
  }, [theme, logger]);
}
