/**
 * The rich tooltip: a title with its glyph, short paragraphs, code, a short
 * list and an example, for an explanation longer than a hint's line, such as
 * what a template token does or why it is red.
 */

import { Tooltip as RadixTooltip } from 'radix-ui';
import type { ReactNode } from 'react';

import { Icon, IconSize } from '../../icons/icon.js';
import type { IconName } from '../../icons/vocabulary.js';

/** Whether a rich tooltip explains, or says what is wrong. */
export const RichTooltipTone = {
  Plain: 'plain',

  /** Error light over the glass, an error edge and an error title. */
  Danger: 'danger',
} as const;

/** Whether a rich tooltip explains, or says what is wrong. */
export type RichTooltipTone = (typeof RichTooltipTone)[keyof typeof RichTooltipTone];

/** What a rich tooltip says. */
export interface RichTooltipContent {
  readonly title: string;
  readonly icon?: IconName;
  readonly tone?: RichTooltipTone;

  /**
   * The explanation: paragraphs, `<code>`, a short `<ul>`. Code is drawn as a
   * template token is.
   */
  readonly children: ReactNode;

  /** An example, below a quiet hairline. */
  readonly example?: ReactNode;
}

/** The inside of a rich tooltip, for a surface that places it itself. */
export function RichTooltipBody({ title, icon, children, example }: RichTooltipContent): ReactNode {
  return (
    <>
      <p className="ag-rich-tooltip-title">
        {icon !== undefined && <Icon name={icon} size={IconSize.Inline} />}
        {title}
      </p>
      {children}
      {example !== undefined && <div className="ag-rich-tooltip-example">{example}</div>}
    </>
  );
}

/** The class and tone attribute of a rich tooltip's surface. */
export function richTooltipSurface(tone: RichTooltipTone = RichTooltipTone.Plain) {
  return { className: 'ag-rich-tooltip ag-overlay', 'data-ag-tone': tone } as const;
}

/** What a rich tooltip takes. */
export interface RichTooltipProps extends RichTooltipContent {
  /**
   * The element the tooltip belongs to. It must pass the props and the ref it
   * is given down to a real element.
   */
  readonly trigger: ReactNode;
}

/** A rich explanation shown on hover or focus of what it belongs to. */
export function RichTooltip({ trigger, tone, ...content }: RichTooltipProps): ReactNode {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{trigger}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content {...richTooltipSurface(tone)} sideOffset={6}>
          <RichTooltipBody {...content} />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
