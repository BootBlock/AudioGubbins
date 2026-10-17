/**
 * What a template field is told about the kinds of name template
 * AudioGubbins reads (ADR-0092, ADR-0102): an export's file name. Each is the
 * domain's own vocabulary, which says what the
 * template may name and which modifiers each token takes, given the words a
 * reader sees for every token, and the domain's own refusal for a token it
 * does not read, so the field marks red exactly what the export would refuse,
 * and says why in the same words.
 *
 * Every grammar is `readTemplate`'s, where a brace typed twice is one brace,
 * which is what the field draws an escape as.
 */

import type { ReactNode } from 'react';

import {
  TemplateText,
  type TemplateProblem,
  type TemplateToken,
  type TemplateVocabulary,
} from '@audiogubbins/design-system';
import {
  FILE_NAME_VOCABULARY,
  readTemplate,
  type FileNameToken,
  type TemplateVocabulary as Grammar,
} from '@audiogubbins/import-export';

/** What a reader is told about one token: its summary, its description and its examples. */
interface TokenWords {
  readonly summary: string;
  readonly description: ReactNode;
  readonly examples?: readonly ReactNode[];
}

/** A template written out where a sentence names one: `{token}` in the field's own drawing. */
const TOKEN_IN_SENTENCE = /(\{[^{}]*\})/u;

/** A sentence of the domain's with each token it names drawn as the field draws it. */
function withTokens(sentence: string): ReactNode {
  return sentence
    .split(TOKEN_IN_SENTENCE)
    .map((part, index) =>
      index % 2 === 1 ? <TemplateText key={String(index)} text={part} /> : part,
    );
}

/** The text a problem was read from, as the domain would read it alone. */
function problemText(problem: TemplateProblem): string {
  switch (problem.kind) {
    case 'unknown-token':
      return problem.modifier === undefined
        ? `{${problem.name}}`
        : `{${problem.name}:${problem.modifier}}`;
    case 'unaccepted-modifier':
      return `{${problem.token.name}:${problem.modifier}}`;
    case 'lone-brace':
      return problem.brace;
  }
}

/** How to write a brace itself, the same in every template. */
const BRACE_HELP: ReactNode = (
  <>
    To write a brace itself, type it twice: <TemplateText text="{{" /> gives {'{'}.
  </>
);

const BRACES_BOTH_WAYS: ReactNode = (
  <p>
    To write a brace itself, type it twice: <TemplateText text="{{" /> gives {'{'} and{' '}
    <TemplateText text="}}" /> gives {'}'}.
  </p>
);

/**
 * The field's vocabulary for a domain's grammar: its tokens, in the domain's
 * order, each with its words and the modifiers the domain lets it take, and
 * the domain's refusal of whatever it does not read.
 */
function fieldVocabulary<Token extends string>(
  grammar: Grammar<Token>,
  words: Readonly<Record<Token, TokenWords>>,
): TemplateVocabulary {
  const tokens: readonly TemplateToken[] = [...grammar.tokens].map((name) => {
    const modifiers = grammar.modifiers.get(name);
    return {
      name,
      ...words[name],
      ...(modifiers === undefined ? {} : { modifiers }),
    };
  });
  return {
    tokens,
    insertLabel: 'Insert a token',
    braceHelp: BRACE_HELP,
    explain: (problem) => {
      const read = readTemplate(problemText(problem), grammar);
      return {
        title: 'Not a token',
        body: read.ok ? undefined : <p>{withTokens(read.failures[0].summary)}</p>,
        example: BRACES_BOTH_WAYS,
      };
    },
  };
}

/** The words of an export's file name template's tokens. */
const FILE_NAME_WORDS: Readonly<Record<FileNameToken, TokenWords>> = {
  project: { summary: 'The project’s name', description: <p>The project’s name.</p> },
  region: {
    summary: 'The region’s name',
    description: <p>The name of the region being exported, for an export of regions.</p>,
  },
  index: {
    summary: 'Its place in the export',
    description: (
      <p>
        Counts the files of the export from 1, with zeros in front to the digits the export needs,
        so the files sort in order.
      </p>
    ),
    examples: [
      <>
        <TemplateText text="take_{index}" /> gives <code>take_07</code> for the seventh of twelve
        files.
      </>,
    ],
  },
  date: {
    summary: 'The day you export',
    description: <p>The day the export was asked for, written year, month and day.</p>,
    examples: [
      <>
        <TemplateText text="{project}_{date}" /> gives <code>Quayside_2026-10-17</code>.
      </>,
    ],
  },
  format: {
    summary: 'The file’s extension',
    description: <p>The extension of the format it is written in, such as wav or flac.</p>,
  },
};

/** The template field's vocabulary for an export's file name. */
export const FILE_NAME_FIELD: TemplateVocabulary = fieldVocabulary(
  FILE_NAME_VOCABULARY,
  FILE_NAME_WORDS,
);
