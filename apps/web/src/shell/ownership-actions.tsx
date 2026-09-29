/**
 * What a person can do about which tab changes the open project, beside what
 * the banner says of it (REQ-STOR-098, REQ-UX-005).
 *
 * Taking a project over is explained before it is done: the button that takes
 * it over is behind a second one, beside the sentence saying the other tab
 * stops at once and loses what it had not saved. Every action runs a command.
 */

import { useState, type ReactNode } from 'react';

import { Button, ButtonTone } from '@audiogubbins/design-system';
import type { ProjectSnapshot } from '@audiogubbins/storage';

import { requestSentence } from './project-words.js';
import type { RunCommand } from './settings/section.js';

/** What the actions read and run. */
interface OwnershipActionsProps {
  readonly snapshot: ProjectSnapshot;

  /** The project's name, quoted. */
  readonly name: string;

  /** Whether this tab is waiting for an answer to its request. */
  readonly asking: boolean;
  readonly run: RunCommand;
}

/** Taking the project over, once the person has read what it costs. */
function TakeOverConfirmation({
  onCancel,
  run,
}: {
  readonly onCancel: () => void;
  readonly run: RunCommand;
}): ReactNode {
  return (
    <div className="ag-project-banner-confirm" role="group" aria-label="Take over the project">
      <p className="ag-project-banner-text" data-ag-status="unavailable">
        Taking over stops the other tab changing it at once. Anything it has not saved yet is lost.
      </p>
      <Button
        compact
        tone={ButtonTone.Destructive}
        onClick={() => {
          onCancel();
          run('project.take-over');
        }}
      >
        Take over now
      </Button>
      <Button compact onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

/** Asking for the project, and taking it over once the cost is read. */
function AskOrTakeOver({
  asking,
  run,
}: {
  readonly asking: boolean;
  readonly run: RunCommand;
}): ReactNode {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <TakeOverConfirmation
        onCancel={() => {
          setConfirming(false);
        }}
        run={run}
      />
    );
  }
  return (
    <>
      {/* Kept focusable while it waits, so focus does not leave it for the
        page; a press then does nothing. */}
      <Button
        compact
        aria-disabled={asking}
        onClick={() => {
          if (!asking) run('project.request-control');
        }}
      >
        {asking ? 'Asking…' : 'Ask to change it'}
      </Button>
      <Button
        compact
        onClick={() => {
          setConfirming(true);
        }}
      >
        Take over…
      </Button>
    </>
  );
}

/** The actions for how this tab may use the project now. */
export function OwnershipActions({
  snapshot,
  name,
  asking,
  run,
}: OwnershipActionsProps): ReactNode {
  const { access } = snapshot;
  switch (access.kind) {
    case 'writable': {
      const [request] = access.transferRequests;
      if (request === undefined) return null;
      return (
        <div
          className="ag-project-banner-request"
          role="group"
          aria-label="A request for the project"
        >
          <p className="ag-project-banner-text" data-ag-status="reduced">
            {requestSentence(request.from, name)}
          </p>
          <Button
            compact
            tone={ButtonTone.Primary}
            onClick={() => run('project.hand-over', { request: request.id })}
          >
            Hand it over
          </Button>
          <Button compact onClick={() => run('project.keep', { request: request.id })}>
            Keep it
          </Button>
        </div>
      );
    }
    case 'read-only':
      if (access.reason.kind === 'busy') return <AskOrTakeOver asking={asking} run={run} />;
      if (access.reason.kind === 'no-coordination') return null;
      return (
        <Button compact onClick={() => run('project.open-to-change')}>
          Open to change
        </Button>
      );
    case 'lost':
    case 'handed-over':
      return (
        <Button compact onClick={() => run('project.open-to-read')}>
          Open to read
        </Button>
      );
    case 'closed':
      return null;
  }
}
