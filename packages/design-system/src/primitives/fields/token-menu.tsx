/**
 * A template field's token list: the tokens its caller gives it, as a menu of
 * two columns, the token and what it stands for, with a footer saying how to
 * write a brace itself. The highlighted row's full description stands beside
 * the list as a rich tooltip; choosing a row inserts its token at the caret.
 */

import { DropdownMenu } from 'radix-ui';
import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

import { RichTooltipBody, RichTooltipTone } from '../overlays/rich-tooltip.js';
import { tokenExplanation } from './token-explanation.js';
import { readTemplateSegments, type TemplateToken } from './template-syntax.js';
import { templateNodes } from './template-text.js';
import type { TemplateVocabulary } from './template-vocabulary.js';

/** Where the list is drawn: as wide as the field, starting at its leading edge. */
export interface TokenMenuPlacement {
  /** The field's width, which the list is at least. */
  readonly inlineSize: number;

  /** How far the field's leading edge is from the button's, along the line. */
  readonly alignOffset: number;
}

/** What a token list takes. */
export interface TokenMenuProps {
  readonly vocabulary: TemplateVocabulary;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly placement: TokenMenuPlacement | undefined;

  /** The braces button, which opens the list. */
  readonly trigger: ReactNode;

  readonly onChoose: (token: TemplateToken) => void;

  /** Gives focus back to the field, at its caret, as the list closes. */
  readonly onClosed: () => void;
}

/** The row the keyboard or the pointer is on, and how far down the menu it starts. */
interface Highlighted {
  readonly token: TemplateToken;
  readonly row: HTMLElement;
}

/** A token as it is written in the list: in braces, drawn as a token. */
function writtenToken(token: TemplateToken): ReactNode {
  return templateNodes(readTemplateSegments(`{${token.name}}`, undefined));
}

/** One row of the list: the token and what it stands for. */
function TokenRow({
  token,
  describedBy,
  onHighlight,
  onChoose,
}: {
  readonly token: TemplateToken;
  readonly describedBy: string | undefined;
  readonly onHighlight: (row: HTMLElement | undefined) => void;
  readonly onChoose: (token: TemplateToken) => void;
}): ReactNode {
  return (
    <DropdownMenu.Item
      className="ag-menu-item ag-token-row ag-lit-row ag-touch-sized"
      textValue={token.name}
      {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
      onFocus={(event) => {
        onHighlight(event.currentTarget);
      }}
      onBlur={() => {
        onHighlight(undefined);
      }}
      onSelect={() => {
        onChoose(token);
      }}
    >
      <span className="ag-menu-item-label">{writtenToken(token)}</span>
      <span className="ag-token-row-summary">{token.summary}</span>
    </DropdownMenu.Item>
  );
}

/**
 * The highlighted row, and the menu's element and its explanation's, which
 * stands level with its row wherever the list has scrolled to; the menu's
 * element is given the field's width, which the list is at least.
 */
function useHighlightedTip(placement: TokenMenuPlacement | undefined) {
  const menu = useRef<HTMLDivElement | null>(null);
  const tip = useRef<HTMLDivElement | null>(null);
  const [highlighted, setHighlighted] = useState<Highlighted | undefined>(undefined);

  const level = useCallback(() => {
    const surface = menu.current;
    const explanation = tip.current;
    if (surface === null || explanation === null || highlighted === undefined) return;
    const offset =
      highlighted.row.getBoundingClientRect().top - surface.getBoundingClientRect().top;
    explanation.style.setProperty('--ag-token-tip-offset', `${String(offset)}px`);
  }, [highlighted]);

  useLayoutEffect(level, [level]);

  const placed = useCallback(
    (element: HTMLDivElement | null) => {
      menu.current = element;
      if (element === null || placement === undefined) return;
      element.style.setProperty('--ag-token-list-inline-size', `${String(placement.inlineSize)}px`);
    },
    [placement],
  );

  return { highlighted, setHighlighted, tip, level, placed };
}

/**
 * The highlighted token's full description, beside the list. Out of the
 * menu's own tree, which holds only its entries and labels, and read as the
 * highlighted entry's description.
 */
function TokenTip({
  id,
  token,
  tip,
}: {
  readonly id: string;
  readonly token: TemplateToken;
  readonly tip: RefObject<HTMLDivElement | null>;
}): ReactNode {
  return (
    <div
      ref={tip}
      id={id}
      className="ag-rich-tooltip ag-token-tip"
      data-ag-tone={RichTooltipTone.Plain}
      aria-hidden="true"
    >
      <RichTooltipBody {...tokenExplanation(token)} />
    </div>
  );
}

/** The list of a template field's tokens. */
export function TokenMenu({
  vocabulary,
  open,
  onOpenChange,
  placement,
  trigger,
  onChoose,
  onClosed,
}: TokenMenuProps): ReactNode {
  const tipId = useId();
  const { highlighted, setHighlighted, tip, level, placed } = useHighlightedTip(placement);

  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          ref={placed}
          className="ag-token-menu ag-overlay"
          aria-label={vocabulary.insertLabel}
          align="start"
          alignOffset={placement?.alignOffset ?? 0}
          sideOffset={6}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            setHighlighted(undefined);
            onClosed();
          }}
        >
          <div className="ag-menu ag-token-list" onScroll={level}>
            {vocabulary.tokens.map((token) => (
              <TokenRow
                key={token.name}
                token={token}
                describedBy={highlighted?.token === token ? tipId : undefined}
                onHighlight={(row) => {
                  setHighlighted(row === undefined ? undefined : { token, row });
                }}
                onChoose={onChoose}
              />
            ))}
            <DropdownMenu.Label className="ag-token-list-footer">
              {vocabulary.braceHelp}
            </DropdownMenu.Label>
          </div>
          {highlighted !== undefined && <TokenTip id={tipId} token={highlighted.token} tip={tip} />}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
