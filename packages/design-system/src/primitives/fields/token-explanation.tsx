/**
 * The rich tooltip of a template field's token: what a known token stands
 * for, or why one is shown in the danger colour, for the token under the
 * pointer or the one the caret was moved onto.
 */

import { Tooltip as RadixTooltip } from 'radix-ui';
import { useId, useState, type ReactNode, type RefObject } from 'react';

import {
  RichTooltipBody,
  RichTooltipTone,
  richTooltipSurface,
  type RichTooltipContent,
} from '../overlays/rich-tooltip.js';
import { tokenAt, type TemplateSegment, type TemplateToken } from './template-syntax.js';
import { templateNodes } from './template-text.js';
import type { TemplateVocabulary } from './template-vocabulary.js';

/** A token of a template, as it was read. */
type TokenSegment = TemplateSegment & { readonly kind: 'token' };

/** What a known token's rich tooltip says: its summary, description and examples. */
export function tokenExplanation(token: TemplateToken): RichTooltipContent {
  return {
    title: token.summary,
    children: token.description,
    ...(token.examples === undefined
      ? {}
      : {
          example: token.examples.map((example, index) => (
            // The examples are the caller's, in its order, and fixed.
            <p key={index}>{example}</p>
          )),
        }),
  };
}

/** What the rich tooltip of one token of a template says. */
function explanationOf(segment: TokenSegment, vocabulary: TemplateVocabulary): RichTooltipContent {
  if (segment.problem === undefined && segment.token !== undefined) {
    return tokenExplanation(segment.token);
  }
  const { title, body, example } =
    segment.problem === undefined
      ? { title: segment.text, body: undefined, example: undefined }
      : vocabulary.explain(segment.problem);
  return {
    title,
    icon: 'field-error',
    tone: RichTooltipTone.Danger,
    children: body,
    ...(example === undefined ? {} : { example }),
  };
}

/** The index of the token drawn under a point along the line, if any. */
function tokenUnder(mirror: HTMLElement, clientX: number): number | undefined {
  for (const element of mirror.querySelectorAll<HTMLElement>('[data-ag-segment]')) {
    const { left, right } = element.getBoundingClientRect();
    if (clientX >= left && clientX <= right) return Number(element.dataset['agSegment']);
  }
  return undefined;
}

/** A token's drawing, with its rich tooltip open below it. */
function explained(node: ReactNode, explanation: RichTooltipContent, onClose: () => void) {
  const { tone, ...content } = explanation;
  return (
    <RadixTooltip.Root
      key="explained"
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <RadixTooltip.Trigger asChild>{node}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          {...richTooltipSurface(tone)}
          side="bottom"
          align="start"
          sideOffset={8}
          // Read with the field, which names it as its description, rather
          // than announced as a tooltip of a drawing a reader cannot reach.
          aria-hidden="true"
        >
          <RichTooltipBody {...content} />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

/** The index of the token a collapsed caret sits inside, if any. */
function caretToken(
  field: HTMLInputElement,
  segments: readonly TemplateSegment[],
): number | undefined {
  const { selectionStart, selectionEnd } = field;
  if (selectionStart === null || selectionStart !== selectionEnd) return undefined;
  const on = tokenAt(segments, selectionStart);
  return on === undefined ? undefined : segments.indexOf(on);
}

/** The explanation of the caret's token as the field's description, for a screen reader. */
function CaretDescription({
  id,
  explanation,
}: {
  readonly id: string;
  readonly explanation: RichTooltipContent;
}): ReactNode {
  return (
    <div id={id} className="ag-visually-hidden">
      {explanation.title}
      {'. '}
      {explanation.children}
      {explanation.example}
    </div>
  );
}

/** Where the explained token comes from. */
export interface TokenExplanationSource {
  readonly segments: readonly TemplateSegment[];
  readonly vocabulary: TemplateVocabulary;
  readonly mirror: RefObject<HTMLElement | null>;
  readonly field: RefObject<HTMLInputElement | null>;

  /** While the token list is open, it explains its own rows instead. */
  readonly listOpen: boolean;
}

/**
 * The token under the pointer, or the one the caret was moved onto, with its
 * rich tooltip drawn on it, and the field's description of it while the caret
 * is the reason it is shown.
 */
export function useTokenExplanation({
  segments,
  vocabulary,
  mirror,
  field,
  listOpen,
}: TokenExplanationSource) {
  const describedId = useId();
  const [hovered, setHovered] = useState<number | undefined>(undefined);
  const [caretOn, setCaretOn] = useState<number | undefined>(undefined);

  const forget = (): void => {
    setHovered(undefined);
    setCaretOn(undefined);
  };

  const shown = listOpen ? undefined : (hovered ?? caretOn);
  const segment = shown === undefined ? undefined : segments[shown];
  const explanation = segment?.kind === 'token' ? explanationOf(segment, vocabulary) : undefined;
  const byCaret = explanation !== undefined && hovered === undefined && caretOn !== undefined;

  const nodes = [...templateNodes(segments, hovered)];
  if (shown !== undefined && explanation !== undefined) {
    nodes[shown] = explained(nodes[shown], explanation, forget);
  }

  return {
    nodes,
    forget,
    describedBy: byCaret ? describedId : undefined,
    description: byCaret && <CaretDescription id={describedId} explanation={explanation} />,
    pointed: (clientX: number): void => {
      const copy = mirror.current;
      if (copy === null || listOpen) return;
      const under = tokenUnder(copy, clientX);
      if (under !== hovered) setHovered(under);
    },
    pointerLeft: (): void => {
      setHovered(undefined);
    },

    // Explained once the reader moves onto it, not while they type it, when it
    // is read as unknown at every key until it closes.
    caretMoved: (): void => {
      if (field.current !== null) setCaretOn(caretToken(field.current, segments));
    },
    typed: (): void => {
      setCaretOn(undefined);
    },
  };
}
