/**
 * The public contract of the AudioGubbins design system.
 *
 * This package owns how AudioGubbins looks and how its controls behave. It
 * knows nothing about projects, assets, audio or commands, which is what lets
 * it be themed, tested and reasoned about on its own (REQ-UX-155). The
 * architecture rules reject an import from here into the domain.
 *
 * It is also the only place Radix is imported. A feature that reached for Radix
 * directly would bypass the token system and the accessibility wrappers, and
 * would produce a control that looks right until the theme changes.
 *
 * What is exported is what a consumer uses, the types a used export's signature
 * names, and the primitives WU-01.B requires whether or not a consumer has
 * arrived: the menu, dialogue, popover and toolbar parts. The colour
 * mathematics and the builders the theme is made from are the package's own
 * workings, used through `resolveTheme`, and are not offered past it. Two
 * conversions are: `oklchToHex`, which the page's pre-paint colours are checked
 * against, so the check reads the theme's own arithmetic, and `oklchToSrgb`,
 * which gives the editor's renderer the theme's colours as the channels it
 * draws with.
 */

export {
  type Oklch,
  type ContrastShortfall,
  ContrastRequirement,
  type Srgb,
  contrastRatio,
  oklchToHex,
  oklchToSrgb,
  srgbToOklch,
} from './tokens/colour.js';

export {
  ACCENT_HUES,
  ACCENT_NAMES,
  type AccentName,
  accentLabel,
  BRIGHTNESS_RANGE,
  ContrastLevel,
  DEFAULT_THEME_PREFERENCES,
  Density,
  MotionLevel,
  type SystemAppearance,
  ThemeMode,
  type ThemePreferences,
  UNKNOWN_SYSTEM_APPEARANCE,
  clampBrightness,
  isAccentName,
} from './tokens/preferences.js';

export { type ChromePalette } from './tokens/chrome.js';

export { type ElevationPalette } from './tokens/elevation.js';

export {
  type HardwareMaterials,
  type HardwarePalette,
  type HardwareRamps,
} from './tokens/hardware.js';

export {
  type AnalysisPalette,
  type CategoryPalette,
  type MarkerPalette,
  type MeterPalette,
  type Palette,
  type SelectionPalette,
  type SpectrogramRamp,
  type WaveformPalette,
} from './tokens/palette.js';

export {
  type ControlScale,
  type DisplayScale,
  type FocusScale,
  type GridScale,
  type HardwareScale,
  type IconScale,
  type Metrics,
  type RadiusScale,
  type ShellScale,
  type SpacingScale,
  type StateScale,
  type StatusBarScale,
  type TypographyScale,
} from './tokens/scale.js';

export {
  type EntryScale,
  type LoopScale,
  type MeterBallistics,
  type MotionScale,
  type TravelScale,
} from './tokens/motion.js';

export {
  type FontFamilies,
  type FontWeights,
  type LineHeights,
  type Tracking,
  type Typeface,
} from './tokens/typeface.js';

export { type Theme, resolveTheme } from './tokens/theme.js';

export {
  type SystemAppearanceSource,
  ThemeProvider,
  type ThemeProviderProps,
  fixedSystemAppearance,
  useTheme,
} from './theme/theme-provider.js';

export { Button, type ButtonProps, ButtonTone } from './primitives/button.js';

// Every icon is drawn by `Icon` and named in the vocabulary's own words
// (ADR-0108), so the icon set is reached through the design system alone.
export { Icon, IconSize, type IconProps } from './icons/icon.js';
export { type IconName } from './icons/vocabulary.js';

// The menu, dialogue and popover primitives WU-01.B requires. `Menu` opens from
// a control and `ContextActions` from a right click or a long press, which
// REQ-UX-067 names as the context action of an editing canvas; the first canvas
// is Phase 04's. `InfoPopover` is the popover the same work unit names, for the
// explanation a later panel attaches to one of its controls.
export {
  ContextActions,
  type ContextActionsOpener,
  type ContextMenuProps,
  HintProvider,
  InfoPopover,
  type InfoPopoverProps,
  Menu,
  type MenuGroup,
  type MenuItemDescriptor,
  ModalDialog,
  type ModalDialogProps,
} from './primitives/overlays.js';

export {
  type LiveAnnouncement,
  NoticeProvider,
  type NoticeProviderProps,
  NoticeSurface,
  type NoticeSurfaceProps,
} from './primitives/announcement.js';

// An element's own height, written where a rule positioning another surface
// against it can read it.
export { usePublishedBlockSize } from './primitives/published-size.js';

export { WINDOW_ROW, useRowWindow } from './primitives/row-window.js';

export {
  MenuBar,
  type MenuBarProps,
  MenuBarMenu,
  type MenuBarMenuProps,
} from './primitives/menu-bar.js';

export {
  OptionSelect,
  type OptionSelectProps,
  type SelectOption,
  type TabDescriptor,
  TabSet,
  type TabSetProps,
  TextField,
  type TextFieldProps,
  VisuallyHidden,
} from './primitives/controls.js';


// Buttons: the controls a user presses or turns over. `ControlBarItem` is the
// toolbar's slot for a control other than its own button, which a toolbar
// needs as much as its buttons. The hardware controls (the switch, the radio's
// panel lamp, the power switch and the record lamp) draw the design language's
// hardware, and every control opens its reason on hover or focus while it
// cannot be used (ADR-0013).
export {
  ControlBar,
  ControlBarButton,
  type ControlBarButtonProps,
  ControlBarItem,
  type ControlBarProps,
  ControlBarSeparator,
} from './primitives/buttons/control-bar.js';
export { IconButton, type IconButtonProps } from './primitives/buttons/icon-button.js';
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedOption,
  SegmentedVariant,
} from './primitives/buttons/segmented-control.js';
export { ToggleSwitch, type ToggleSwitchProps } from './primitives/buttons/toggle-switch.js';
export { Check, type CheckProps } from './primitives/buttons/check.js';
export {
  RadioGroup,
  type RadioGroupProps,
  type RadioOption,
} from './primitives/buttons/radio-group.js';
export { PowerSwitch, type PowerSwitchProps } from './primitives/buttons/power-switch.js';
export { RecordButton, type RecordButtonProps } from './primitives/buttons/record-button.js';
// ds-dials: the dials and the meters. The slider, the knob and the fader take
// one taper, a `SliderScale`, from the panel that owns the value; the meters
// take the engine's readings and apply the theme's ballistics, on a clock a
// test or the inventory can hold.
export { ValueSlider, type ValueSliderProps } from './primitives/value-slider.js';
export { type SliderScale } from './primitives/dials/value-travel.js';
export { type DialTyping } from './primitives/dials/typed-value-field.js';
export { Knob, type KnobProps } from './primitives/dials/knob.js';
export { Fader, type FaderMark, type FaderProps } from './primitives/dials/fader.js';
export {
  LevelMeter,
  type LevelMeterProps,
  type MeterChannel,
  type MeterMark,
  MeterOrientation,
  type MeterScale,
} from './primitives/dials/level-meter.js';
export {
  CorrelationMeter,
  type CorrelationMeterProps,
} from './primitives/dials/correlation-meter.js';
export { type FrameClock } from './primitives/dials/frame-clock.js';
