/**
 * A check's verdict: a glyph, or a spinner while it runs, and the words
 * (design language, section 10, "Tables").
 *
 * The words carry the verdict as well as the colour, so it reads the same in
 * forced colours and to a screen reader. They wrap, with the glyph held at the
 * first line.
 */

import type { ReactNode } from 'react';

import { Icon, IconSize } from '../../icons/icon.js';
import type { IconName } from '../../icons/vocabulary.js';
import { Spinner } from './spinner.js';

/** What a check found. */
export const VerdictKind = {
  Passes: 'passes',
  Warns: 'warns',
  Fails: 'fails',

  /** Still being checked: a spinner in the accent. */
  Running: 'running',

  /** Not checked: quiet. */
  None: 'none',

  /**
   * Checked before what it judges last changed, so it may no longer hold,
   * such as a loudness measured before an edit: its glyph asks for it to be
   * checked again, in the warning colour, and its words stay quiet, since
   * they report a reading that is out of date rather than a verdict.
   */
  Stale: 'stale',
} as const;

/** What a check found. */
export type VerdictKind = (typeof VerdictKind)[keyof typeof VerdictKind];

/** The glyph each settled verdict takes. */
const VERDICT_GLYPH: Readonly<Record<Exclude<VerdictKind, 'running'>, IconName>> = {
  passes: 'check-passes',
  warns: 'check-warns',
  fails: 'check-fails',
  none: 'not-measured',
  stale: 'analyse-again',
};

/** What a verdict takes. */
export interface VerdictProps {
  readonly kind: VerdictKind;

  /** What was found, in words. */
  readonly children: ReactNode;
}

/** A check's verdict. */
export function Verdict({ kind, children }: VerdictProps): ReactNode {
  return (
    <span className="ag-verdict" data-ag-verdict={kind}>
      {kind === VerdictKind.Running ? (
        <Spinner size={IconSize.Inline} />
      ) : (
        <Icon name={VERDICT_GLYPH[kind]} size={IconSize.Inline} />
      )}
      <span className="ag-verdict-text">{children}</span>
    </span>
  );
}
