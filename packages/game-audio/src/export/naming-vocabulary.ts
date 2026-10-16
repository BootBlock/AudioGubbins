/**
 * What a game naming template may name (ADR-0102): the names of the project,
 * the member's asset and region, its group and the group's path, its place in
 * the group, the day and the format, read by the export's own grammar.
 *
 * Every text token takes a case modifier; `{number}` takes the width it is
 * padded to, 1 to 6 digits.
 */

import type { TemplateVocabulary } from '@audiogubbins/import-export';

import { CASE_MODIFIERS } from './case-modifiers.js';

/** The tokens a naming template may hold, in the order a refusal lists them. */
export const NAMING_TOKENS = [
  'project',
  'asset',
  'region',
  'group',
  'group-path',
  'number',
  'date',
  'format',
] as const;

export type NamingToken = (typeof NAMING_TOKENS)[number];

/** The widths `{number:N}` pads to. */
const NUMBER_WIDTHS = ['1', '2', '3', '4', '5', '6'] as const;

const CASES: ReadonlySet<string> = new Set(CASE_MODIFIERS);

export const NAMING_VOCABULARY: TemplateVocabulary<NamingToken> = {
  tokens: new Set(NAMING_TOKENS),
  modifiers: new Map<NamingToken, ReadonlySet<string>>([
    ['project', CASES],
    ['asset', CASES],
    ['region', CASES],
    ['group', CASES],
    ['group-path', CASES],
    ['number', new Set(NUMBER_WIDTHS)],
  ]),
  noun: 'naming template',
  refusalCode: 'game.naming-template-invalid',
};
