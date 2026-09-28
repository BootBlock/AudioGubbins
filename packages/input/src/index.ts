/**
 * The public contract of AudioGubbins input: mouse, touch, pen and keyboard, as
 * values.
 *
 * WU-01.D asks for one input abstraction over all four devices, and REQ-UX-005
 * makes each of them first-class. The pointer half belongs no more to the
 * design system, which owns presentation, than the keyboard half does to the
 * command layer or the application: it is one model, so it has one package
 * (`ADR-0017`).
 *
 * Nothing here knows the browser. An event is read through the few fields a
 * value is built from, so the package compiles without the browser's type
 * definitions, and the command layer, which binds key presses to commands, can
 * depend on it and stay platform-agnostic.
 */

export {
  type KeyEventReading,
  type KeyEventSource,
  type KeyPress,
  type KeyboardPlatform,
  keyPress,
  isShortcutPress,
  isTypingPress,
  keyPressFromEvent,
  keyPressesMatch,
  readingOf,
} from './keyboard.js';

// What the user's layout types on each key, which a browser takes its own
// shortcuts by, and where a default shortcut written as a character goes.
export {
  type KeyboardLayout,
  type Placement,
  type PressedWith,
  type TypedKey,
  UNKNOWN_LAYOUT,
  browserPressOf,
  characterName,
  commandLayerKeys,
  commandLayerOf,
  couldBeTyped,
  keyNameOn,
  keyboardLayout,
  placeFor,
  typedCharacterOf,
  withLearned,
} from './keyboard-layout.js';

// `sampleFromPointerEvent` is the pointer half of the input abstraction WU-01.D
// requires, the counterpart of `readingOf`: it turns a browser's pointer event
// into a sample. Nothing in this phase draws on a canvas, so it has no caller
// yet; the waveform editor's canvas, Phase 04's, is the first.
export {
  DEFAULT_GESTURE_SETTINGS,
  type Gesture,
  type GestureSettings,
  NO_GESTURE,
  PointerKind,
  type PointerReading,
  type PointerSample,
  recogniseGesture,
  sampleFromPointerEvent,
  toolStrength,
} from './pointer.js';
