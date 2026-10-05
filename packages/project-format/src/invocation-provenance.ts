/**
 * Which arguments of a change hold provenance, and the rewrite of them: the
 * port a whole history is stripped and checked through (REQ-STOR-166,
 * REQ-STOR-101).
 *
 * This package sits below the commands and cannot know which command carries
 * what, so each project command declares which of its arguments holds a value
 * with provenance in it, and of which shape, and the command layer builds this
 * port from those declarations; storage is given the port and learns no
 * command's shape. A value travels in an argument as one string of compact
 * canonical JSON in the project document's own shape, so it is read by the
 * document's reader for that shape, as the command reads it, rewritten, and
 * written back as the command layer writes it. An argument the rewrite leaves
 * as it was keeps its text, and an invocation none of whose arguments changed
 * is given back as it was, which is how a reader checks a change is at a level
 * already. A change of a command no declaration names is refused, since what it
 * holds cannot be known.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';

import { readAssetRecord, writeAssetRecord } from './asset-record-json.js';
import {
  canonicalJson,
  type JsonLimits,
  type JsonObject,
  type JsonValue,
} from './canonical-json.js';
import { startReading, type Converter } from './document-reading.js';
import type { InvocationRecord } from './history-record.js';
import { LONGEST_ARGUMENT_TEXT } from './invocation-json.js';
import { parseJson } from './json-parsing.js';
import { writeExternalIdentity, writeMediaSource } from './project-writing.js';
import type { SourceRewrite } from './provenance-stripping.js';
import { readExternalIdentity, readMediaSource } from './source-reading.js';

/**
 * The bounds a nested argument's text is read within.
 *
 * As long as an argument's text may be, since an asset record carries the
 * asset's chain of edits and a paste carries its plan, neither of which any
 * count of names bounds. As deep as the deepest value an argument holds: an
 * asset record (1) holds its asset (2), whose edits (3) hold a paste (4) whose
 * payload (5) has streams (6), each a stream (7) of segments (8), each a
 * segment (9) of stages (10), each a stage (11) whose matrix (12) has rows
 * (13). A single operation or plan nests less, and a region less still.
 */
export const NESTED_ARGUMENT_LIMITS: JsonLimits = {
  maximumLength: LONGEST_ARGUMENT_TEXT,
  maximumDepth: 13,
};

/** The shapes of value with provenance in it that an argument may hold. */
export const ProvenanceArgument = {
  /** An asset with its source, as `writeAssetRecord` writes one. */
  AssetRecord: 'asset-record',

  /** Where an asset's bytes are kept, as `writeMediaSource` writes it. */
  MediaSource: 'media-source',

  /** What a linked file was known by, as `writeExternalIdentity` writes it. */
  ExternalIdentity: 'external-identity',
} as const;

/** The shapes of value with provenance in it that an argument may hold. */
export type ProvenanceArgument = (typeof ProvenanceArgument)[keyof typeof ProvenanceArgument];

/** A command's arguments that hold provenance, by name, each with its shape. */
export type ProvenanceArguments = Readonly<Record<string, ProvenanceArgument>>;

/**
 * A change's invocation with the provenance its arguments hold rewritten by
 * `rewrite`, given back as it was where nothing changed, or why it cannot be.
 */
export type InvocationProvenance = (
  invocation: InvocationRecord,
  rewrite: SourceRewrite,
) => DomainResult<InvocationRecord>;

/** The port over each command's declaration, by command identifier. */
export function invocationProvenance(
  declarations: ReadonlyMap<string, ProvenanceArguments>,
): InvocationProvenance {
  return (invocation, rewrite) => {
    const declared = declarations.get(invocation.commandId);
    if (declared === undefined) {
      return fail(
        failure(
          'provenance.command-unknown',
          FailureKind.Unrecoverable,
          'A change was made by a command this version does not know, so what it holds of where the audio came from cannot be left out.',
          { details: { command: invocation.commandId } },
        ),
      );
    }
    const held = invocation.arguments;
    if (held === undefined) return succeed(invocation);
    const changed: Record<string, string> = {};
    for (const [name, shape] of Object.entries(declared)) {
      const text = held[name];
      if (typeof text !== 'string') continue;
      const rewritten = rewrittenArgument(shape, text, rewrite);
      if (!rewritten.ok) return rewritten;
      if (rewritten.value !== text) changed[name] = rewritten.value;
    }
    return Object.keys(changed).length === 0
      ? succeed(invocation)
      : succeed({ ...invocation, arguments: { ...held, ...changed } });
  };
}

/** An argument's text rewritten, or the same text where nothing in it changed. */
function rewrittenArgument(
  shape: ProvenanceArgument,
  text: string,
  rewrite: SourceRewrite,
): DomainResult<string> {
  const value = parseJson(text, NESTED_ARGUMENT_LIMITS);
  if (!value.ok) return value;
  switch (shape) {
    case ProvenanceArgument.AssetRecord:
      return rewritten(readAssetRecord, value.value, text, (record) => {
        const source = rewrite.source(record.source);
        return source === record.source ? undefined : writeAssetRecord({ ...record, source });
      });
    case ProvenanceArgument.MediaSource:
      return rewritten(readMediaSource, value.value, text, (media) => {
        const changed = rewrite.media(media);
        return changed === media ? undefined : writeMediaSource(changed);
      });
    case ProvenanceArgument.ExternalIdentity:
      return rewritten(readExternalIdentity, value.value, text, (identity) => {
        const changed = rewrite.identity(identity);
        return changed === identity ? undefined : writeExternalIdentity(changed);
      });
  }
}

/**
 * The text of a value read by `read` and written again by `write`, or the text
 * as it was where `write` gives nothing, the value being unchanged.
 */
function rewritten<TValue>(
  read: Converter<TValue>,
  value: JsonValue,
  text: string,
  write: (value: TValue) => JsonObject | undefined,
): DomainResult<string> {
  const reading = startReading();
  const held = reading.outcome(read(reading, value, '', ''));
  if (!held.ok) return held;
  const written = write(held.value);
  return succeed(written === undefined ? text : canonicalJson(written));
}
