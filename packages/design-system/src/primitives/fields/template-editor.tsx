/**
 * The template field's editor: the text field's input, its tokens highlighted
 * under the text, the braces button that lists them, and a rich tooltip for
 * the token under the pointer or the caret.
 *
 * The input keeps its own text, caret, selection, undo and the platform's
 * corrections; it draws its text transparent over a copy that highlights each
 * token, set in the same type and scrolled with it, so the highlighting lies
 * exactly under the text and the caret never moves. A plain text field
 * renders none of this.
 */

import { Tooltip as RadixTooltip } from 'radix-ui';
import {
  useCallback,
  useMemo,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react';

import { Icon } from '../../icons/icon.js';
import { Button, ButtonTone } from '../button.js';
import { readTemplateSegments, tokensByName } from './template-syntax.js';
import type { TemplateVocabulary } from './template-vocabulary.js';
import { useTokenExplanation } from './token-explanation.js';
import { useTokenInsertion } from './token-insertion.js';
import { TokenMenu } from './token-menu.js';

/** The key that opens the token list from the field, as `aria-keyshortcuts` writes it. */
const OPEN_TOKEN_LIST_KEYS = 'Alt+ArrowDown';

/** The keys that move the caret without changing the text. */
const CARET_KEYS: ReadonlySet<string> = new Set([
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

/** What the editor takes: the input the text field built, and the template's vocabulary. */
export interface TemplateEditorProps {
  readonly vocabulary: TemplateVocabulary;
  readonly value: string;
  readonly onValueChange: (value: string) => void;

  /** Everything the plain field would give its input. */
  readonly input: InputHTMLAttributes<HTMLInputElement>;
}

/** The token list's state and the explanation's, as the editor's parts share them. */
type TokenList = ReturnType<typeof useTokenInsertion>;
type Explanation = ReturnType<typeof useTokenExplanation>;

/** The braces button inside the field's trailing end, and the token list it opens. */
function TokensButton({
  vocabulary,
  list,
  explanation,
  disabled,
}: {
  readonly vocabulary: TemplateVocabulary;
  readonly list: TokenList;
  readonly explanation: Explanation;
  readonly disabled: boolean;
}): ReactNode {
  return (
    <span className="ag-template-tokens-button">
      <TokenMenu
        vocabulary={vocabulary}
        open={list.open}
        onOpenChange={(open) => {
          if (!open) {
            list.closed();
            return;
          }
          explanation.forget();
          list.opened();
        }}
        placement={list.placement}
        onChoose={list.insert}
        onClosed={list.backToField}
        trigger={
          <Button
            tone={ButtonTone.Quiet}
            compact
            iconOnly
            label={vocabulary.insertLabel}
            disabled={disabled}
          >
            <Icon name="insert-token" />
          </Button>
        }
      />
    </span>
  );
}

/** The input the reader types in, which opens the list from a key and explains the caret's token. */
function TemplateInput({
  input,
  field,
  list,
  explanation,
  follow,
}: {
  readonly input: InputHTMLAttributes<HTMLInputElement>;
  readonly field: RefObject<HTMLInputElement | null>;
  readonly list: TokenList;
  readonly explanation: Explanation;
  readonly follow: () => void;
}): ReactNode {
  const describedBy = [input['aria-describedby'], explanation.describedBy]
    .filter((one) => one !== undefined)
    .join(' ');
  return (
    <input
      {...input}
      ref={field}
      {...(describedBy === '' ? {} : { 'aria-describedby': describedBy })}
      aria-keyshortcuts={OPEN_TOKEN_LIST_KEYS}
      spellCheck={false}
      onChange={(event) => {
        explanation.typed();
        input.onChange?.(event);
      }}
      onScroll={follow}
      onKeyUp={(event) => {
        if (CARET_KEYS.has(event.key)) explanation.caretMoved();
        follow();
      }}
      onPointerUp={explanation.caretMoved}
      onBlur={(event) => {
        explanation.typed();
        input.onBlur?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' && event.altKey && input.disabled !== true) {
          event.preventDefault();
          explanation.forget();
          list.opened();
          return;
        }
        input.onKeyDown?.(event);
      }}
    />
  );
}

/**
 * The input and the copy of its text, the copy scrolled with the input so a
 * long template's highlighting stays under its text.
 */
function useFollowingCopy() {
  const field = useRef<HTMLInputElement | null>(null);
  const mirror = useRef<HTMLSpanElement | null>(null);
  const follow = useCallback(() => {
    const element = field.current;
    const copy = mirror.current;
    if (element === null || copy === null) return;
    copy.style.transform = `translateX(${String(-element.scrollLeft)}px)`;
  }, []);
  return { field, mirror, follow };
}

/** The highlighted copy of the text, under the input. */
function TemplateCopy({
  mirror,
  children,
}: {
  readonly mirror: RefObject<HTMLSpanElement | null>;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <span className="ag-template-mirror" aria-hidden="true">
      <span ref={mirror} className="ag-template-mirror-text">
        {children}
      </span>
    </span>
  );
}

/** The template field's editor. */
export function TemplateEditor({
  vocabulary,
  value,
  onValueChange,
  input,
}: TemplateEditorProps): ReactNode {
  const tokens = useMemo(() => tokensByName(vocabulary.tokens), [vocabulary.tokens]);
  const segments = useMemo(() => readTemplateSegments(value, tokens), [value, tokens]);
  const { field, mirror, follow } = useFollowingCopy();

  const list = useTokenInsertion({
    field,
    value,
    onValueChange,
    maxLength: input.maxLength,
    follow,
  });
  const explanation = useTokenExplanation({
    segments,
    vocabulary,
    mirror,
    field,
    listOpen: list.open,
  });

  return (
    <RadixTooltip.Provider delayDuration={0}>
      <div
        className="ag-template-editor"
        onPointerMove={(event) => {
          explanation.pointed(event.clientX);
        }}
        onPointerLeave={explanation.pointerLeft}
      >
        <TemplateCopy mirror={mirror}>{explanation.nodes}</TemplateCopy>
        <TemplateInput
          input={input}
          field={field}
          list={list}
          explanation={explanation}
          follow={follow}
        />
        {explanation.description}
      </div>
      <TokensButton
        vocabulary={vocabulary}
        list={list}
        explanation={explanation}
        disabled={input.disabled ?? false}
      />
    </RadixTooltip.Provider>
  );
}
