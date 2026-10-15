/**
 * A naming template: the policy that names a group's members' files and
 * regions (ADR-0102), such as `{group:snake}_{number:2}`.
 *
 * A template is read when it is made, so one that is held is one the game
 * vocabulary reads: its source is what is stored and shown, and its parts are
 * what expansion fills.
 */

import { mapResult, type DomainResult } from '@audiogubbins/domain';
import { readTemplate, type TemplatePart } from '@audiogubbins/import-export';

import { NAMING_VOCABULARY, type NamingToken } from './naming-vocabulary.js';

export interface NamingTemplate {
  /** The template as the person wrote it. */
  readonly source: string;

  /** The source read, in order. */
  readonly parts: readonly TemplatePart<NamingToken>[];
}

/** The template `source` writes, or why the game vocabulary does not read it. */
export function namingTemplate(source: string): DomainResult<NamingTemplate> {
  return mapResult(readTemplate(source, NAMING_VOCABULARY), (parts) => ({ source, parts }));
}
