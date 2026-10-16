/**
 * The file name template: text with tokens the export fills in.
 *
 * `{project}` is the project's name, `{region}` the region's, `{index}` the
 * file's place in its batch from 1, padded with zeros to the width of the
 * batch's count so the files sort in order, `{date}` the day the export was
 * asked for, `yyyy-mm-dd`, from the clock and the offset from UTC the caller
 * gives, so nothing here reads a clock or a time zone, and `{format}` the
 * file's extension. `{{` and `}}` are a brace; the grammar is
 * `template-grammar.ts`'s, and no token here takes a modifier. The filled
 * template is the stem the file is named by, made safe by `safeFileName`.
 */

import type { DomainResult } from '@audiogubbins/domain';

import { readTemplate, type TemplatePart, type TemplateVocabulary } from './template-grammar.js';

/** The tokens a template may hold. */
export type FileNameToken = 'project' | 'region' | 'index' | 'date' | 'format';

/** The file name's vocabulary: its tokens, none of which takes a modifier. */
const FILE_NAME_VOCABULARY: TemplateVocabulary<FileNameToken> = {
  tokens: new Set<FileNameToken>(['project', 'region', 'index', 'date', 'format']),
  modifiers: new Map(),
  noun: 'file name template',
  refusalCode: 'import-export.file-name-template-invalid',
};

/** A template read into its parts. */
export type FileNameTemplate = readonly TemplatePart<FileNameToken>[];

/** A template's parts, or why it is not one. */
export function readFileNameTemplate(template: string): DomainResult<FileNameTemplate> {
  return readTemplate(template, FILE_NAME_VOCABULARY);
}

/** Whether a template names a token. */
export function templateNames(template: FileNameTemplate, token: FileNameToken): boolean {
  return template.some((part) => part.kind === 'token' && part.token === token);
}

/** A moment on the caller's clock, and its offset from UTC there, for `{date}`. */
export interface ExportClock {
  readonly epochMilliseconds: number;
  readonly utcOffsetMinutes: number;
}

/** What a template's tokens are filled with for one file. */
export interface FileNameValues {
  readonly project: string;
  readonly region: string | undefined;

  /** The file's place in its batch, from 1, and the batch's count. */
  readonly index: number;
  readonly count: number;
  readonly clock: ExportClock;
  readonly extension: string;
}

const MILLISECONDS_PER_MINUTE = 60_000;

/** The day `clock` falls on at its offset from UTC, `yyyy-mm-dd`. */
export function dateOf(clock: ExportClock): string {
  const local = new Date(
    clock.epochMilliseconds + clock.utcOffsetMinutes * MILLISECONDS_PER_MINUTE,
  );
  const year = String(local.getUTCFullYear()).padStart(4, '0');
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function tokenValue(token: FileNameToken, values: FileNameValues): string {
  switch (token) {
    case 'project':
      return values.project;
    case 'region':
      return values.region ?? '';
    case 'index':
      return String(values.index).padStart(String(values.count).length, '0');
    case 'date':
      return dateOf(values.clock);
    case 'format':
      return values.extension;
  }
}

/** The stem a template gives one file, before it is made safe. */
export function fillFileNameTemplate(template: FileNameTemplate, values: FileNameValues): string {
  return template
    .map((part) => (part.kind === 'text' ? part.text : tokenValue(part.token, values)))
    .join('');
}
