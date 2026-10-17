/**
 * What the user sees when part of the interface throws.
 *
 * Without an error boundary, any throw below the composition root would unmount
 * the whole tree and leave an empty page: a panel that throws on its first
 * paint would blank the entire application, and the user would be told nothing
 * and could do nothing but reload into the same crash. REQ-EXEC-136.15 requires
 * a failure to be reported rather than hidden.
 *
 * Two boundaries, at the two places a failure can be contained. Each panel has
 * one, so a panel that fails costs the user that panel and leaves the menus,
 * the other panels and the settings working. The application has one around
 * everything, for a failure outside any panel, and its notice needs nothing
 * that may have been what failed: no theme, no primitive, no store.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button, ButtonTone, Icon, IconSize, Section } from '@audiogubbins/design-system';
import { sanitiseStack, type Logger } from '@audiogubbins/diagnostics';

/** What a boundary shows once its part has failed. */
export interface FailureNoticeProps {
  /** What failed, as the thrown value said. */
  readonly failure: unknown;

  /** Renders the failed part again, for a failure that may not recur. */
  readonly retry: () => void;
}

/** What a boundary needs. */
export interface FailureBoundaryProps {
  /** Which part of the interface this contains, as a log field. */
  readonly part: string;

  readonly logger: Logger;

  /** What to show in place of the part once it has failed. */
  readonly notice: (props: FailureNoticeProps) => ReactNode;

  readonly children: ReactNode;
}

/** Whether the part has failed, and with what. */
type FailureState =
  { readonly failed: false } | { readonly failed: true; readonly failure: unknown };

/** The name and message of whatever was thrown, which need not be an `Error`. */
function describeFailure(failure: unknown): {
  readonly name: string;
  readonly message: string;
} {
  return failure instanceof Error
    ? { name: failure.name, message: failure.message }
    : { name: typeof failure, message: String(failure) };
}

/**
 * Contains a failure to the part of the interface that threw it.
 *
 * A class, because React offers no other way to catch a rendering failure.
 */
export class FailureBoundary extends Component<FailureBoundaryProps, FailureState> {
  override state: FailureState = { failed: false };

  static getDerivedStateFromError(failure: unknown): FailureState {
    return { failed: true, failure };
  }

  override componentDidCatch(failure: unknown, info: ErrorInfo): void {
    const { name, message } = describeFailure(failure);

    // The message and the stack go through the redaction rules again when a
    // report is assembled, on the user's terms. The component stack is kept as
    // frames too, because it says which component threw when the error's own
    // stack is minified past recognition.
    const stacks = [failure instanceof Error ? failure.stack : undefined, info.componentStack];
    this.props.logger.error(
      'A part of the interface failed and was replaced with a notice.',
      { part: this.props.part, failure: name, detail: message },
      sanitiseStack(stacks.filter((stack) => typeof stack === 'string').join('\n')),
    );
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return this.props.notice({
      failure: this.state.failure,
      retry: () => {
        this.setState({ failed: false });
      },
    });
  }
}

/**
 * The notice in place of a panel that failed.
 *
 * Inside the workspace, so it is themed like the panel it replaces, and it can
 * offer to try again: a panel that failed on data that has since changed may
 * well draw the second time. What went wrong is kept under Details, closed, so
 * the panel says what happened and what to do first (design language, section
 * 13).
 */
export function PanelFailure({
  title,
  failure,
  retry,
}: FailureNoticeProps & { readonly title: string }): ReactNode {
  const { name, message } = describeFailure(failure);

  return (
    <section className="ag-panel ag-panel-failure">
      <span className="ag-failure-mark">
        <Icon name="error" size={IconSize.Mark} />
      </span>
      <h2 className="ag-failure-title">{`The ${title} panel stopped working`}</h2>
      <p className="ag-failure-text">The rest of AudioGubbins still works.</p>
      <div className="ag-failure-actions">
        <Button compact tone={ButtonTone.Primary} onClick={retry}>
          <Icon name="try-again" size={IconSize.Inline} />
          Try the panel again
        </Button>
      </div>
      <div className="ag-panel-failure-details">
        <Section title="Details" defaultOpen={false}>
          <p className="ag-failure-text">The diagnostic log has a record of what happened.</p>
          <p className="ag-failure-code">{`${name}: ${message}`}</p>
        </Section>
      </div>
    </section>
  );
}

/**
 * The notice in place of the whole application.
 *
 * Plain elements and system colours only. It is shown because something failed
 * outside every panel, which may have been the theme, a primitive or a store,
 * so it depends on none of them: its stylesheet reads the theme's tokens where
 * they were written and falls back to the platform's colours where they were
 * not, and it draws no glyph, since a glyph is a primitive. Reloading is the
 * one thing it offers, because there is nothing left running to retry into.
 */
export function ApplicationFailure({ failure }: { readonly failure: unknown }): ReactNode {
  const { name, message } = describeFailure(failure);

  return (
    <main className="ag-application-failure" aria-labelledby="ag-application-failure-title">
      <div className="ag-application-failure-card">
        <h1 id="ag-application-failure-title" className="ag-application-failure-title">
          AudioGubbins stopped working
        </h1>
        <p className="ag-failure-text">
          Something in the interface failed, and it could not carry on. Nothing has been sent
          anywhere.
        </p>
        <code className="ag-failure-code">{`${name}: ${message}`}</code>
        <button
          type="button"
          className="ag-failure-action"
          onClick={() => {
            window.location.reload();
          }}
        >
          Reload AudioGubbins
        </button>
      </div>
    </main>
  );
}
