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
  TextField,
  type TextFieldProps,
  ToggleSwitch,
  type ToggleSwitchProps,
  VisuallyHidden,
} from './primitives/controls.js';

export { type SliderScale, ValueSlider, type ValueSliderProps } from './primitives/value-slider.js';

// ds-chrome: the chrome around content. Tabs, the panel and its header,
// sections, property grids, lists, tables, badges and chips, the empty,
// loading and error states, notices and banners.
export { type TabDescriptor, TabSet, type TabSetProps } from './primitives/chrome/tab-set.js';
export { Panel, type PanelProps } from './primitives/chrome/panel.js';
export { PanelHeader, type PanelHeaderProps } from './primitives/chrome/panel-header.js';
export { Section, type SectionProps } from './primitives/chrome/section.js';
export {
  PropertyGrid,
  type PropertyGridProps,
  type PropertyRow,
} from './primitives/chrome/property-grid.js';
export { SourceChip, type SourceChipProps, ValueSource } from './primitives/chrome/source-chip.js';
export { List, type ListProps, ListRow, type ListRowProps } from './primitives/chrome/list.js';
export {
  Table,
  type TableColumn,
  type TableProps,
  type TableRow,
} from './primitives/chrome/table.js';
export { Verdict, VerdictKind, type VerdictProps } from './primitives/chrome/verdict.js';
export { Badge, type BadgeProps, BadgeTone } from './primitives/chrome/badge.js';
export { StatusChip, type StatusChipProps, StatusTone } from './primitives/chrome/status-chip.js';
export { KeyCap, type KeyCapProps } from './primitives/chrome/key-cap.js';
export {
  EmptyState,
  type EmptyStateProps,
  PanelStateTone,
} from './primitives/chrome/empty-state.js';
export { Skeleton, type SkeletonProps } from './primitives/chrome/skeleton.js';
export { Spinner, type SpinnerProps } from './primitives/chrome/spinner.js';
export {
  ProgressBar,
  type ProgressBarProps,
  ProgressPlace,
} from './primitives/chrome/progress-bar.js';
export { Notice, type NoticeProps, NoticeTone } from './primitives/chrome/notice.js';
export { Banner, type BannerProps, BannerTone } from './primitives/chrome/banner.js';
