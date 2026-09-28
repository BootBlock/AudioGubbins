/**
 * Recording a key combination for a command.
 *
 * REQ-UX-066 requires full remapping, including multi-key chords. The recorder
 * takes presses in order while it is listening, so a chord is typed the way it
 * will be used. Escape stops listening rather than cancelling, because every
 * other key - Enter and Tab included - has to be recordable: a recorder that
 * committed on Enter could never bind Enter.
 *
 * The presses are taken from the physical key, the same way the shortcut
 * handler reads them, through the one function that turns a keyboard event into
 * a press. A recorder that read the character instead would record a binding
 * the handler could never match on another layout.
 */

import { useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';

import {
  describeReservation,
  describeShortcut,
  keyboardPlatformFor,
  platformReservation,
  shortcutKey,
  type KeyboardConvention,
  type Shortcut,
} from '@audiogubbins/commands';
import {
  isShortcutPress,
  keyPressFromEvent,
  readingOf,
  type KeyEventReading,
  type KeyPress,
  type KeyboardLayout,
} from '@audiogubbins/input';
import { Button, ButtonTone } from '@audiogubbins/design-system';

import { ReasonedButton } from './reasoned-button.js';

/** How many presses a recorded chord may have. */
const MAXIMUM_PRESSES = 3;

/** What the recorder needs. */
export interface ShortcutRecorderProps {
  /** What the command is called, for the recorder's own label. */
  readonly commandLabel: string;

  readonly convention: KeyboardConvention;

  /** What the user's keyboard layout types, which the labels and the reservations read. */
  readonly layout: KeyboardLayout;

  /**
   * Teaches the layout what a press shows. The recorder takes each press from
   * the page, so the listener that learns every other press never sees these.
   */
  readonly learnKey: (reading: KeyEventReading) => void;

  /** Keeps the recorded shortcut, written the way `shortcutKey` writes one. */
  readonly onSave: (written: string) => void;

  readonly onCancel: () => void;
}

/**
 * Why Save cannot run yet, or `undefined` when it can.
 *
 * Said rather than only refused: the button stays in the tab order, so a
 * keyboard user who reaches it is told what to do instead of finding it does
 * nothing.
 */
function whySaveCannotRun(
  recorded: Shortcut | undefined,
  listening: boolean,
  refusal: string | undefined,
): string | undefined {
  if (recorded === undefined) return 'Press the combination you want first.';
  // Not the help text again. The sentence immediately above Save already says
  // to press Escape when the combination is finished, and Save saying it as its
  // own reason would say it a second time.
  if (listening) return 'The combination is not finished.';
  return refusal;
}

/** Records a key combination. */
export function ShortcutRecorder({
  commandLabel,
  convention,
  layout,
  learnKey,
  onSave,
  onCancel,
}: ShortcutRecorderProps): ReactNode {
  const [presses, setPresses] = useState<readonly KeyPress[]>([]);
  const [listening, setListening] = useState(true);

  const [first, ...rest] = presses;
  const recorded = first === undefined ? undefined : { presses: [first, ...rest] as const };

  // Every press is checked, the second of a chord as much as the first, and
  // the refusal names what takes the press, in the same words `rebind` uses.
  const reservation =
    recorded === undefined ? undefined : platformReservation(recorded, convention, layout);
  const refusal =
    reservation === undefined ? undefined : describeReservation(reservation, convention, layout);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!listening) return;
    // The same answer the shortcut listener asks for, so a press that cannot
    // be part of a shortcut cannot be recorded as one either.
    const reading = readingOf(event.nativeEvent, keyboardPlatformFor(convention));
    learnKey(reading);
    if (!isShortcutPress(reading)) return;

    // Taken from the page as well as recorded, or the combination being bound
    // would also run whatever it is currently bound to.
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      setListening(false);
      return;
    }

    const press = keyPressFromEvent(reading);
    setPresses((current) => (current.length >= MAXIMUM_PRESSES ? [press] : [...current, press]));
  };

  return (
    <div className="ag-shortcut-recorder">
      <div
        className="ag-shortcut-recorder-field"
        role="textbox"
        aria-readonly
        aria-label={`Shortcut for ${commandLabel}`}
        // The instruction, and not the live text below it. A live region is
        // announced when it changes, so naming it here would have the refusal
        // read again on every return of focus to the field, and again by Save,
        // which carries the platform's reason itself: three readings of one
        // sentence. What the field holds is its own text, which a `textbox`
        // reads out as its value.
        aria-describedby="ag-shortcut-recorder-help"
        tabIndex={0}
        data-ag-listening={listening ? '' : undefined}
        // Escape stops recording here rather than closing the dialogue.
        data-ag-captures-escape={listening ? '' : undefined}
        // Focused as it appears, because the user asked to change a shortcut
        // and the next thing they will do is press one.
        ref={(element) => {
          if (listening) element?.focus();
        }}
        onKeyDown={onKeyDown}
      >
        {recorded === undefined
          ? listening
            ? 'Press the keys'
            : 'Nothing recorded'
          : describeShortcut(recorded, convention, layout)}
      </div>

      {/*
        What was recorded, and why it cannot be used, said out loud.

        The field's own text changes as the user presses, and a static element's
        text change inside `role="textbox"` is announced by no screen reader:
        without this, a blind user would press a combination and hear nothing
        back, and nothing when it was refused either. This is the same channel
        the rest of the shell uses for a refusal, kept local to the recorder
        because it belongs to the control the user is working in.
      */}
      <p
        id="ag-shortcut-recorder-said"
        className="ag-visually-hidden"
        aria-live="polite"
        // Whole, like every other region in the shell. Read as the part that
        // changed, one refusal replacing another differs in a word or two and a
        // reader would hear that word alone; this is the only place a refusal
        // is spoken, so what is left out is not said anywhere else.
        aria-atomic="true"
      >
        {recorded === undefined
          ? ''
          : (refusal ??
            // Nothing is recorded until Escape stops the recorder: saying
            // "recorded" after the first press of a chord would tell the user
            // it was done while it was still listening for the second.
            (listening
              ? `${describeShortcut(recorded, convention, layout)} so far.`
              : `${describeShortcut(recorded, convention, layout)} recorded. Save it, or record again.`))}
      </p>

      <p id="ag-shortcut-recorder-help" className="ag-settings-note">
        {listening
          ? 'Press the combination, one step at a time for a chord. Press Escape when you have finished.'
          : 'Save it, or record again.'}
      </p>

      {/*
        One visible copy of a refusal at a time. Once the recorder stops, Save
        carries the reason itself and draws it, so the note here would be the
        same sentence twice on screen and a third reading for anyone listening.
        While the recorder is still going, Save's reason is that the
        combination is unfinished, so this is the only place the refusal is
        shown.
      */}
      {refusal !== undefined && listening && (
        <p className="ag-settings-note" data-ag-status="unavailable">
          {refusal}
        </p>
      )}

      <div className="ag-settings-row">
        {/*
          Reachable while it cannot be used, with the reason tied to it, which
          is what `ReasonedButton` is for. Given the native `disabled`, Save
          would leave the tab order whenever a recorded combination was one the
          platform takes, so a keyboard user would tab from the field straight
          past it to Record again with no sign that it was there.
        */}
        <ReasonedButton
          tone={ButtonTone.Primary}
          reason={whySaveCannotRun(recorded, listening, refusal)}
          onPress={() => {
            if (recorded !== undefined) onSave(shortcutKey(recorded));
          }}
        >
          Save
        </ReasonedButton>
        <Button
          onClick={() => {
            setPresses([]);
            setListening(true);
          }}
        >
          Record again
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
