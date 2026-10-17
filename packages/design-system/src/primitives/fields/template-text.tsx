/**
 * A template drawn with its tokens highlighted: in a template field, under the
 * text the reader types; in the token list; and in an explanation that writes
 * a template out.
 */

import type { ReactNode } from 'react';

import {
  readTemplateSegments,
  tokensByName,
  type TemplateSegment,
  type TemplateToken,
} from './template-syntax.js';

/** One part of a template, drawn. `hovered` marks the token under the pointer. */
function segmentNode(segment: TemplateSegment, index: number, hovered: boolean): ReactNode {
  switch (segment.kind) {
    case 'text':
      return segment.text;
    case 'escape':
      return (
        <span key={index} className="ag-template-escape">
          {segment.text[0]}
          <span className="ag-template-escape-second">{segment.text[1]}</span>
        </span>
      );
    case 'token': {
      const { text, modifierAt } = segment;
      return (
        <span
          key={index}
          className="ag-template-token"
          data-ag-segment={index}
          {...(segment.problem === undefined ? {} : { 'data-ag-problem': segment.problem.kind })}
          {...(hovered ? { 'data-ag-hovered': '' } : {})}
        >
          {modifierAt === undefined ? (
            text
          ) : (
            <>
              {text.slice(0, modifierAt)}
              <span className="ag-template-modifier">{text.slice(modifierAt, -1)}</span>
              {text.slice(-1)}
            </>
          )}
        </span>
      );
    }
  }
}

/** The parts of a template, drawn; `hovered` is the index of the token under the pointer. */
export function templateNodes(
  segments: readonly TemplateSegment[],
  hovered?: number,
): readonly ReactNode[] {
  return segments.map((segment, index) => segmentNode(segment, index, index === hovered));
}

/** What a written-out template takes. */
export interface TemplateTextProps {
  /** The template, as it would be typed. */
  readonly text: string;

  /**
   * The tokens it may name, where a token it does not know should show as
   * one; without them, every token is drawn as known.
   */
  readonly tokens?: readonly TemplateToken[];
}

/**
 * A template written out in text, such as an example in a token's explanation,
 * in the field's own type and colours.
 */
export function TemplateText({ text, tokens }: TemplateTextProps): ReactNode {
  const known = tokens === undefined ? undefined : tokensByName(tokens);
  return (
    <code className="ag-template-text">{templateNodes(readTemplateSegments(text, known))}</code>
  );
}
