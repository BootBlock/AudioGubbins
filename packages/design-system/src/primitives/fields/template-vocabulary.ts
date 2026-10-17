/**
 * What a template field is given to read and explain its tokens: the tokens
 * it may name and the words for everything it says about them. The design
 * system knows the syntax; every word the reader sees is the caller's.
 */

import type { ReactNode } from 'react';

import type { TemplateProblem, TemplateToken } from './template-syntax.js';

/** What a rich tooltip says about a part of a template. */
export interface TemplateExplanation {
  readonly title: string;
  readonly body: ReactNode;

  /** Shown below a quiet hairline, such as how to write a brace itself. */
  readonly example?: ReactNode;
}

/** The tokens a template field highlights and lists, and its words. */
export interface TemplateVocabulary {
  /** The tokens, in the order the token list shows them. */
  readonly tokens: readonly TemplateToken[];

  /**
   * The braces button's accessible name and hint, and the token list's name,
   * such as "Insert a token".
   */
  readonly insertLabel: string;

  /** The token list's footer: how to write a brace itself. */
  readonly braceHelp: ReactNode;

  /** Why a part is shown in the danger colour, and how to put it right. */
  readonly explain: (problem: TemplateProblem) => TemplateExplanation;
}
