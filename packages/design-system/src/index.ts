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

export {
  type CategoryPalette,
  type MeterPalette,
  type Palette,
  type SelectionPalette,
  type SpectrogramRamp,
  type WaveformPalette,
} from './tokens/palette.js';

export {
  type ControlScale,
  type Metrics,
  type MotionScale,
  type RadiusScale,
  type SpacingScale,
  type TypographyScale,
} from './tokens/scale.js';

export { type Theme, resolveTheme } from './tokens/theme.js';

export {
  type SystemAppearanceSource,
  ThemeProvider,
  type ThemeProviderProps,
  fixedSystemAppearance,
  useTheme,
} from './theme/theme-provider.js';

export { Button, type ButtonProps, ButtonTone } from './primitives/button.js';

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

export {
  MenuBar,
  type MenuBarProps,
  MenuBarMenu,
  type MenuBarMenuProps,
} from './primitives/menu-bar.js';

// `ControlBarItem` is the toolbar primitive's slot for a control other than a
// button, which WU-01.B's toolbar needs as much as its buttons.
export {
  ControlBar,
  ControlBarButton,
  type ControlBarButtonProps,
  ControlBarItem,
  OptionSelect,
  type OptionSelectProps,
  type SelectOption,
  type TabDescriptor,
  TabSet,
  type TabSetProps,
  TextField,
  type TextFieldProps,
  ToggleSwitch,
  type ToggleSwitchProps,
  ValueSlider,
  type ValueSliderProps,
  VisuallyHidden,
} from './primitives/controls.js';
