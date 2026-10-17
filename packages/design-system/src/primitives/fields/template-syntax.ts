/**
 * How a template field reads its text: literal text, `{token}` and
 * `{token:modifier}`, `{{` and `}}` for a brace itself, and a brace standing
 * alone, each with where it starts, so each can be highlighted in place.
 *
 * This is the lexical form every AudioGubbins name template is written in
 * (ADR-0092, ADR-0102). What a template may name is the caller's: it gives
 * the field a vocabulary, and a token the vocabulary does not know, or a
 * modifier its token does not take, is read as a problem to show, never
 * refused, because the reader is still typing.
 */

import type { ReactNode } from 'react';

/** One token a template may name, as its caller describes it. */
export interface TemplateToken {
  /** What is written between the braces, such as `number`. */
  readonly name: string;

  /** What it stands for, in a few words: the token list's second column. */
  readonly summary: string;

  /** The full description, as rich content: paragraphs, `<code>`, a short list. */
  readonly description: ReactNode;

  /** Examples of it in use, each shown below the description. */
  readonly examples?: readonly ReactNode[];

  /** The modifiers it takes after its colon; a token without them takes none. */
  readonly modifiers?: ReadonlySet<string>;
}

/** Why a part of a template is shown in the danger colour. */
export type TemplateProblem =
  | {
      /** A token the vocabulary does not name. */
      readonly kind: 'unknown-token';
      readonly name: string;
      readonly modifier: string | undefined;
    }
  | {
      /** A known token given a modifier it does not take. */
      readonly kind: 'unaccepted-modifier';
      readonly token: TemplateToken;
      readonly modifier: string;
    }
  | {
      /** A brace standing alone, which neither opens a token nor is doubled. */
      readonly kind: 'lone-brace';
      readonly brace: '{' | '}';
    };

/** One part of a template, in order, with where it starts in the text. */
export type TemplateSegment =
  | { readonly kind: 'text'; readonly start: number; readonly text: string }
  | {
      /** A doubled brace: one brace in what the template makes. */
      readonly kind: 'escape';
      readonly start: number;
      readonly text: '{{' | '}}';
    }
  | {
      readonly kind: 'token';
      readonly start: number;
      readonly text: string;

      /** Where the modifier, with its colon, starts within `text`; absent with no modifier. */
      readonly modifierAt: number | undefined;

      /** The vocabulary's token, when it names one. */
      readonly token: TemplateToken | undefined;
      readonly problem: TemplateProblem | undefined;
    };

/**
 * Escapes, tokens with their modifiers, a brace standing alone and literal
 * text, in the order a template is read: the grammar of `readTemplate` in the
 * import-export package, read here for where each part lies rather than for
 * what the template makes.
 */
const PARTS = /\{\{|\}\}|\{([^{}:]*)(?::([^{}]*))?\}|[{}]|[^{}]+/gu;

/** The problem with a token, under a vocabulary keyed by name, or none. */
function problemOf(
  name: string,
  modifier: string | undefined,
  tokens: ReadonlyMap<string, TemplateToken> | undefined,
): TemplateProblem | undefined {
  if (tokens === undefined) return undefined;
  const token = tokens.get(name);
  if (token === undefined) return { kind: 'unknown-token', name, modifier };
  if (modifier === undefined || token.modifiers?.has(modifier) === true) return undefined;
  return { kind: 'unaccepted-modifier', token, modifier };
}

/** The tokens of a vocabulary by name. */
export function tokensByName(tokens: readonly TemplateToken[]): ReadonlyMap<string, TemplateToken> {
  return new Map(tokens.map((token) => [token.name, token]));
}

/**
 * The parts of `text`, each with what it is and where it starts.
 *
 * Without `tokens`, every name is read as a token, as a template written out
 * in an explanation is, where only the field's own vocabulary could say which
 * are known.
 */
export function readTemplateSegments(
  text: string,
  tokens: ReadonlyMap<string, TemplateToken> | undefined,
): readonly TemplateSegment[] {
  const segments: TemplateSegment[] = [];
  for (const match of text.matchAll(PARTS)) {
    const [whole, name, modifier] = match;
    const start = match.index;
    if (whole === '{{' || whole === '}}') {
      segments.push({ kind: 'escape', start, text: whole });
    } else if (name !== undefined) {
      segments.push({
        kind: 'token',
        start,
        text: whole,
        modifierAt: modifier === undefined ? undefined : name.length + 1,
        token: tokens?.get(name),
        problem: problemOf(name, modifier, tokens),
      });
    } else if (whole === '{' || whole === '}') {
      segments.push({
        kind: 'token',
        start,
        text: whole,
        modifierAt: undefined,
        token: undefined,
        problem: { kind: 'lone-brace', brace: whole },
      });
    } else {
      segments.push({ kind: 'text', start, text: whole });
    }
  }
  return segments;
}

/** The token the caret at `offset` sits inside, where it sits inside one. */
export function tokenAt(
  segments: readonly TemplateSegment[],
  offset: number,
): (TemplateSegment & { readonly kind: 'token' }) | undefined {
  return segments.find(
    (segment): segment is TemplateSegment & { readonly kind: 'token' } =>
      segment.kind === 'token' &&
      offset > segment.start &&
      offset < segment.start + segment.text.length,
  );
}
