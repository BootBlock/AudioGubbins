/**
 * What the shortcut editor says about the bindings of the profile in force:
 * the combinations that run more than one command, the bindings the browser or
 * the system takes on this keyboard, and the defaults that wait for a key.
 *
 * Each is said beside the table, where the binding can be changed, and each is
 * nothing while there is nothing to say.
 */

import { useEffect, useState, type ReactNode } from 'react';

import {
  commandLayerKeyAsked,
  describeShortcut,
  shortcutKey,
  type CommandId,
  type KeyboardConvention,
  type ShortcutConflict,
} from '@audiogubbins/commands';
import { VisuallyHidden } from '@audiogubbins/design-system';
import {
  characterName,
  commandLayerKeys,
  type KeyboardLayout,
  type TypedKey,
} from '@audiogubbins/input';

import type { ReservedBinding, WaitingDefault } from '../../state/shortcut-layout.js';
import { useSettled, type Settled } from '../use-settled.js';

/**
 * What is said and shown once nothing is waiting.
 *
 * One sentence read by both. Written out in each, the live region and the note
 * a sighted reader sees would say the same words by coincidence, and rewording
 * one would leave the two readers of one state reading different sentences.
 */
const NOTHING_WAITING = 'Every default shortcut now has a key on your keyboard.';

/** How much is still waiting, as a live region says it. */
function progressOf(waiting: Settled<number>): string {
  if (!waiting.settled) return '';
  if (waiting.value === 0) return NOTHING_WAITING;
  return waiting.value === 1
    ? '1 default shortcut still waiting.'
    : `${String(waiting.value)} default shortcuts still waiting.`;
}

/** The combinations that run more than one command, or nothing when there are none. */
export function ConflictList(props: {
  readonly conflicts: readonly ShortcutConflict[];
  readonly convention: KeyboardConvention;
  readonly layout: KeyboardLayout;
  readonly labelFor: (id: CommandId) => string;
}): ReactNode {
  const { conflicts, convention, layout, labelFor } = props;
  if (conflicts.length === 0) return null;

  return (
    <div className="ag-shortcut-notes" role="group" aria-label="Conflicts">
      <p className="ag-settings-note" data-ag-status="unavailable">
        {`${String(conflicts.length)} ${conflicts.length === 1 ? 'shortcut runs' : 'shortcuts run'} more than one command, so only one of them will ever run.`}
      </p>
      <ul>
        {conflicts.map((conflict) => (
          <li key={conflict.commandIds.join('|')}>
            {`${describeShortcut(conflict.shortcut, convention, layout)}: ${conflict.commandIds.map(labelFor).join(', ')}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The bindings the platform takes on the keyboard layout as it is known, or
 * nothing when there are none. Said here, where they can be changed: the layout
 * is learned as the user types, and a binding made before it was known can be
 * one the browser takes.
 */
export function ReservedList(props: {
  readonly reserved: readonly ReservedBinding[];
  readonly labelFor: (id: CommandId) => string;
}): ReactNode {
  const { reserved, labelFor } = props;
  if (reserved.length === 0) return null;

  return (
    <div className="ag-shortcut-notes" role="group" aria-label="Left to the browser or the system">
      <p className="ag-settings-note" data-ag-status="unavailable">
        {`On this keyboard, ${String(reserved.length)} ${reserved.length === 1 ? 'shortcut is one' : 'shortcuts are ones'} that a browser or the system may take before the page sees ${reserved.length === 1 ? 'it' : 'them'}, or that ${reserved.length === 1 ? 'is' : 'are'} left to the browser because you may rely on ${reserved.length === 1 ? 'it' : 'them'} there. AudioGubbins does not answer ${reserved.length === 1 ? 'it' : 'them'} on any browser. Change ${reserved.length === 1 ? 'it' : 'them'} below.`}
      </p>
      <ul>
        {reserved.map((one) => (
          // Keyed by the command and the shortcut: one command can have two
          // bindings the browser takes, which an imported file can carry, and
          // keyed by the command alone the two rows would share a key.
          <li key={`${one.commandId}:${shortcutKey(one.shortcut)}`}>
            {`${labelFor(one.commandId)} — ${one.reason}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** How a character a default waits for is named, by the key-naming rule. */
function inQuotes(character: string): string {
  return `"${characterName(character)}"`;
}

/**
 * The defaults that have no key yet, or nothing when there are none. Said here,
 * beside the commands they belong to: unsaid, a default whose character's key
 * the layout has not shown would be missing from the menus and from this table
 * with no reason, and would come back only once the user happened to type the
 * character.
 */
export function WaitingList(props: {
  readonly waiting: readonly WaitingDefault[];
  readonly labelFor: (id: CommandId) => string;

  /**
   * What the keyboard is known to type, which decides the key that ends the
   * wait for a Command press ({@link CommandLayerWanted}).
   */
  readonly layout: KeyboardLayout;

  /**
   * Which platform's conventions are in force, which decides whether a press
   * the layout can be read from is a press the page ever receives.
   */
  readonly convention: KeyboardConvention;

  /**
   * Why the layout is not known already, when it is not: what the capability
   * registry says about the browser's layout map.
   */
  readonly layoutMapReason?: string;

  /**
   * Names the key a Command press is asked on now, by its code, or that none
   * is, so the keyboard keeps the browser from acting on that press while it
   * is asked and on no other occasion.
   */
  readonly askFor: (code: string | undefined) => void;
}): ReactNode {
  const { waiting, labelFor, layout, convention, layoutMapReason, askFor } = props;

  // Whether anything has ever waited, so the last default placed is announced
  // rather than leaving the live region without a word. Removing text from a
  // live region says nothing: without this, a screen-reader user who pressed
  // the key they were asked for would hear nothing at all.
  const [everWaited, setEverWaited] = useState(false);

  // Said once the presses stop, so a reader pressing the keys they were asked
  // for is not read a sentence between each one.
  const progress = progressOf(useSettled(waiting.length));

  if (waiting.length > 0 && !everWaited) setEverWaited(true);
  if (!everWaited && waiting.length === 0) return null;

  // The two reasons a default has no key are said apart, because a different
  // press settles each: a key typed on its own, or any key pressed with
  // Command. A default can be in both lists, waiting for a key it needs and
  // for the reading of another.
  const forAKey = waiting.filter((each) => each.characters.length > 0);
  const forTheLayer = waiting.filter((each) => each.waitsForCommandLayer);

  return (
    <div className="ag-shortcut-notes" role="group" aria-label="Waiting for your keyboard">
      {/*
        What changed, and only that. Were the region the wrapper around both
        lists, each key the reader pressed would change a count, a paragraph and
        a row, and the whole fifty-five-word instruction would be read again
        before they could press the next one. The instruction is here to be read
        once; the progress is what a live region is for, said once the presses
        stop (WCAG 4.1.3).
      */}
      <VisuallyHidden>
        <span aria-live="polite" aria-atomic="true">
          {progress}
        </span>
      </VisuallyHidden>

      {waiting.length === 0 ? (
        <p className="ag-settings-note">{NOTHING_WAITING}</p>
      ) : (
        <>
          <KeysWanted waiting={forAKey} labelFor={labelFor} layoutMapReason={layoutMapReason} />
          <CommandLayerWanted
            waiting={forTheLayer}
            labelFor={labelFor}
            layout={layout}
            convention={convention}
            askFor={askFor}
          />
        </>
      )}
    </div>
  );
}

/** The defaults waiting for a key the layout has not shown, named by that key. */
function KeysWanted(props: {
  readonly waiting: readonly WaitingDefault[];
  readonly labelFor: (id: CommandId) => string;
  readonly layoutMapReason: string | undefined;
}): ReactNode {
  const { waiting, labelFor, layoutMapReason } = props;
  if (waiting.length === 0) return null;
  const one = waiting.length === 1;

  // Each key the list names, once, with every default that waits for it. The
  // instruction is about keys: one default can wait for two characters, and
  // several can wait for one. Counted by the defaults, the sentence would ask a
  // user waiting for two keys for one; counted by each mention, nine defaults
  // waiting for K would ask for each key, and the list would name K nine times,
  // which a screen reader reads out row by row.
  const byKey = new Map<string, string[]>();
  for (const each of waiting) {
    for (const character of each.characters) {
      byKey.set(character, [...(byKey.get(character) ?? []), labelFor(each.commandId)]);
    }
  }
  const oneKey = byKey.size === 1;

  return (
    <>
      <p className="ag-settings-note">
        {`${one ? 'One default shortcut has' : `${String(waiting.length)} default shortcuts have`} no key yet: AudioGubbins has not seen where your keyboard types ${one ? 'its' : 'their'} ${oneKey ? 'character' : 'characters'}. Press ${oneKey ? 'the key' : 'each key'} named below once on its own, with Caps Lock off, anywhere in AudioGubbins, and ${one ? 'it is' : 'they are'} placed.`}
        {layoutMapReason === undefined ? '' : ` ${layoutMapReason}`}
      </p>
      <ul>
        {[...byKey].map(([character, labels]) => (
          <li
            key={character}
          >{`The key that types ${inQuotes(character)}: ${labels.join(', ')}`}</li>
        ))}
      </ul>
    </>
  );
}

/**
 * What the reader is asked to press, or why nothing can be asked of them and
 * what they can do instead.
 *
 * Read is not delivered. The layout answers which of the reader's keys a
 * Command press can be read from; whether such a press ever reaches the page at
 * all is the platform's answer. Named by the layout's order alone, the note
 * would ask an AZERTY reader to hold Command and press the key that types "a",
 * which is where a US keyboard has Q and macOS quits the browser, and a Dvorak
 * reader for the key that opens a browser window. Either reader would lose the
 * page and settle nothing.
 *
 * Where no key is left there is still somewhere to go: the table below this
 * note is where a binding can be set by hand, which is true whether the layout
 * has shown no such key yet or the platform may take every one of them. May:
 * each is taken under one reading of the layout, and which reading is in force
 * is what the press would have shown, so the sentence says no more.
 */
function pressAsked(anyCandidate: boolean, settles: TypedKey | undefined): string {
  if (settles !== undefined) {
    return `Hold Command and press the key that types ${inQuotes(settles[1])} once, with Caps Lock off, while this note is on screen.`;
  }

  if (!anyCandidate) {
    return 'AudioGubbins has not seen a key of yours that can show it: it has to be a letter key your layout moved from where a US keyboard has it. Keep typing with Caps Lock off, and if your keyboard has one it is named here. You can also set these shortcuts yourself in the table below.';
  }

  return 'Every key of yours that could show it may be one your browser or your system takes before AudioGubbins sees it, so there is no press to ask you for. Set these shortcuts yourself in the table below.';
}

/**
 * The defaults waiting for a press made with Command, named one by one.
 *
 * A key is not what these wait for: the key that types their character is
 * known, and which of two layers the system reads a Command press by is not
 * ({@link WaitingDefault.waitsForCommandLayer}). Asked for the key and giving
 * it, a user would see nothing happen and have no way on.
 *
 * The press has to be on a key that can tell the two layers apart: a letter
 * key, typing a letter, which a US layout types somewhere else, with Caps Lock
 * off and no other modifier. Which of the reader's keys those are is the
 * layout's to answer and not the waiting defaults': one press settles every one
 * of them at once, and a default's own character need not sit on such a key at
 * all. Named from the characters the defaults wait on, the note would ask an
 * Apple reader for the key that types a comma, and a comma is not a letter, so
 * they would press it and nothing would happen — the fault this note exists to
 * cure, by another route.
 */
function CommandLayerWanted(props: {
  readonly waiting: readonly WaitingDefault[];
  readonly labelFor: (id: CommandId) => string;
  readonly layout: KeyboardLayout;
  readonly convention: KeyboardConvention;
  readonly askFor: (code: string | undefined) => void;
}): ReactNode {
  const { waiting, labelFor, layout, convention, askFor } = props;

  // The press that ends every wait here, or why none can be asked for. Saying
  // nothing would leave the sentence without its ending; naming a key by the
  // layout's order alone would name one the platform takes before the page,
  // which is worse than saying nothing.
  const candidates = commandLayerKeys(layout);
  const settles = waiting.length === 0 ? undefined : commandLayerKeyAsked(layout, convention);

  // Asked for while this is on screen and names a key, and on no other
  // occasion: the keyboard keeps the browser from acting on the press only
  // then.
  const named = settles?.[0];
  useEffect(() => {
    if (named === undefined) return undefined;
    askFor(named);
    return () => {
      askFor(undefined);
    };
  }, [named, askFor]);

  if (waiting.length === 0) return null;
  const one = waiting.length === 1;
  const press = pressAsked(candidates.length > 0, settles);

  return (
    <>
      <p className="ag-settings-note">
        {`${one ? 'One default shortcut waits' : `${String(waiting.length)} default shortcuts wait`} for a press made with Command. Some keyboards type another layout while Command is held, and until one press shows whether yours does, there is no key ${one ? 'it' : 'they'} can safely go on. ${press}`}
      </p>
      <ul>
        {waiting.map((each) => (
          <li key={each.commandId}>{labelFor(each.commandId)}</li>
        ))}
      </ul>
    </>
  );
}
