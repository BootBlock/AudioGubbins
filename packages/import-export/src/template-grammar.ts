/**
 * The one grammar of name templates (ADR-0092, ADR-0102): text with
 * `{token}` and `{token:modifier}` filled in, `{{` and `}}` for a brace, and
 * a brace standing alone refused.
 *
 * The grammar is read once, here; what a template may name is the caller's,
 * stated as a vocabulary, so the export's file names and a game group's
 * naming read the same way and refuse in the same words.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';

/** What a template may name, and how its refusals are worded and coded. */
export interface TemplateVocabulary<Token extends string> {
  /** The tokens, in the order a refusal lists them. */
  readonly tokens: ReadonlySet<Token>;

  /** The modifiers each token takes; a token absent here takes none. */
  readonly modifiers: ReadonlyMap<Token, ReadonlySet<string>>;

  /** What the template is called in a refusal, such as "file name template". */
  readonly noun: string;

  /** The code every refusal of a template of this vocabulary carries. */
  readonly refusalCode: string;
}

/** One part of a template, in order: literal text, or a token and the modifier given it. */
export type TemplatePart<Token extends string> =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'token'; readonly token: Token; readonly modifier?: string };

/** Escapes, tokens with their modifiers, and a brace standing alone, in the order a template is read. */
const PARTS = /\{\{|\}\}|\{([^{}:]*)(?::([^{}]*))?\}|[{}]|[^{}]+/gu;

const BRACE = /[{}]/gu;

/** `items` as a sentence's list: "a, b and c". */
function listed(items: readonly string[]): string {
  const last = items.at(-1) ?? '';
  return items.length < 2 ? last : `${items.slice(0, -1).join(', ')} and ${last}`;
}

function refused<Token extends string>(
  vocabulary: TemplateVocabulary<Token>,
  sentence: string,
): DomainResult<never> {
  return fail(failure(vocabulary.refusalCode, FailureKind.Rejected, sentence));
}

function isToken<Token extends string>(
  name: string,
  vocabulary: TemplateVocabulary<Token>,
): name is Token {
  const names: ReadonlySet<string> = vocabulary.tokens;
  return names.has(name);
}

function tokenPart<Token extends string>(
  token: string,
  modifier: string | undefined,
  vocabulary: TemplateVocabulary<Token>,
): DomainResult<TemplatePart<Token>> {
  if (!isToken(token, vocabulary)) {
    const known = listed([...vocabulary.tokens].map((one) => `{${one}}`));
    return refused(
      vocabulary,
      `The ${vocabulary.noun} names {${token}}, which is not one of ${known}.`,
    );
  }
  if (modifier === undefined) return succeed({ kind: 'token', token });
  const taken = vocabulary.modifiers.get(token);
  if (taken === undefined) {
    return refused(
      vocabulary,
      `The ${vocabulary.noun} gives {${token}} the modifier "${modifier}", but {${token}} takes no modifier.`,
    );
  }
  if (!taken.has(modifier)) {
    return refused(
      vocabulary,
      `The ${vocabulary.noun} gives {${token}} the modifier "${modifier}", which is not one of ${listed([...taken])}.`,
    );
  }
  return succeed({ kind: 'token', token, modifier });
}

/** A template's parts under `vocabulary`, or why it is not one. */
export function readTemplate<Token extends string>(
  template: string,
  vocabulary: TemplateVocabulary<Token>,
): DomainResult<readonly TemplatePart<Token>[]> {
  if (template.trim() === '') {
    return refused(vocabulary, `A ${vocabulary.noun} cannot be empty.`);
  }
  const parts: TemplatePart<Token>[] = [];
  for (const match of template.matchAll(PARTS)) {
    const [whole, name, modifier] = match;
    if (whole === '{{' || whole === '}}') {
      parts.push({ kind: 'text', text: whole[0] ?? '' });
    } else if (name !== undefined) {
      const part = tokenPart(name, modifier, vocabulary);
      if (!part.ok) return part;
      parts.push(part.value);
    } else if (whole === '{' || whole === '}') {
      return refused(
        vocabulary,
        `A brace in a ${vocabulary.noun} opens or closes a token; write {{ or }} for the brace itself.`,
      );
    } else {
      parts.push({ kind: 'text', text: whole });
    }
  }
  return succeed(parts);
}

/** `text` as a template that fills to exactly `text`: each brace doubled. */
export function escapeTemplateText(text: string): string {
  return text.replace(BRACE, (brace) => brace + brace);
}
