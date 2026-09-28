/**
 * Choosing what a diagnostic report contains, and agreeing to save it.
 *
 * REQ-PRIV-161: "The diagnostic-bundle UI must show the user what will be
 * included before submission or export." `describeBundleContents` does exactly
 * that, before the bundle is built, and this dialogue is where the user reads
 * it: the contents preview and the consent behind the choice about sharing that
 * the settings promise.
 *
 * The list the user sees is the list the export uses. Both are read from the
 * same sources through the same selection, so what is shown cannot differ from
 * what is saved. Nothing is included that the user did not leave switched on,
 * and the command that saves it is told the categories rather than choosing its
 * own.
 */

import { useMemo, useState, type ReactNode } from 'react';

import {
  BundleContentKey,
  DEFAULT_BUNDLE_CONTENTS,
  LONGEST_NOTE,
  describeBundleContents,
  previewRedaction,
  type BundleSources,
} from '@audiogubbins/diagnostics';
import {
  Button,
  ButtonTone,
  ModalDialog,
  TextField,
  ToggleSwitch,
} from '@audiogubbins/design-system';

import type { RunCommand } from './settings/section.js';
import { useSettled } from './use-settled.js';

/** Where the preview of the reader's note is, which the field points at. */
const NOTE_PREVIEW_ID = 'ag-export-note-preview';

/** What the dialogue needs. */
export interface DiagnosticExportDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;

  /** What a report would be built from now, with the notes the user has typed. */
  readonly sourcesFor: (notes: string) => BundleSources;

  readonly run: RunCommand;
}

/** Every category a user can switch on or off, in the order they are listed. */
const CHOOSABLE: readonly BundleContentKey[] = Object.values(BundleContentKey).filter(
  // The notes are included by typing them, not by a switch: a switch for text
  // that does not exist would offer the user a choice about nothing.
  (key) => key !== BundleContentKey.ReproductionNotes,
);

/** The dialogue. */
export function DiagnosticExportDialog({
  open,
  onOpenChange,
  sourcesFor,
  run,
}: DiagnosticExportDialogProps): ReactNode {
  const [include, setInclude] = useState<ReadonlySet<BundleContentKey>>(DEFAULT_BUNDLE_CONTENTS);
  const [notes, setNotes] = useState('');
  const [keepFileNames, setKeepFileNames] = useState(false);

  // Read on every render rather than remembered, so the counts follow the log
  // as it grows while the dialogue is open: the list is what the user is
  // agreeing to. It is cheap, because the log hands out a stable snapshot.
  const sources = sourcesFor(notes);

  const selection = useMemo(() => {
    const chosen = new Set(include);
    if (notes.trim() !== '') chosen.add(BundleContentKey.ReproductionNotes);
    return chosen;
  }, [include, notes]);

  // Described with the redaction the report will be built under, so the Logs
  // label says what is really true of it: with file names kept, the logs carry
  // `<path>/take.wav`, and described without it, one sentence would say paths
  // had been removed either way, while the bundle's `contents` field calls
  // itself the words the user was shown.
  const redaction = useMemo(() => ({ keepFileNames }), [keepFileNames]);
  const contents = describeBundleContents(sources, { include: selection, redaction });

  /**
   * What the note will read as in the report, shown only where redaction
   * changed it.
   *
   * Unchanged text says nothing worth a line. Changed text is the whole point:
   * `Reproduced on Firefox 141: save as demo.aup3, reload` is carried as
   * `Reproduced on Firefox 141: <file>, reload`, and without this nothing would
   * tell the reader so.
   */
  const redacted = useMemo(() => previewRedaction(notes, redaction), [notes, redaction]);
  const redactedNotes = notes.trim() !== '' && redacted.text !== notes ? redacted.text : undefined;

  /**
   * What is said about the redaction, as against what is shown of it.
   *
   * Bounded to a sentence. The preview is the reader's whole note, up to four
   * thousand characters: read out atomically it is some seven hundred words,
   * three and a half minutes of speech, said again at every pause in typing
   * and again each time the field takes focus. What a reader needs said is
   * that something was removed and where to read it.
   *
   * An empty string rather than `undefined` for "nothing to say". The wait
   * below answers whether anything has settled as a separate fact, so the two
   * could be told apart either way; one meaning for one value is what a reader
   * of this line needs.
   */
  const said =
    redactedNotes === undefined
      ? ''
      : `Your note will be carried with ${redacted.removed === 1 ? 'one part' : `${String(redacted.removed)} parts`} removed. What it will read as is shown below it.`;

  // Said once the typing stops. The preview appears, changes and goes as the
  // reader types, and a polite region reading each of those in turn would queue
  // them all, as the palette's result count would without the same wait.
  const settledSaid = useSettled(said);

  /** The label a category is shown with, as the report itself will describe it. */
  const labelOf = (key: BundleContentKey): string =>
    describeBundleContents(sources, { include: new Set([key]), redaction })[0]?.label ?? key;

  return (
    <ModalDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Export a diagnostic report"
      description="Choose what the report contains. It is saved as a file on this machine and is not sent anywhere."
      actions={
        <>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            tone={ButtonTone.Primary}
            disabled={contents.length === 0}
            onClick={() => {
              run('help.export-diagnostics', {
                include: [...selection].join(','),
                notes,
                keepFileNames,
              });
            }}
          >
            Save the report
          </Button>
        </>
      }
    >
      <div className="ag-settings-section">
        {CHOOSABLE.map((key) => (
          <ToggleSwitch
            key={key}
            label={labelOf(key)}
            checked={include.has(key)}
            onCheckedChange={(on) => {
              setInclude((current) => {
                const next = new Set(current);
                if (on) next.add(key);
                else next.delete(key);
                return next;
              });
            }}
          />
        ))}

        <TextField
          label="What were you doing when it happened?"
          // Short, because a field's description is read in full each time the
          // field takes focus. What the redaction did belongs in the preview
          // below, which the field points at rather than describing.
          description="Optional. A file name or a path is removed, along with the words beside it."
          describedBy={NOTE_PREVIEW_ID}
          value={notes}
          maxLength={LONGEST_NOTE}
          onValueChange={setNotes}
        />

        {/*
          Tied to the field rather than left beside it. A description saying
          "what the report will carry is shown below" would leave a reader who
          cannot see the page no way below: no identifier, nothing describing
          the field, and nothing announcing the preview appearing, changing or
          going as they type. Polite and settled, so it is said once the typing
          stops rather than after every character.

          A sentence, not the note. Holding the note itself, this region would
          read the reader's own four thousand characters back to them atomically
          at every pause in typing, and the field's description would read them
          again at every return of focus.
        */}
        <p
          className="ag-settings-note"
          data-ag-status="reduced"
          id={NOTE_PREVIEW_ID}
          aria-live="polite"
          aria-atomic="true"
        >
          {settledSaid.value ?? ''}
        </p>

        {/* The note itself, shown rather than said, where the sentence above
            says it is. */}
        {redactedNotes !== undefined && (
          <p className="ag-settings-note" data-ag-status="reduced">
            {`Your note will be carried as: ${redactedNotes}`}
          </p>
        )}

        <ToggleSwitch
          label="Keep file names"
          description="Off unless you choose it. Folder names are always removed; this keeps the last part of a path, which can itself say more than you meant it to."
          checked={keepFileNames}
          onCheckedChange={setKeepFileNames}
        />

        <section aria-label="What the report will contain" className="ag-export-preview">
          <h3 className="ag-panel-title">What the report will contain</h3>
          {contents.length === 0 ? (
            <p>Nothing. Switch something on to make a report.</p>
          ) : (
            <ul>
              {contents.map((entry) => (
                <li key={entry.key}>
                  {entry.itemCount === undefined
                    ? entry.label
                    : `${entry.label} (${String(entry.itemCount)})`}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </ModalDialog>
  );
}
