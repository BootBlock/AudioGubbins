# The AudioGubbins design language

`DesignLanguage`, the written design language of `REQ-UX-221` and the motion system of
`REQ-UX-222`, for Phase 16. It states every rule the product owner set in
[visual-references.md](visual-references.md) and every value of the approved mock-ups, each named
by the token that carries it.

Written by WU-16.A on 2026-10-17 from the approved references of 2026-10-16 and 2026-10-17.
`visual-references.md` keeps the record of each decision; this document states the language those
decisions make, and a later decision changes both.

## How to read this document

- A value is named by its CSS custom property. The theme writes every property onto the theme root
  and the document element (`applyTheme`, `REQ-UX-155`), and a component reads it with `var()`.
- A token that exists today in `packages/design-system/src/tokens` is written plainly. A token this
  language needs and the design system lacks is listed in the **New tokens** table of its section,
  so WU-16.B adds exactly those. An existing token whose value the language changes is listed in a
  **Changed tokens** table. The full count is in [Token summary](#token-summary).
- A value that differs by density is written `comfortable / compact`. A value that differs by
  theme is written `dark / light`.
- Every colour stays inside `ADR-0012`: derived in OKLCH from the base surface lightness, with
  text, borders and accents solved against a contrast target. A translucent fill is a token colour
  with an alpha, computed by the palette, never a literal.
- Names follow the existing convention: `--ag-<group>-<token>`, kebab case, emitted from a camel
  case key (`themeCustomProperties`). New groups are `font`, `icon`, `elevation`, `effect`,
  `hardware` and `ballistics`; every other new token joins an existing group.

## 1. Layout grid

### The base unit

The base unit is **2 px** (`--ag-grid-unit`). Every control height, inset, gutter, radius, icon
size and panel dimension is a multiple of it, at both densities.

Three things are exempt, because they are not boxes laid out on the page:

- A hairline: a 1 px border, separator or lit edge.
- The optical padding inside a text chip (a badge, a key cap, a tag, a source chip, a tooltip),
  which centres one line of text and is stated with the chip.
- Geometry drawn inside a glyph, a hardware control or a canvas, which follows its own grid (the
  icon's 24-unit grid, a knob's 48-unit view box).

### The structural rhythm: the inset

Panels are composed in insets, not in arbitrary gaps.

| Rule                                                                           | Token                      | Value         |
| ------------------------------------------------------------------------------ | -------------------------- | ------------- |
| A container insets its content by one value on every side                      | `--ag-space-inset`         | 8 px / 6 px   |
| Panels sit apart by the gutter                                                 | `--ag-space-gutter`        | 8 px / 6 px   |
| A leading padding that clears an edge bar or a glyph (notice, banner, popover) | `--ag-space-inset-leading` | 12 px / 10 px |
| A wide inset (a dialogue's body and footer, the command palette's field)       | `--ag-space-inset-wide`    | 16 px / 12 px |
| A feature inset (a failure card, the focus specimen row)                       | `--ag-space-inset-feature` | 24 px / 18 px |

The inset rule (owner's finding, 2026-10-16): one inset per container on every side, so a tab sits
as far from its panel's top as from its left. Corners nest: a container's radius is its content's
radius plus its inset (see [Radius](#radius)).

### Alignment

- Every piece of content in a panel aligns to the panel's inset: the tab strip, the toolbar, each
  section, the editing surface and the overview all start one inset from the panel's edge, and the
  same inset separates them vertically.
- A panel header's actions are full-size targets (`--ag-control-height` square), so their ink sits
  as far from the panel's side as from its top.
- A glyph is centred in its button by its ink, not its box (see [Icons](#4-icons)).
- In a property grid, labels share one column edge and values share the trailing edge.
- The compact density is its own layout, not a scaled copy (`REQ-UX-071` clause 71.1): one top bar
  carries the menus and the transport, the project moves to the status bar, search collapses to its
  icon and shortcut, list rows become one line, and readouts drop their captions into hints.

### Shell dimensions

| Region                                   | Token                               | Value         |
| ---------------------------------------- | ----------------------------------- | ------------- |
| Control height                           | `--ag-control-height`               | 28 px / 24 px |
| Top bar (control height plus two insets) | `--ag-shell-top-bar-block-size`     | 44 px / 36 px |
| Transport bar                            | `--ag-shell-transport-block-size`   | 56 px / 46 px |
| Status bar (the strip)                   | `--ag-status-bar-block-size`        | 34 px / 30 px |
| A two-line list row                      | `--ag-control-row-height`           | 44 px / 36 px |
| Smallest pointer target                  | `--ag-control-minimum-touch-target` | 44 px / 44 px |

`--ag-status-bar-block-size` exists in `apps/web`; it moves into the design system's metrics.

### Values snapped to the grid

The mock-ups hold four values off the 2 px unit. Each takes the nearest grid value when it becomes
a token: the compact leading padding (9 px to 10 px), the tab's icon-to-label gap (7 px to 8 px),
the menu bar trigger's inline padding (9 px to 10 px), and the compact switch's height (19 px to
20 px).

### New tokens

| Token                             | Value         | Carries                                            |
| --------------------------------- | ------------- | -------------------------------------------------- |
| `--ag-grid-unit`                  | 2 px          | The base unit                                      |
| `--ag-space-inset`                | 8 px / 6 px   | One inset per container                            |
| `--ag-space-gutter`               | 8 px / 6 px   | The gap between panels and between splitter halves |
| `--ag-space-inset-leading`        | 12 px / 10 px | Leading padding past an edge bar or glyph          |
| `--ag-space-inset-wide`           | 16 px / 12 px | A dialogue's body and footer inset                 |
| `--ag-space-inset-feature`        | 24 px / 18 px | A failure card's inset                             |
| `--ag-shell-top-bar-block-size`   | 44 px / 36 px | The top bar                                        |
| `--ag-shell-transport-block-size` | 56 px / 46 px | The transport bar                                  |
| `--ag-control-row-height`         | 44 px / 36 px | A two-line list row                                |

### Changed tokens

| Token                         | Today             | Language                                                                                                   |
| ----------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `--ag-control-height`         | 32 px / 26 px     | 28 px / 24 px                                                                                              |
| `--ag-control-compact-height` | 28 px / 24 px     | Retired: every control is `--ag-control-height`; smaller variants are stated as `calc()` of it per control |
| `--ag-status-bar-block-size`  | Set in `apps/web` | 34 px / 30 px, emitted by the design system                                                                |

## 2. Type scale

### Families

`ADR-0108`: Inter for every word, JetBrains Mono for every time, level and frequency readout, both
self-hosted variable fonts reached only through `@audiogubbins/design-system`.

| Token                | Value                                                                       |
| -------------------- | --------------------------------------------------------------------------- |
| `--ag-font-ui`       | `'Inter Variable', system-ui, sans-serif`                                   |
| `--ag-font-numeric`  | `'JetBrains Mono Variable', ui-monospace, monospace`                        |
| `--ag-font-features` | `'cv11', 'ss01'` (Inter's single-storey a and open digits), set on the body |

The body rule in `tokens.css` sets a system stack today; it takes `--ag-font-ui` and
`--ag-font-features`. Text is antialiased (`-webkit-font-smoothing: antialiased`).

### Roles

| Role            | Used for                                                                                                                                             | Size                                                                                                                                                        | Weight                         | Line height                                                                                          | Tracking                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Display         | A failure screen's title, the too-narrow message's title                                                                                             | `--ag-text-display` 20 px / 20 px                                                                                                                           | `--ag-text-weight-heading` 650 | `--ag-text-line-height-heading` 1.25                                                                 | `--ag-text-tracking-tight` −0.01 em                                    |
| Heading         | A dialogue's title, a panel's subject title, an empty state's title (600), the palette's field (400)                                                 | `--ag-text-heading` 15 px / 13 px                                                                                                                           | 650                            | 1.25                                                                                                 | −0.01 em                                                               |
| Body            | Running text, a menu row, a field's value; a control's own label at 550 (button, tab, list name) or 500 (menu bar trigger, segmented choice, select) | `--ag-text-body` 13 px / 12 px                                                                                                                              | `--ag-text-weight-regular` 400 | `--ag-text-line-height-body` 1.45 for wrapped text; a single line is centred by its control's height | 0                                                                      |
| Label           | Supporting text: a sub-line, a unit, a note, a field's error, the status bar, a popover's text; a section's header at 600                            | `--ag-text-label` 12 px / 11 px                                                                                                                             | 400                            | 1.45 wrapped, `--ag-text-line-height-tight` 1.35 for a reason under a menu row or a table's verdict  | 0                                                                      |
| Caption         | A group title and a table's head (600, upper case); a shortcut and a segment's sub-line (400)                                                        | `--ag-text-caption` 11 px / 10 px                                                                                                                           | `--ag-text-weight-strong` 600  | 1.35                                                                                                 | `--ag-text-tracking-caps` +0.06 em upper case; +0.02 em for a shortcut |
| Numeric readout | The transport's time readout                                                                                                                         | `--ag-text-readout` 26 px / 20 px, JetBrains Mono                                                                                                           | `--ag-text-weight-medium` 500  | `--ag-text-line-height-readout` 1.05                                                                 | `--ag-text-tracking-readout` −0.02 em                                  |
| Inline number   | Every time, level, frequency, count or shortcut inside other text                                                                                    | `--ag-text-numeric-ratio` 0.95 em of the role it sits in, JetBrains Mono                                                                                    | inherits                       | inherits                                                                                             | −0.01 em                                                               |
| Scale mark      | A meter's, the frequency axis's and the fader's printed scale                                                                                        | `--ag-text-scale` 9 px / 9 px, JetBrains Mono (the fader's marks are 8 units of its view box; the ruler's labels are `--ag-text-ruler` 10 px / 9 px at 500) | 400                            | 1                                                                                                    | 0                                                                      |

Every time, level and frequency readout sets `font-variant-numeric: tabular-nums` and the numeric
family, so its digits never shift as the value changes.

Weights the language uses, each a token: `--ag-text-weight-regular` 400, `--ag-text-weight-quiet`
450 (a summary, a readout's sub-line), `--ag-text-weight-medium` 500, `--ag-text-weight-control` 550,
`--ag-text-weight-strong` 600, `--ag-text-weight-heading` 650, `--ag-text-weight-bold` 700 (the
fader's unity label, the A and B letters).

In the dark theme the transport readout carries a glow: `text-shadow: 0 0 18px` of the accent at
50 % (`--ag-effect-readout-glow`). The light theme keeps the same token; its accent is darker and
the glow reads as a soft tint.

### New tokens

| Token                           | Value                                                                 |
| ------------------------------- | --------------------------------------------------------------------- |
| `--ag-font-ui`                  | Inter Variable stack                                                  |
| `--ag-font-numeric`             | JetBrains Mono Variable stack                                         |
| `--ag-font-features`            | `'cv11', 'ss01'`                                                      |
| `--ag-text-display`             | 20 px / 20 px                                                         |
| `--ag-text-label`               | 12 px / 11 px (the values of `--ag-text-small`, renamed for its role) |
| `--ag-text-caption`             | 11 px / 10 px (the values of `--ag-text-tiny`, renamed for its role)  |
| `--ag-text-readout`             | 26 px / 20 px                                                         |
| `--ag-text-scale`               | 9 px / 9 px                                                           |
| `--ag-text-ruler`               | 10 px / 9 px                                                          |
| `--ag-text-numeric-ratio`       | 0.95                                                                  |
| `--ag-text-weight-regular`      | 400                                                                   |
| `--ag-text-weight-quiet`        | 450                                                                   |
| `--ag-text-weight-medium`       | 500                                                                   |
| `--ag-text-weight-control`      | 550                                                                   |
| `--ag-text-weight-strong`       | 600                                                                   |
| `--ag-text-weight-heading`      | 650                                                                   |
| `--ag-text-weight-bold`         | 700                                                                   |
| `--ag-text-line-height-body`    | 1.45                                                                  |
| `--ag-text-line-height-tight`   | 1.35                                                                  |
| `--ag-text-line-height-heading` | 1.25                                                                  |
| `--ag-text-line-height-readout` | 1.05                                                                  |
| `--ag-text-tracking-tight`      | −0.01 em                                                              |
| `--ag-text-tracking-readout`    | −0.02 em                                                              |
| `--ag-text-tracking-caps`       | 0.06 em                                                               |
| `--ag-effect-readout-glow`      | `0 0 18px` accent at 50 %                                             |

### Changed tokens

| Token                      | Today         | Language                                           |
| -------------------------- | ------------- | -------------------------------------------------- |
| `--ag-text-body`           | 14 px / 12 px | 13 px / 12 px                                      |
| `--ag-text-heading`        | 20 px / 17 px | 15 px / 13 px (20 px moves to `--ag-text-display`) |
| `--ag-text-small`          | 12 px / 11 px | Retired into `--ag-text-label`                     |
| `--ag-text-tiny`           | 11 px / 10 px | Retired into `--ag-text-caption`                   |
| `--ag-text-large`          | 16 px / 14 px | Retired: no role uses it                           |
| `--ag-text-monospace-body` | 13 px / 11 px | Retired into `--ag-text-numeric-ratio`             |
| `--ag-text-line-height`    | 1.5 / 1.4     | Retired into the per-role line heights             |

## 3. Spacing and radius

### Spacing scale

The inset tokens of [section 1](#1-layout-grid) carry the structure. The spacing scale carries the
gaps between things inside a row or a stack.

| Token               | Value         | Used for                                                                           |
| ------------------- | ------------- | ---------------------------------------------------------------------------------- |
| `--ag-space-none`   | 0             |                                                                                    |
| `--ag-space-hair`   | 1 px / 1 px   | The gap between menu, list and palette rows (a hairline, exempt from the grid)     |
| `--ag-space-micro`  | 2 px / 2 px   | Tabs in a strip, buttons in a toolbar group, a segmented control's padding and gap |
| `--ag-space-tiny`   | 4 px / 2 px   | A badge's icon gap, a chain's chips                                                |
| `--ag-space-small`  | 6 px / 6 px   | A button's icon gap, a notice's actions, a status item's icon gap                  |
| `--ag-space-medium` | 10 px / 8 px  | A menu row's columns, a list row's columns, a notice's columns                     |
| `--ag-space-large`  | 14 px / 14 px | A dialogue header's items, the status bar's groups                                 |
| `--ag-space-huge`   | 28 px / 22 px | An empty state's block padding                                                     |

### Radius

| Token                   | Value                                                        | Used for                                                                  |
| ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `--ag-radius-none`      | 0                                                            |                                                                           |
| `--ag-radius-hairline`  | 2 px / 2 px                                                  | A template token's wash, a meter's segments, a skeleton line's ends       |
| `--ag-radius-small`     | 4 px / 4 px                                                  | A key cap, an inline field, a thumbnail, a tag, a knob's value field      |
| `--ag-radius-control`   | 8 px / 6 px                                                  | Every control: button, field, select, tab, menu row, list row, card, well |
| `--ag-radius-container` | `--ag-radius-control` + `--ag-space-inset`: 16 px / 12 px    | Panel, overlay, notice, banner, status bar strip                          |
| `--ag-radius-frame`     | `--ag-radius-container` + `--ag-space-gutter`: 24 px / 18 px | The workspace frame, a failure screen                                     |
| `--ag-radius-full`      | 9999 px                                                      | A pill, a round button, a lamp, a switch                                  |

The nesting rule: a content radius is its container's radius minus the gap between their edges.
A segmented control's choice is `--ag-radius-control` minus 3 px (2 px padding and a 1 px edge),
5 px / 3 px, computed with `calc()` in the component and never written as a number.

### New tokens

| Token                   | Value         |
| ----------------------- | ------------- |
| `--ag-space-hair`       | 1 px          |
| `--ag-space-micro`      | 2 px          |
| `--ag-radius-hairline`  | 2 px          |
| `--ag-radius-control`   | 8 px / 6 px   |
| `--ag-radius-container` | 16 px / 12 px |
| `--ag-radius-frame`     | 24 px / 18 px |

### Changed tokens

| Token                | Today         | Language                                            |
| -------------------- | ------------- | --------------------------------------------------- |
| `--ag-space-small`   | 8 px / 6 px   | 6 px / 6 px (8 px / 6 px is now `--ag-space-inset`) |
| `--ag-space-medium`  | 12 px / 8 px  | 10 px / 8 px                                        |
| `--ag-space-large`   | 20 px / 14 px | 14 px / 14 px                                       |
| `--ag-space-huge`    | 32 px / 22 px | 28 px / 22 px                                       |
| `--ag-radius-small`  | 3 px / 2 px   | 4 px / 4 px                                         |
| `--ag-radius-medium` | 6 px / 4 px   | Retired into `--ag-radius-control`                  |
| `--ag-radius-large`  | 10 px / 8 px  | Retired into `--ag-radius-container`                |

WU-16.B moves every call site of a retired or re-valued token in the same change, because the
existing values are in use across `components.css` and the shell.

## 4. Icons

- **One set: Lucide** through `lucide-react`, ISC (`ADR-0108`), reached only through the design
  system's `Icon` component, which names icons by AudioGubbins' own vocabulary. An icon name with no
  glyph is a type error.
- **One stroke**: 1.75 units of the 24-unit grid at every size (`--ag-icon-stroke`), round caps and
  joins. The stroke scales with the icon: it is never set in absolute pixels.
- **Centred by its ink.** The box of a glyph's geometry is moved to its grid's centre, computed per
  glyph when the set is built and carried by `Icon`. An icon button has no padding of its own: the
  glyph is placed by the grid. Measured to within 0.25 px on every icon button; the power glyph to
  0.02 px. No optical shift is applied by hand.
- **Filled glyphs**: the transport's play and pause glyphs are filled with `currentColor`; every
  other glyph is a stroke.
- **Glyphs Lucide lacks** are drawn by AudioGubbins inside the design system to Lucide's grid,
  stroke and caps, and are ISC like the set they join. Fade in and fade out are drawn
  (`custom-icons/fade-in.svg`, `fade-out.svg`); knob, meter and spectrogram are still to draw
  (Phase 16 `Icon` contract).
- **Colour**: a glyph takes its control's text colour: `--ag-chrome-text-secondary` at rest,
  `--ag-chrome-text-primary` under the pointer, `--ag-chrome-accent` when its control is on or its
  row is highlighted, with a 4 px drop-shadow glow of the accent at 70 % on a highlighted row.

### Sizes

| Token                    | Value         | Used for                                                                                                                         |
| ------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `--ag-icon-size-small`   | 12 px         | A badge, a stepper's chevrons, a scope chip, a chain arrow                                                                       |
| `--ag-icon-size-inline`  | 14 px         | An icon set in label text: a status item, a section header, a hint, a field's error, a tab's close glyph, a rich tooltip's title |
| `--ag-control-icon-size` | 16 px / 14 px | Every icon in a control, menu row, tab, list row and toolbar                                                                     |
| `--ag-icon-size-feature` | 20 px         | The play glyph, the palette's search glyph, a drop target's preview, a profile card                                              |
| `--ag-icon-size-mark`    | 24 px         | An empty state's or failure screen's mark                                                                                        |

The mock-ups used 11, 13, 15, 18 and 22 px in places; each takes the nearest size above, which
keeps every icon on the 2 px unit.

### New tokens

| Token                    | Value |
| ------------------------ | ----- |
| `--ag-icon-stroke`       | 1.75  |
| `--ag-icon-size-small`   | 12 px |
| `--ag-icon-size-inline`  | 14 px |
| `--ag-icon-size-feature` | 20 px |
| `--ag-icon-size-mark`    | 24 px |

## 5. Colour

### The roles

All chrome colours are the `ADR-0012` palette of `tokens/chrome.ts`. Teal is the shipped default
accent (owner's decision, 2026-10-16; `DEFAULT_THEME_PREFERENCES.accent` is `blue` today and
changes to `teal`). Every accent the settings offer is shown as its own swatch, and each one's
contrast is computed.

| Role                                                                            | Token                                                                        | Dark                 | Light                |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------- | -------------------- |
| The backdrop behind every panel                                                 | `--ag-chrome-surface-sunken` under `--ag-effect-backdrop`                    | Base −0.045 L        | Base −0.045 L        |
| A panel's glass                                                                 | `--ag-chrome-surface-base` at 62 % (`--ag-elevation-panel-fill`)             |                      |                      |
| A card or processor inside a panel                                              | `--ag-chrome-surface-raised` at 45 % (`--ag-elevation-card-fill`)            |                      |                      |
| An overlay's glass                                                              | `--ag-chrome-surface-overlay` at 66 % / 70 % (`--ag-elevation-overlay-fill`) |                      |                      |
| A well (field, segmented control, readout, tree)                                | `--ag-chrome-fill-well`                                                      | Sunken at 55 %       | White at 45 %        |
| Body text                                                                       | `--ag-chrome-text-primary`                                                   |                      |                      |
| Supporting text, a resting glyph                                                | `--ag-chrome-text-secondary`                                                 |                      |                      |
| Unavailable text, a placeholder, a minor scale mark                             | `--ag-chrome-text-disabled`                                                  |                      |                      |
| Text on the accent or a call to action                                          | `--ag-chrome-text-on-accent`                                                 |                      |                      |
| Accent used as text (a tag, an accent badge, a template token, a palette match) | `--ag-chrome-accent-text`                                                    | Solved to 4.5 : 1    | Solved to 4.5 : 1    |
| A hairline between parts                                                        | `--ag-chrome-border-subtle`                                                  |                      |                      |
| A glass edge                                                                    | `--ag-chrome-edge-quiet`                                                     | Text primary at 13 % | Text primary at 13 % |
| A panel's edge                                                                  | `--ag-elevation-panel-edge`                                                  | Text primary at 9 %  | Text primary at 9 %  |
| An overlay's edge                                                               | `--ag-elevation-overlay-edge`                                                | Text primary at 12 % | Text primary at 12 % |

`--ag-chrome-accent-text` is new because the accent is solved to the 3 : 1 of a large or drawn
thing, while a tag or a token is small text held to 4.5 : 1. The mock-ups worked round this in the
light theme by mixing the accent towards black; the token solves it instead.

### Fills: high translucency, never solid

Owner's finding, 2026-10-17: a fill is a colour at a high translucency, never a solid colour, so it
takes up the backdrop. A call to action keeps a low translucency, still never solid.

| Fill                                             | Token                                                                                                          | Dark                | Light |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------- | ----- |
| Resting secondary button, select, badge, key cap | `--ag-chrome-fill-quiet`                                                                                       | Text primary at 7 % | 6 %   |
| Under the pointer                                | `--ag-chrome-fill-hover`                                                                                       | 11 %                | 9 %   |
| Pressed, a chosen plain segment                  | `--ag-chrome-fill-press`                                                                                       | 15 %                | 15 %  |
| A toggled icon button, a selected item's base    | `--ag-chrome-fill-accent`                                                                                      | Accent at 20 %      | 16 %  |
| The edge of an accent fill                       | `--ag-chrome-edge-accent`                                                                                      | Accent at 42 %      | 42 %  |
| A status item, a tone badge                      | its state colour at 12 % to 20 %, with an edge at 30 % to 38 %                                                 |                     |       |
| The call to action                               | `--ag-effect-cta-fill`: 135° from `--ag-chrome-accent-hover` at 88 % to `--ag-chrome-accent-partner` at 82 %   |                     |       |
| The destructive action                           | `--ag-effect-danger-fill`: 135° from `--ag-chrome-status-error` at 88 % to error mixed 75 % with rose, at 80 % |                     |       |

`--ag-chrome-accent-partner` is the call to action's second hue: the accent mixed 70 % with
`--ag-category-rose`, the same rose that lights the backdrop. `--ag-chrome-text-on-accent` is solved
against the harder of the two gradient stops, not the accent alone.

### The call to action is lit from above

In both themes: a gloss over its top half (white 26 % at the top to 6 % at the middle, ending
sharply at 51 %), a bright top edge (inset 1 px white at 60 %), a faint dark bottom edge (inset
−1 px black at 18 %), and a soft glow of its colour below it (`0 0 18px -6px`). The tokens are
`--ag-effect-cta-gloss` and `--ag-effect-cta-edge`, and the glow is `--ag-effect-glow-cta`.

### Where the accent appears, and where it does not

The accent appears on: the keyboard focus ring; the call to action; the active tab's wash; the lit
edge of a highlighted or chosen row; a selected card's edge and glow; a switch, check and slider
when on; a radio lamp's LED; a knob's value ring and index line; a fader's index and slot level; a
power switch's LED; the chosen tool; a toggled icon button; a highlighted row's glyph; the open
menu bar trigger; the palette's caret and matched letters; progress; a template field's tokens; the
history's line; the waveform's peaks and the audio selection (in the accent's hue); and the
backdrop's top glow.

The accent never appears on: body or supporting text; a state (error, warning, success, recording
and clipping keep fixed hues whatever the accent, so a user never has to remember which colour they
chose, and a red accent cannot hide clipping); level meter segments (green, amber, red); markers
and regions (their own category colour); an unavailable control; a destructive action; a resting
secondary button; panel edges; printed scales.

### State colours

| State       | Token                                                                                                     | Notes                                                                                                                                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Error       | `--ag-chrome-status-error`                                                                                | Hue 25, solved to 4.5 : 1 as small text                                                                                                                                                                     |
| Warning     | `--ag-chrome-status-warning`                                                                              | Hue 75; also an unavailable command's reason                                                                                                                                                                |
| Success     | `--ag-chrome-status-success`                                                                              | Hue 150                                                                                                                                                                                                     |
| Information | `--ag-chrome-status-info`                                                                                 | Hue 230; an informational notice uses the accent instead                                                                                                                                                    |
| Recording   | `--ag-chrome-status-recording`                                                                            | The record lamp, the recording status item, a shortcut being recorded. Hue 25 at the meter's clip lightness; the mock-ups borrowed `--ag-meter-clip`, and the role gets its own token so the two can differ |
| Clipping    | `--ag-waveform-clipped` on the display, `--ag-meter-clip` on a meter                                      | Red whatever the accent                                                                                                                                                                                     |
| Selection   | `--ag-selection-fill`, `--ag-selection-border`, `--ag-selection-handle` for audio; the lit edge for a row | See [Focus and selection](#7-focus-and-selection)                                                                                                                                                           |

A state told by colour is told by a word or a glyph as well. In forced colours the existing rules
of `tokens.css` stand: the boundaries return as `CanvasText` borders and the states take `Mark`.

### The backdrop

`--ag-effect-backdrop`: two radial glows over `--ag-chrome-surface-sunken`: the accent at 45 %,
70 % by 60 % at 20 % 0 (top leading), fading by 70 %; and `--ag-category-rose` at 35 %, 60 % by
70 % at 100 % 100 % (bottom trailing), fading by 70 %. The panels' blur takes this colour up, which
is what makes the glass read as glass.

### New tokens

| Token                          | Value                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `--ag-chrome-accent-text`      | The accent solved to `ContrastRequirement.BodyText` against its hardest surface |
| `--ag-chrome-accent-partner`   | Accent mixed 70 % with the rose hue                                             |
| `--ag-chrome-fill-quiet`       | Text primary at 7 % / 6 %                                                       |
| `--ag-chrome-fill-hover`       | Text primary at 11 % / 9 %                                                      |
| `--ag-chrome-fill-press`       | Text primary at 15 %                                                            |
| `--ag-chrome-fill-well`        | Sunken at 55 % / white at 45 %                                                  |
| `--ag-chrome-fill-accent`      | Accent at 20 % / 16 %                                                           |
| `--ag-chrome-edge-quiet`       | Text primary at 13 %                                                            |
| `--ag-chrome-edge-accent`      | Accent at 42 %                                                                  |
| `--ag-chrome-status-recording` | Hue 25, the record lamp's red                                                   |
| `--ag-effect-cta-fill`         | The call to action's gradient                                                   |
| `--ag-effect-danger-fill`      | The destructive action's gradient                                               |
| `--ag-effect-cta-gloss`        | The top-half gloss                                                              |
| `--ag-effect-cta-edge`         | The bright top and dark bottom edges                                            |
| `--ag-effect-glow-cta`         | `0 0 18px -6px` of the action's colour                                          |
| `--ag-effect-backdrop`         | The two-glow backdrop                                                           |

### Changed tokens

| Token                                               | Today  | Language |
| --------------------------------------------------- | ------ | -------- |
| Default accent (`DEFAULT_THEME_PREFERENCES.accent`) | `blue` | `teal`   |

## 6. Elevation and panel chrome

### Surface levels

| Level             | What sits there                                                             | Fill                                                                                                                         | Edge                                                 | Blur                                                        | Shadow                                                   |
| ----------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------- |
| 0. Backdrop       | The window                                                                  | `--ag-effect-backdrop`                                                                                                       | None                                                 | None                                                        | None                                                     |
| 0. Shell strips   | Menu bar, transport bar's surround, status bar                              | Transparent on the backdrop; the status bar strip is base at 40 % (`--ag-elevation-strip-fill`) with a text-primary 6 % edge |                                                      | `--ag-elevation-panel-backdrop`                             | None                                                     |
| 1. Panel          | A panel, the transport bar                                                  | `--ag-elevation-panel-fill`                                                                                                  | `--ag-elevation-panel-edge`                          | `--ag-elevation-panel-backdrop`: blur 20 px, saturate 1.3   | `--ag-elevation-panel-shadow`                            |
| 1. Well           | Field, segmented control, tree, readout block, meter housing                | `--ag-chrome-fill-well`                                                                                                      | `--ag-chrome-edge-quiet`                             | None                                                        | None (recessed: a well never lifts)                      |
| 2. Card           | A processor, a card, an open library entry, an A/B side                     | `--ag-elevation-card-fill`                                                                                                   | `--ag-chrome-edge-quiet`                             | Inherits the panel's                                        | None                                                     |
| 3. Overlay        | Menu, select list, popover, rich tooltip, command palette, dialogue, notice | `--ag-elevation-overlay-fill`                                                                                                | `--ag-elevation-overlay-edge`                        | `--ag-elevation-overlay-backdrop`: blur 28 px, saturate 1.6 | `--ag-elevation-overlay-shadow`                          |
| 3. Tooltip        | A plain tooltip                                                             | Overlay at 92 % (`--ag-elevation-tooltip-fill`)                                                                              | Overlay edge                                         | Overlay backdrop                                            | `--ag-elevation-tooltip-shadow`                          |
| 3. Floating panel | A floating group                                                            | Overlay at 78 % (`--ag-elevation-floating-fill`)                                                                             | Text primary at 14 % plus a 1 px accent ring at 25 % | Blur 24 px, saturate 1.4                                    | `--ag-elevation-floating-shadow` plus the breathing halo |
| Scrim             | Behind a modal dialogue                                                     | `--ag-chrome-scrim`                                                                                                          |                                                      | `--ag-elevation-scrim-backdrop`: blur 6 px, saturate 0.9    |                                                          |

Every overlay is frosted glass, notices included (owner's finding, 2026-10-17): the backdrop shows
blurred through it.

### Shadows

The geometry is the same in both themes; the colour is `--ag-chrome-shadow`, black at 0.35 / 0.20,
so the light theme's shadows are softer by the token, not by a second geometry. The hardware
controls are the exception: their shadows are deeper in the light theme, stated with each control.

| Token                            | Value                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| `--ag-elevation-panel-shadow`    | `inset 0 1px 0 white 7 %`, `0 12px 32px -12px shadow`                              |
| `--ag-elevation-overlay-shadow`  | `inset 0 1px 0 white 8 %`, `0 24px 60px -16px shadow`, `0 4px 14px -6px shadow`    |
| `--ag-elevation-tooltip-shadow`  | `0 8px 22px -8px shadow`                                                           |
| `--ag-elevation-floating-shadow` | `inset 0 1px 0 white 8 %`, `0 30px 70px -18px shadow`                              |
| `--ag-elevation-note-shadow`     | `0 10px 24px -10px shadow` (a note over the editing surface)                       |
| `--ag-elevation-drag-shadow`     | `0 14px 30px -8px shadow` (a dragged tab, the drop compass at `0 18px 40px -12px`) |

### Which parts cast a shadow

| Part                                                   | Dark                                      | Light                               |
| ------------------------------------------------------ | ----------------------------------------- | ----------------------------------- |
| Panel, transport bar                                   | Yes, panel shadow                         | Yes, panel shadow (softer by token) |
| Panel header, tab, toolbar, section                    | No: separated by the inset and a hairline | No                                  |
| Card inside a panel                                    | No: separated by its edge                 | No                                  |
| Menu, select list, popover, palette, dialogue, notice  | Yes, overlay shadow                       | Yes                                 |
| Tooltip                                                | Yes, tooltip shadow                       | Yes                                 |
| Floating panel                                         | Yes, floating shadow and halo             | Yes                                 |
| Menu bar, status bar                                   | No                                        | No                                  |
| Knob, fader cap, power switch, radio lamp, record lamp | Yes, their own                            | Yes, deeper                         |

### How the parts are separated

- **Panel from panel**: the gutter, and each panel's glass edge and shadow.
- **Panel header from body**: the tab strip sits in the panel's inset; no rule under it.
- **Tab from tab**: a 2 px gap; the active tab takes a translucent accent wash (24 % / 16 %) with a
  faint accent edge (inset 1 px at 35 %), and its glyph turns accent.
- **Toolbar from body**: the inset; a separator inside a toolbar is 1 px by 18 px of
  `--ag-chrome-border-subtle`.
- **Section from section**: a 1 px `--ag-chrome-border-subtle` rule on its top edge and an inset
  above its header.
- **Menu from page**: overlay glass and shadow; groups split by a hairline that spans the menu's
  full inner width.
- **Popover from page**: overlay glass, with a 10 px arrow cut from the same glass.
- **Dialogue from page**: the scrim, overlay glass, and its header and footer split from its body by
  hairlines; the footer sits on sunken at 35 %.

### New tokens

| Token                             | Value                      |
| --------------------------------- | -------------------------- |
| `--ag-elevation-panel-fill`       | Base at 62 %               |
| `--ag-elevation-panel-edge`       | Text primary at 9 %        |
| `--ag-elevation-panel-backdrop`   | `blur(20px) saturate(1.3)` |
| `--ag-elevation-panel-shadow`     | As above                   |
| `--ag-elevation-strip-fill`       | Base at 40 %               |
| `--ag-elevation-card-fill`        | Raised at 45 %             |
| `--ag-elevation-overlay-fill`     | Overlay at 66 % / 70 %     |
| `--ag-elevation-overlay-edge`     | Text primary at 12 %       |
| `--ag-elevation-overlay-backdrop` | `blur(28px) saturate(1.6)` |
| `--ag-elevation-overlay-shadow`   | As above                   |
| `--ag-elevation-tooltip-fill`     | Overlay at 92 %            |
| `--ag-elevation-tooltip-shadow`   | As above                   |
| `--ag-elevation-floating-fill`    | Overlay at 78 %            |
| `--ag-elevation-floating-shadow`  | As above                   |
| `--ag-elevation-note-shadow`      | As above                   |
| `--ag-elevation-drag-shadow`      | As above                   |
| `--ag-elevation-scrim-backdrop`   | `blur(6px) saturate(0.9)`  |

### Changed tokens

| Token               | Today                              | Language                                                   |
| ------------------- | ---------------------------------- | ---------------------------------------------------------- |
| `--ag-chrome-scrim` | Black at 0.5 / 0.7 (high contrast) | `--ag-chrome-surface-sunken` at 0.55, 0.7 at high contrast |

## 7. Focus and selection

Five indicators, each distinct from the others: a ring for keyboard focus, a lit edge for a chosen
row, a glow for a chosen card, a wash for audio, and a lit fill for a tool.

### Keyboard focus: one ring on every control

Owner's finding, 2026-10-17. Through `:focus-visible` only.

- A **2 px ring** (`--ag-focus-ring-width`) of `--ag-chrome-border-focus`, **2 px outside** the
  control (`--ag-focus-ring-offset`), following its radius.
- A **halo** round it (`--ag-focus-halo`): a 6 px spread of the focus colour at 22 % and an 18 px
  glow at 55 %.
- At the full motion level the halo **breathes** (`--ag-motion-loop-focus`, 1.8 s,
  `--ag-motion-ease-in-out`): from a 4 px spread at 16 % with a 12 px glow at 40 %, to a 7 px spread
  at 26 % with a 22 px glow at 60 %. At reduced and off it holds still.
- Inside a list, menu or tree the ring sits within the row (offset −2 px) so the scroll container
  never clips it.
- A container that scrolls pads by `--ag-focus-ring-reach` so no ring loses its edges.

`--ag-focus-ring-width` is 3 px today. `tokens.css` explains why: Firefox draws an outline in whole
device pixels and rounds its width down, so a declared 2 px outline draws 1.83 px at 110 % text size
and 1.6 px at 125 %. The language keeps the owner's 2 px ring and the Phase 01 goal together by
drawing the ring as a band of `box-shadow` (a gap of `--ag-focus-ring-offset` in the surface colour,
then `--ag-focus-ring-width` of the focus colour, then the halo), which is painted at its fractional
width rather than rounded to whole device pixels. A transparent outline of the same width stays on
the control, so in forced-colours mode, where shadows are not drawn, the system draws the outline in
its own focus colour. WU-16.B measures the drawn ring in Firefox at 100 %, 110 % and 125 % and keeps
the measurement with the inventory's evidence; the Phase 01 rationale in `tokens.css` is rewritten
with the change.

### A chosen row: the lit edge

Owner's choice, 2026-10-17, from four variants. A highlighted or chosen row (a menu or palette row,
a navigation page, a list row, a tree node, the history's chosen point) has no separate mark. Its
own outline is lit, bright at the leading side and fading round the row, over a wash that fades
the same way.

| Part  | Token                  | Value                                                                       |
| ----- | ---------------------- | --------------------------------------------------------------------------- |
| Wash  | `--ag-effect-lit-wash` | 90° from the accent at 20 % to 6 %                                          |
| Edge  | `--ag-effect-lit-edge` | A 1 px masked border, 90° from the accent at 100 %, to 35 % at 40 %, to 8 % |
| Glow  | `--ag-effect-lit-glow` | `0 0 16px -8px` accent                                                      |
| Glyph |                        | Accent, with a 4 px drop-shadow at 70 %                                     |

An unavailable row the keyboard is on takes text primary at 6 % with a subtle inset edge, never the
lit edge, and shows its reason under its name.

### A chosen card: the glow

A selected processor, card, preset, profile card, theme preview or the heard A/B side takes an
accent edge and `--ag-effect-glow`: a 1 px ring of the accent at 55 % and a 24 px glow at 70 %.

### A chosen segment: the accent wash

A chosen choice in a segmented control is a translucent accent wash (top to bottom, 26 % to 14 %),
a 1 px accent edge at 40 % and a top highlight of white at 12 %, never a solid grey
(owner's finding, 2026-10-17).

### A region of audio

- **Time selection**: `--ag-selection-fill` over the lanes, a 1 px `--ag-selection-border` at each
  end, carried up into the ruler as the same fill.
- **Spectral marquee**: the fill at 70 %, a 1.5 px dashed border (5 on, 3 off) of
  `--ag-selection-border`, and round handles of radius 3.5 px in `--ag-selection-handle` at its
  corners.
- **Brush**: two rings at the pointer, the outer at the brush's radius in text primary at 85 %,
  the inner at two thirds in text primary at 35 %.
- A selection being dragged follows the pointer in the next frame (`REQ-UX-222`).

### A tool

The chosen tool in a tool group is lit as a call to action: `--ag-effect-cta-fill`, text on accent,
and `--ag-effect-glow`. A toggled icon button (a mode that is on) takes `--ag-chrome-fill-accent`
and an accent glyph.

### New tokens

| Token                      | Value                                                    |
| -------------------------- | -------------------------------------------------------- |
| `--ag-focus-halo`          | `0 0 0 6px` focus at 22 %, `0 0 18px -2px` focus at 55 % |
| `--ag-effect-lit-wash`     | As above                                                 |
| `--ag-effect-lit-edge`     | As above                                                 |
| `--ag-effect-lit-glow`     | As above                                                 |
| `--ag-effect-glow`         | As above                                                 |
| `--ag-effect-segment-wash` | The chosen segment's wash, edge and highlight            |

### Changed tokens

| Token                    | Today | Language                                                             |
| ------------------------ | ----- | -------------------------------------------------------------------- |
| `--ag-focus-ring-width`  | 3 px  | 2 px (owner to confirm, above)                                       |
| `--ag-focus-ring-offset` | 2 px  | 2 px; −2 px inside a list (stated per component, not a second token) |

## 8. The presentation of audio

The editing palettes are independent of the chrome (`REQ-UX-070`) and stated per theme (owner's
decision, 2026-10-16: the light theme gets its own light display). Each is derived through
`ADR-0012` in `tokens/palette.ts`: today `buildWaveform`, `buildSelection` and `buildMeter` build one
dark display for both themes, so the light values below become a light branch of each builder, with
the label colours solved against the light display as they are against the dark.

### Waveform

| Role                         | Token                           | Dark (teal)                            | Light (teal)                          |
| ---------------------------- | ------------------------------- | -------------------------------------- | ------------------------------------- |
| Background                   | `--ag-waveform-background`      | L 0.13, c 0.01, h 255                  | L 0.98, c 0.004, h 255                |
| Peak envelope                | `--ag-waveform-peak`            | L 0.72, c 0.13, accent hue             | L 0.66, c 0.15, accent hue            |
| RMS body                     | `--ag-waveform-rms`             | L 0.86, c 0.09 (lighter than the peak) | L 0.48, c 0.17 (darker than the peak) |
| Zero line                    | `--ag-waveform-centre-line`     | L 0.40                                 | L 0.78                                |
| Clipped samples              | `--ag-waveform-clipped`         | L 0.68, c 0.22, h 25                   | Same                                  |
| Playhead                     | `--ag-waveform-playhead`        | L 0.95, c 0.02, h 90                   | L 0.30, c 0.03, h 255                 |
| Peaks not yet known          | `--ag-waveform-pending`         | L 0.25                                 | L 0.91                                |
| Label                        | `--ag-waveform-label`           | Solved, L about 0.96                   | Solved, L about 0.25                  |
| Secondary label              | `--ag-waveform-label-secondary` | Solved, L about 0.80                   | Solved, L about 0.45                  |
| Level guides and minor ticks | `--ag-waveform-grid`            | `--ag-analysis-grid` at 45 %           | Same mix of the light grid            |

Drawing: peaks then RMS, one device column at a time. A clipped sample is marked by a 3 by 4 px
block of the clipped colour at each lane's edge. Quiet level guides at −6 dB above and below the
zero line. Lanes are split by a hairline of `--ag-chrome-border-subtle`; each lane's channel letter
(L, R) is set in label secondary, 600, at 10 px / 9 px, 8 px from the leading edge.

The playhead is a 1.5 px line with a 10 px glow of its own colour, and a head at the ruler's top: a
12 px wide pentagon pointing down to 12 px. The overview strip is 22 px tall
(`--ag-waveform-overview-height`), draws the peaks at 55 %, and frames the visible range in a 1.5 px
accent outline over an accent 14 % fill, radius `--ag-radius-small`.

### Ruler

`--ag-waveform-ruler-height` 26 px / 22 px, transparent over the panel's glass, with a hairline of
`--ag-chrome-border-subtle` along its foot. Ticks every tenth: a major tick 9 px tall in label
secondary at each whole unit, a middle tick 6 px at each half, a minor tick 3 px in
`--ag-waveform-grid`. A major tick's label is JetBrains Mono 500 at `--ag-text-ruler`, 4 px after
the tick and 11 px above the foot. The ruler's detail follows the user's ruler detail setting
(`REQ-UX-071`).

### Markers

A marker is a 1 px line of its category colour through every lane, with a flag at the ruler's foot:
a triangle 10 px wide pointing down 7 px. A marker the user has not coloured takes
`--ag-marker-default` (amber). Category colours are `--ag-category-*`, L 0.72 / L 0.55, c 0.14.

### Regions

A region lane under the ruler, `--ag-waveform-region-lane-height` 20 px / 16 px. A region is a
rounded bar (radius `--ag-radius-small`) of its category colour at 30 %, with a 3 px leading bar of
the full colour and its name in `--ag-waveform-label`, 600, at 10 px / 9 px, 9 px from its start.
Its boundaries run down through the lanes as dashed lines (3 on, 3 off) of the colour at 55 %.

### Spectrogram

Seven stops (`--ag-spectrogram-0` to `--ag-spectrogram-6`), interpolated by the renderer, rising
monotonically in perceptual lightness in the dark theme and falling in the light theme, so the
loudest energy is always the strongest contrast against silence.

| Stop | Dark (silence to loudest) | Light (owner's decision: paper white to dark ember) |
| ---- | ------------------------- | --------------------------------------------------- |
| 0    | L 0.10, c 0.02, h 280     | L 0.985, c 0.004, h 255                             |
| 1    | L 0.28, c 0.12, h 290     | L 0.90, c 0.04, h 280                               |
| 2    | L 0.45, c 0.17, h 320     | L 0.76, c 0.11, h 295                               |
| 3    | L 0.60, c 0.20, h 20      | L 0.62, c 0.18, h 325                               |
| 4    | L 0.75, c 0.18, h 60      | L 0.55, c 0.20, h 15                                |
| 5    | L 0.88, c 0.14, h 95      | L 0.44, c 0.16, h 35                                |
| 6    | L 0.98, c 0.04, h 105     | L 0.28, c 0.08, h 30                                |

The frequency axis is a column at the trailing edge: JetBrains Mono at `--ag-text-scale` in label
secondary, over a gradient from transparent to the display background at 70 %. In the editor the
waveform lane sits above the spectrogram (28 % of the height), split by a hairline.

### Selection on the display

| Role   | Token                   | Dark                                   | Light                                                                                                          |
| ------ | ----------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Fill   | `--ag-selection-fill`   | L 0.70, c 0.12, accent hue, alpha 0.28 | L 0.62, c 0.14, alpha 0.16                                                                                     |
| Edge   | `--ag-selection-border` | L 0.80, c 0.14                         | L 0.52, c 0.17                                                                                                 |
| Handle | `--ag-selection-handle` | L 0.90, c 0.10                         | Solved by the palette for 3 : 1 against `--ag-waveform-background` (`ADR-0012`), in the accent's hue at c 0.15 |

### Meters

| Role                    | Token                   | Dark                                               | Light  |
| ----------------------- | ----------------------- | -------------------------------------------------- | ------ |
| Housing                 | `--ag-meter-background` | L 0.16 (the bar's well is `--ag-chrome-fill-well`) | L 0.88 |
| Ordinary level          | `--ag-meter-low`        | L 0.72, c 0.16, h 150                              | Same   |
| Approaching full scale  | `--ag-meter-mid`        | L 0.80, c 0.16, h 95                               | Same   |
| Top of the usable range | `--ag-meter-high`       | L 0.75, c 0.18, h 60                               | Same   |
| Over                    | `--ag-meter-clip`       | L 0.65, c 0.23, h 25                               | Same   |

Green, amber and red, as every meter a sound engineer has used. The gradient runs low to 70 % of
the scale, mid by 84 %, high by 94 %, clip at the top. The drawing (LED segments, peak hold, clip
LED) is in [LED meters](#led-meters) and the ballistics in [MotionSpec](#motionspec).

### Analysis overlays

| Role                         | Token                     | Value                                                                                                       |
| ---------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Grid                         | `--ag-analysis-grid`      | L 0.45 / L 0.80, drawn at 45 % for major and 35 % for minor lines                                           |
| A response or transfer curve | `--ag-analysis-curve`     | The accent, 2 px, with a 10 px glow (12 px for the selected band)                                           |
| The area under a curve       | `--ag-analysis-area`      | The accent at 32 % at the edges to 6 % at the centre line (an equaliser), or 26 % to 2 % (a transfer curve) |
| A threshold                  | `--ag-analysis-threshold` | `--ag-meter-mid` at 45 %                                                                                    |
| The signal now               | `--ag-analysis-signal`    | `--ag-meter-mid`, a 4.5 px dot with a 10 px glow                                                            |
| An equaliser band            | `--ag-category-*`         | An 8 px dot of the band's colour with a 6 px glow                                                           |

A display drawn on a panel (an equaliser graph, a transfer curve, a thumbnail) sits in a well of
`--ag-chrome-fill-well` in the dark theme and on `--ag-waveform-background` in the light theme.

A canvas reads the resolved token values through the design system and never a literal. A token
that cannot be resolved draws with the theme's default role and logs a structured record.

### New tokens

| Token                              | Value                               |
| ---------------------------------- | ----------------------------------- |
| `--ag-waveform-grid`               | `--ag-analysis-grid` at 45 %        |
| `--ag-waveform-ruler-height`       | 26 px / 22 px                       |
| `--ag-waveform-region-lane-height` | 20 px / 16 px                       |
| `--ag-waveform-overview-height`    | 22 px                               |
| `--ag-marker-default`              | The amber category colour           |
| `--ag-analysis-curve`              | The accent                          |
| `--ag-analysis-area`               | The accent's area gradient strength |
| `--ag-analysis-threshold`          | Meter mid at 45 %                   |
| `--ag-analysis-signal`             | Meter mid                           |

### Changed tokens

| Token                                                                   | Today                           | Language                                         |
| ----------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------ |
| Every `--ag-waveform-*`, `--ag-selection-*` and `--ag-meter-background` | One dark display in both themes | A light display in the light theme, values above |
| `--ag-spectrogram-0` to `-6`                                            | One ramp in both themes         | The light ramp above in the light theme          |

## 9. Empty, loading and error states

Every panel has all three, built from the same parts, so two panels in the same state look alike.

### Empty

Centred in the panel's body: a mark, a title, at most one line of explanation, and the action that
fills it.

- **Mark**: a 52 px circle (`--ag-state-mark-size`) holding a radial glow of the accent at 22 %
  fading by 70 %, a 1 px inset ring of the accent at 30 %, and the glyph at `--ag-icon-size-mark` in
  the accent.
- **Title**: `--ag-text-heading`, 600.
- **Text**: `--ag-text-label` in text secondary, at most 300 px wide, line height 1.45.
- **Actions**: a call to action and, at most, one secondary button, 8 px apart.
- Padding `--ag-space-huge` block, 20 px inline; 8 px between the parts.

### Loading

- **A panel whose content is coming**: skeleton lines (`--ag-effect-skeleton`, a horizontal
  gradient of text primary at 6 %, 12 %, 6 %, radius `--ag-radius-small`) in the shape of the
  content.
- **An operation under way**: a progress bar. Track 6 px (3 px in a row, 8 px in a dialogue),
  radius half its height, recessed (sunken mixed 75 % / 90 % with black, an inset shadow); fill
  `--ag-effect-cta-fill` with a sheen (white at 45 % between 60 % and 95 % of the fill) and a
  10 px accent glow. An indeterminate bar is a 35 % segment.
- **A short wait inside a control**: a spinner at the icon size, a 2 px ring of the accent at 22 %
  with the accent on its top quarter (12 px with a 1.5 px ring in a status item).
- **The editor still drawing peaks**: the region not yet known is `--ag-waveform-pending`, and a
  note in the bottom trailing corner (overlay glass, 220 px, `--ag-elevation-note-shadow`) says what
  is happening with its progress.

### Error

- **In a panel**: the empty state's parts in the error colour: the mark's glow and ring in
  `--ag-chrome-status-error`, a terse title, the reason in one line, and Retry. A warning (a state
  that still works) uses `--ag-chrome-status-warning` the same way.
- **Across the application**: the failure screen: a 440 px card on the backdrop with a radial glow
  of the error colour at 22 % from the top centre, a 60 px mark, the title at `--ag-text-display`,
  the text at line height 1.45, and the error's code in a well of JetBrains Mono at label size.
- **A refused item in a list** (an import that failed): its glyph and second line in the error
  colour; the row keeps its place.

### New tokens

| Token                        | Value                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `--ag-state-mark-size`       | 52 px (60 px on a failure screen, 64 px on the too-narrow message, stated as `calc()` of it) |
| `--ag-effect-skeleton`       | The skeleton gradient                                                                        |
| `--ag-effect-progress-sheen` | The progress fill's sheen                                                                    |

## 10. The control set

Every surface is built from these controls, each designed once. A surface that needs a control the
set lacks adds it to the set, designed in the language (`REQ-UX-221`). Sizes use the tokens of
sections 1 to 4; `--ag-control-height` is written h.

### Buttons

| Variant                  | Size                                                               | Fill                                       | Edge                     | Text              | Effects                                                                                  |
| ------------------------ | ------------------------------------------------------------------ | ------------------------------------------ | ------------------------ | ----------------- | ---------------------------------------------------------------------------------------- |
| Secondary                | h tall, 10 px inline padding, 6 px icon gap, `--ag-radius-control` | `--ag-chrome-fill-quiet` over a 12 px blur | `--ag-chrome-edge-quiet` | Text primary, 550 | Hover `--ag-chrome-fill-hover`; press `--ag-chrome-fill-press`                           |
| Primary (call to action) | Same                                                               | `--ag-effect-cta-fill`                     | Accent hover at 60 %     | Text on accent    | Lit from above (`--ag-effect-cta-gloss`, `--ag-effect-cta-edge`), `--ag-effect-glow-cta` |
| Destructive              | Same                                                               | `--ag-effect-danger-fill`                  | Error at 60 %            | Text on accent    | Lit from above, an error glow                                                            |
| Quiet destructive        | Same                                                               | As secondary                               | As secondary             | Error             |                                                                                          |
| Ghost                    | Same                                                               | None                                       | None                     | Text secondary    | Hover fill                                                                               |
| Small                    | h − 4, 8 px leading and 10 px trailing padding                     |                                            |                          |                   |                                                                                          |
| Disabled                 |                                                                    | Text primary at 4 %                        | Text primary at 8 %      | Text disabled     | No glow                                                                                  |

An unavailable button keeps its focus and opens its reason on hover or focus, and carries a 9 px
warning dot at its top trailing corner (3 px outside, ringed in the base surface, with an 8 px
glow) (`ADR-0013`).

### Icon buttons and grouped toolbars

- **Icon button**: an h square, `--ag-radius-control`, no padding of its own, the glyph at
  `--ag-control-icon-size` in text secondary. Hover: fill hover and text primary. On: fill accent
  and an accent glyph. Small: h − 4.
- **Transport buttons**: circles of h + 8 on fill quiet with a quiet edge. **Play**: a circle of
  h + 12 in `--ag-effect-cta-fill` with `--ag-effect-glow` and a filled glyph at
  `--ag-icon-size-feature`; while playing it grows to h + 20 and gains a 4 px accent ring at 18 % and
  a 28 px glow.
- **Toolbar**: in the panel's inset, items one inset apart; a group of related buttons 2 px apart;
  a separator 1 px by 18 px.

### Segmented controls

A well (fill well, quiet edge, `--ag-radius-control`) with 2 px padding and 2 px gaps. Each choice
is h − 6 tall, 10 px padding, 500, text secondary. Variants: tools (square choices h − 2 wide; the
chosen one lit as a call to action), icons (h + 2 wide), small (h − 8 tall, 8 px padding, label
size, 12 px glyphs), wide (full width, a caption sub-line under each label, at least h + 6 tall).
The chosen choice is the accent wash of [section 7](#a-chosen-segment-the-accent-wash).

### Switch

Hardware (owner's finding, 2026-10-17): a recessed track with a glossy bead whose LED lights in the
accent when on.

| Part                                      | Comfortable                                                               | Compact     |
| ----------------------------------------- | ------------------------------------------------------------------------- | ----------- |
| Track                                     | 38 by 22 px (`--ag-hardware-switch-width`, `--ag-hardware-switch-height`) | 32 by 20 px |
| Small track (a choice inside a dense row) | 28 by 16 px                                                               | 28 by 16 px |

- **Track, off**: a full radius; a top-to-bottom shade of black at 30 % to 8 % (16 % to 4 % light)
  over `--ag-chrome-fill-well`; an inset shadow of 1 px by 3 px at 55 % (28 % light), an inset 1 px
  ring of black at 25 % (12 % light), and a 1 px highlight under the track of white at 10 % (70 %
  light), so it reads as cut into the panel.
- **Track, on**: `--ag-effect-cta-fill` under a top shade (black at 18 % to clear by 60 %), an inset
  ring of accent hover at 50 %, and a 14 px accent glow.
- **Bead**: a circle of the track's height less 4 px, 2 px from the track's edge; a radial white
  gloss from the upper leading quarter (L 1.0 to 0.90 to 0.76, h 260), an inset lower shade, a
  0.5 px ring and a 2 by 4 px drop shadow. At its centre a 2 px LED: unlit L 0.55; lit, the accent
  with a halo to 5 px.
- **Disabled**: the whole control at 45 % opacity.

### Radio: a panel lamp

Drawn in layers as the power switch is (owner's finding, 2026-10-17): 18 px, in a 20-unit view box.

| Layer       | Radius                           | Drawing                                                                                                                                                      |
| ----------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cutout      | 9.5                              | Black at 45 %                                                                                                                                                |
| Bezel       | 9                                | Brushed metal, lit from the top leading corner: `--ag-hardware-metal-highlight` L 0.94, `--ag-hardware-metal-mid` L 0.66, `--ag-hardware-metal-shade` L 0.36 |
| Socket      | 7.4                              | Recessed: L 0.18 to L 0.58 from the top leading corner                                                                                                       |
| Lens, unlit | 6.4                              | Tinted glass: the accent at 22 % over L 0.28, to L 0.14 at the edge, with a 0.8 ring of black at 45 %                                                        |
| Lens, lit   | 6.4                              | The LED through the diffuser: white at the core, accent hover mixed 45 % with white at 30 %, 85 % at 68 %, the accent at the rim; a ring of black at 20 %    |
| Spill, lit  | 7.2                              | Accent hover at 80 %, blurred 0.7, lighting the socket                                                                                                       |
| Core, lit   | 4.2 and 5.6                      | A white bloom at 55 % blurred 0.9, and a ring of accent hover mixed with white at 70 %, blurred                                                              |
| Gloss       | Ellipse 3.6 by 2.4 at (8.6, 7.4) | White at 70 % lit, 45 % unlit, fading out                                                                                                                    |

Lit, the LED glows inside the lens, never round the control.

### Check

16 px, `--ag-radius-small`, recessed as the switch's track (black at 28 % to 6 % over the well,
inset shadow, quiet ring). On: `--ag-effect-cta-fill` with a top gloss (white at 28 % to clear by
55 %), an inset top highlight, a 10 px accent glow, and a tick 8 by 4 px drawn in 2 px strokes of
text on accent.

### Slider

20 px tall, at least 140 px wide. Groove 4 px, radius 2 px, recessed (sunken mixed 75 % / 88 % with
black, an inset shadow). Fill `--ag-effect-cta-fill` with an 8 px accent glow; a centred slider
fills from its centre detent (1 px, text secondary). Thumb 16 px, a radial gloss (L 0.98 to 0.82)
with a 3 px accent ring at 35 % and a 2 by 5 px shadow. Its value sits trailing, at least 52 px,
right-aligned, in the numeric family.

### Knob

Hardware (owner's findings, 2026-10-16 and 2026-10-17). `--ag-hardware-knob-size` 52 px / 44 px,
drawn on a 48-unit grid. The light falls from one place on the page: the skirt, the grip and the
cap and their shadows and highlights never turn. Only what is printed or moulded on them turns: the
skirt's pointer, the grip's ribs and the cap's index line.

| Part                             | Geometry                                                                                                   | Drawing                                                                                                                                                                                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tick scale, printed on the panel | 11 ticks across a 270° sweep from −135°, every 27°; from radius 23.2 to 25.2, major ticks (0, 5, 10) to 26 | 1.1 unit round strokes; minor in text disabled, major in text secondary                                                                                                                                                                                                                    |
| Track                            | Arc of radius 20.5 across the sweep                                                                        | 2.5 unit round stroke, sunken mixed 80 % with black                                                                                                                                                                                                                                        |
| Value ring                       | The same arc from −135° to the value                                                                       | The accent, with a 2.5 unit glow of the accent; off: text disabled, no glow                                                                                                                                                                                                                |
| Skirt                            | Inset 19 % of the knob                                                                                     | A dark disc: radial from raised mixed 60 % with black to base mixed 40 % with black (light: L 0.42 to L 0.28, h 260, c 0.01); inset top highlight of white at 18 %, a 1 px ring of white at 6 %, shadows `0 2px 3px` black at 55 % and `0 6px 12px` at 40 %                                |
| Skirt pointer (turns)            | 2 px wide, 22 % of the skirt tall, 1 px from its edge                                                      | Text primary (light: L 0.96)                                                                                                                                                                                                                                                               |
| Grip                             | Inset 27 %                                                                                                 | Active mixed 70 % with black (light: L 0.36); a still top-lit rim, inset `0 1px 1px` white at 25 %                                                                                                                                                                                         |
| Ribs (turn)                      | 36 flutes, 5° dark and 5° light                                                                            | Black at 45 % and white at 12 % (light: 40 % and 15 %)                                                                                                                                                                                                                                     |
| Cap                              | Inset 31 %                                                                                                 | Brushed aluminium: a still conic sheen of L 0.86, 0.66, 0.92, 0.62, 0.90, 0.64 at 0°, 45°, 110°, 180°, 250°, 310° (h 260, c 0.005), a radial vignette of black at 18 % at its edge, an inset top highlight of white at 70 %, an inset lower shade at 35 % and a `0 1px 2px` shadow at 50 % |
| Index line (turns)               | 2 px wide, 38 % of the cap tall, from 8 % of it                                                            | The accent with a 4 px accent glow; off: L 0.40, no glow                                                                                                                                                                                                                                   |

Its shadow is deeper in the light theme. Below the knob: its label at caption size in text
secondary, and its value as a field (`--ag-radius-small`, fill well, quiet edge, 1 px by 6 px
padding) that becomes editable on a click or Enter, then taking an accent edge and a 3 px accent
halo at 22 %. A drag follows the pointer in the next frame.

### Fader

After a console's long-throw fader (owner's finding, 2026-10-16), on a 64-unit-wide grid with its
slot at x 40. At least 80 px tall.

| Part                 | Geometry                                                                                                                                                                                         | Drawing                                                                                                                                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slot                 | 5 units wide, radius 2.5, from 4 units above the travel to 4 below                                                                                                                               | Sunken mixed 55 % with black, a 0.75 edge of white at 10 %                                                                                                                                                                                                                                                                              |
| Slot level           | 2 units wide, from the cap's centre down                                                                                                                                                         | The accent with a 3 unit glow                                                                                                                                                                                                                                                                                                           |
| dB scale, both sides | Marks at +10 (0), +5 (0.10), 0 (0.25), −5 (0.37), −10 (0.49), −20 (0.65), −30 (0.77), −40 (0.86), −60 (0.94), −∞ (1) of the travel; on a travel under 150 units, +5, −5, −30 and −60 are dropped | Marks 5 units long (8 at unity), 1 unit in text disabled; unity 1.5 units in text primary. Labels JetBrains Mono, 8 units, right-aligned 18 units before the slot; unity at 700 in text primary                                                                                                                                         |
| Cap                  | 24 by 30 units, radius 3                                                                                                                                                                         | A cylindrical body (active mixed 70 % with black at the sides, 60 % and 75 % with white towards the centre), a top light (white at 35 % fading by 45 %, black from 55 % to 30 % at the foot), six ridges at 4, 7, 10, 20, 23 and 26 units (a 1 unit dark line at 35 % over a 0.75 light line at 25 %), and a 0.75 edge of white at 40 % |
| Index line           | 2 units across the cap's centre                                                                                                                                                                  | The accent with a 3 unit glow                                                                                                                                                                                                                                                                                                           |
| Cap shadow           |                                                                                                                                                                                                  | `0 3px 2px` black at 50 % and `0 8px 10px` at 35 % (light: 35 % and `0 8px 12px` at 35 %)                                                                                                                                                                                                                                               |

A drag follows the pointer in the next frame.

### Power switch

A backlit push button (owner's finding, 2026-10-16): 26 px, on a 32-unit grid.

| Layer           | Radius                             | Drawing                                                                                                                                                                                  |
| --------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cutout          | 15.5                               | Black at 55 % / 30 %                                                                                                                                                                     |
| Bezel           | 14.5                               | Chamfered metal lit from the top leading corner: L 0.95, 0.70, 0.38                                                                                                                      |
| Chamfer         | 12                                 | L 0.32 to L 0.88                                                                                                                                                                         |
| Light spill, on | 11.6                               | A 1.2 unit ring of the accent at 55 %, blurred 0.6                                                                                                                                       |
| Cap             | 11                                 | A recessed dome. On: `--ag-hardware-power-lit-cap` (the accent mixed 50 % with L 0.22) to L 0.16 by 70 %. Off: L 0.30 to L 0.13 by 80 %                                                  |
| Cap shade       | 11                                 | A 1.4 unit ring of black at 60 %                                                                                                                                                         |
| Glyph, on       | Lucide's power glyph at 0.62 scale | An LED diffused through frosted plastic: a 6 unit halo of the accent at 90 % blurred 1.6, a 3 unit body of the accent mixed 55 % with white blurred 0.35, a 1.2 unit hot core near white |
| Glyph, off      | Same                               | An unlit moulding: a 3 unit stroke at L 0.30 with a catch light of white at 12 % 0.9 units below it                                                                                      |
| Gloss           | Ellipse 7 by 4.2 at (14, 10.5)     | White at 55 % fading out                                                                                                                                                                 |
| Drop shadow     |                                    | `0 1.5px 1.5px` black at 45 % (light: `0 1.5px 2px` at 35 %)                                                                                                                             |

The glyph's ink box is centred in the button to 0.02 px.

### Record button

A backlit red lamp with a Fresnel lens (owner's decision, 2026-10-17, refinement C): 46 px, on a
48-unit grid.

| Layer         | Radius                                      | Drawing                                                                                                                                                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cutout        | 23.4, 0.5 low                               | Black at 42 %                                                                                                                                                                                                                                                                                                                                           |
| Bezel         | 22.6                                        | Brushed metal, radial from the top leading corner: L 0.96, 0.72, 0.40                                                                                                                                                                                                                                                                                   |
| Chamfer       | 19.2                                        | L 0.30 to L 0.84                                                                                                                                                                                                                                                                                                                                        |
| Rim glow, lit | 18.4                                        | A 1.6 unit ring of the lamp's red (L 0.72, c 0.20, h 30) at 60 %, blurred 1.3                                                                                                                                                                                                                                                                           |
| Recess shadow | 17.6, 0.6 low                               | Black at 45 %, blurred 1.3                                                                                                                                                                                                                                                                                                                              |
| Cap, lit      | 17.2                                        | A smooth cap of red plastic lit from behind: L 0.93 / c 0.07 / h 45 at the centre, L 0.76 / c 0.19 / h 32 at 22 %, L 0.58 / c 0.22 / h 27 at 62 %, L 0.50 / c 0.20 / h 26 at 88 %, L 0.64 / c 0.20 / h 30 at the rim (light scattered under the surface brightens it)                                                                                   |
| Cap, unlit    | 17.2                                        | L 0.44 / c 0.13 / h 27 to L 0.30 / c 0.10 / h 25, rim L 0.38                                                                                                                                                                                                                                                                                            |
| Fresnel lens  | Rings from radius 2.2 to 17 at a 1.55 pitch | Moulded on the cap's inner face: each ridge a 0.55 unit line (L 0.97, c 0.05, h 45 lit; L 0.80, c 0.08, h 30 unlit) whose opacity is 0.10 + 0.45 × (1 − r / 17)² lit, 0.04 unlit, so each ring is even and the centre brighter; its back a 0.7 unit line 0.6 out, L 0.12, at 32 % lit and 50 % unlit; seen through the plastic, softened by a 0.18 blur |
| Shade         | 17.2                                        | A radial edge shade of black to 35 %                                                                                                                                                                                                                                                                                                                    |
| Bloom, lit    | 6.5 at (24, 26)                             | L 0.97 at 35 %, blurred 1.3                                                                                                                                                                                                                                                                                                                             |
| Reflection    |                                             | The room's light reflects once off the smooth front: a soft ellipse 10.5 by 6.2 at (21.5, 15.2), white at 28 %, and a small sharp highlight 2.2 by 1.3 at (18.2, 13.4), white at 53 %, turned −24°                                                                                                                                                      |
| Drop shadow   |                                             | `0 2px 2px` black at 45 % (light: `0 2px 3px` at 30 %)                                                                                                                                                                                                                                                                                                  |

The lamp's reds become `--ag-hardware-record-*` tokens derived from `--ag-chrome-status-recording`'s
hue, so a contrast or brightness change reaches them as it reaches every colour.

### LED meters

Level meters are LED segments with a peak hold (owner's finding, 2026-10-16) and a clip LED
(2026-10-17).

- **Horizontal meter**: a row of the channel's letter (14 px column), the bar, and the clip LED
  (10 px column), 6 px apart. Bar 10 px tall (14 px for the main meter), radius 2 px, in a well of
  `--ag-chrome-fill-well`.
- **Segments**: 4 px lit, 1 px gap (`--ag-hardware-meter-segment`, `--ag-hardware-meter-gap`),
  coloured by the meter gradient; segments above the level show at 14 % of their colour; the lit
  segments glow (`0 0 4px` of meter low at 70 %).
- **Peak hold**: a 3 px bar of `--ag-meter-mid` with a 6 px glow.
- **Clip LED**: an 8 px lamp. Unlit: the clip colour at 25 % over sunken, with an inset shadow. Lit
  on an over: a radial from L 0.85 to `--ag-meter-clip`, with an 8 px glow.
- **Scale**: JetBrains Mono at `--ag-text-scale` in text disabled, aligned under the bar.
- **Vertical meter** (the rack's input and output): 6 px columns, 3 px apart, segments 3 px lit and
  1 px gap, unlit at 16 %.
- **Status bar meter**: 60 px wide, 3 px bars, 2 px apart.
- **Correlation**: a 6 px bar from the clip colour at 35 % (−1) through the well (0) to meter low at
  35 % (+1), a 1 px centre line 3 px proud, and a pointer 4 px wide, 3 px proud, in meter low with an
  8 px glow; its value trailing in caption size.
- **A check against thresholds** (Loop): a 6 px bar in pass, warn and fail zones (success, warning,
  error at 45 %), the value a 3 px tick in text primary with a 6 px glow.

### Property grids

- **Inspector properties**: two columns (label, value), labels in text secondary, values
  end-aligned; 7 px between rows, 12 px between columns.
- **A form in a panel**: a label column of 88 px / 76 px and a control column that shrinks, 10 px
  apart, rows one inset apart. A dialogue's form takes a 100 px to 150 px label column, stated per
  dialogue.
- **A policy, field by field**: each row a label at label size 600, a source chip (set: accent on
  fill accent; inherited: an up arrow on fill quiet; unset: text disabled in a dashed quiet edge), and
  the value under it at label size, line height 1.4, wrapping; rows split by hairlines; the open row
  becomes a card holding its editor.

### Lists

- **Row**: at least `--ag-control-row-height` for two lines (h for one), 4 px block and one inset
  inline padding, columns 10 px apart, `--ag-radius-control`. Name at 550, second line at label
  size in text secondary with tabular figures. Hover: fill hover. Chosen: the lit edge.
- **Nested row**: indented one inset plus 18 px.
- **Tree**: in a well with an inset; nodes h − 2 tall, a 14 px twisty, second level indented 22 px,
  counts in the numeric family at caption size in text disabled.
- **History**: a 2 px line of the accent at 45 % down the leading edge, nodes 10 px rings of the
  accent (filled and glowing at the current point), a snapshot a diamond in amber, a branch indented
  16 px with a violet elbow.
- The compact density sets each row on one line, its second line beside the name.

### Tables

A container of `--ag-radius-control` with a quiet edge. The head row: caption size, 600, upper
case, +0.06 em, text secondary, on fill quiet, 6 px block padding. Body rows: at least h + 4, 4 px
block and one inset inline padding, columns 10 px apart, split by hairlines. A verdict cell wraps
at line height 1.35 with its glyph or spinner at the first line.

### Tabs and panel headers

- **Tab strip**: in the panel's inset, tabs 2 px apart.
- **Tab**: h tall, 10 px padding, 8 px between glyph and label, body size, 550, text secondary.
  Hover: fill hover and text primary. Active: the accent wash of
  [section 6](#how-the-parts-are-separated), text primary, accent glyph. A close glyph at
  `--ag-icon-size-inline` follows the label.
- **Header actions**: full-size icon buttons at the strip's trailing end. A sub-label after the
  tabs (a processor's count, the take being heard) is label size in text secondary.

### Menus, selects and the command palette

- **Menu row**: h tall, one inset inline padding, `--ag-radius-control`, three columns (glyph,
  label, shortcut) 10 px apart. Shortcut: numeric family, caption size, +0.02 em, text secondary,
  24 px clear of the label. Highlighted: the lit edge. Unavailable: text disabled, and when
  highlighted its reason under its name in caption size in the warning colour, line height 1.35.
  A group heading: caption, 600, upper case. A separator: a hairline across the menu's inner width,
  4 px above and below.
- **Menu bar trigger**: body size, 500, text secondary, 4 px by 10 px padding,
  `--ag-radius-control`. Open: accent at 24 % with an inset accent edge at 35 %, text primary.
- **Select**: a secondary button's fill and edge, a chevron at its trailing end in text secondary.
  Open: an accent edge and a 3 px accent halo at 22 %; its list is a menu, at least the trigger's
  width.
- **Command palette**: 560 px / 500 px of overlay glass. The field: 1.5 insets block and 2 insets
  inline, heading size, a search glyph in the accent at `--ag-icon-size-feature`, a 2 px caret in the
  accent with a 6 px glow. A count line in caption, upper case. Result rows h + 6 tall; matched
  letters in `--ag-chrome-accent-text` at 650; a category chip at caption size on text primary at 6 %.
  A footer of key hints in caption size, split from the list by a hairline.

### Text fields and the template field

- **Text field**: h tall, one inset inline padding, `--ag-radius-control`, fill well, quiet edge.
  Placeholder text disabled; a unit trailing at label size in text secondary. Editing: an accent
  edge and a 3 px accent halo at 22 % (keyboard focus adds the ring). Invalid: an error edge, a
  3 px error halo at 18 %, and the error under it at label size with a glyph at
  `--ag-icon-size-inline`.
- **Numeric field**: the value in the numeric family with tabular figures, at least 76 px (52 px in a
  panel form); steppers in a 20 px column split by a hairline, chevrons at `--ag-icon-size-small`.
- **Tags field**: wraps; each tag at label size on accent subtle in `--ag-chrome-accent-text`,
  1 px by 7 px padding, `--ag-radius-small`.
- **The template field** (owner's decision, 2026-10-17), opt-in on the text field. Each known token
  is drawn as an accent token at the text's own metrics: the numeric family, `--ag-chrome-accent-text`,
  a wash of the accent at 14 % drawn by a 2 px spread shadow so neither padding nor weight changes and
  the caret keeps its place, radius `--ag-radius-hairline` (`--ag-effect-token-wash`). Its modifier,
  after the colon, is the accent mixed 40 % with violet at 400, a step quieter, so it differs in hue
  and weight in either theme. An unknown token is the error colour on an error wash at 12 % with a
  1 px wavy underline 3 px below. A brace typed twice is one literal brace: plain text in the numeric
  family, the second brace at 45 %, with a dotted underline of text secondary at 60 % joining the
  pair. Under the pointer a token's wash deepens to 26 % (error 22 %).
- **The token list**: a braces button inside the field's trailing end opens the tokens its caller
  gives it, as a menu of two columns: the token (112 px) and a short description at label size in
  text secondary (text primary when highlighted). Choosing a row inserts the token at the caret. A
  footer at label size says how to write a brace itself.
- **Rich tooltip**: the highlighted row, and any token in the field under the pointer, shows a rich
  tooltip (overlay glass, 10 px by 12 px padding, at most 300 px, line height 1.45): a title at body
  size, 650, with a glyph at `--ag-icon-size-inline`, short paragraphs, code in the token's own style,
  and an example below a quiet hairline. An unknown token's tooltip is the danger variant (error at
  12 % over the overlay, an error edge at 45 %, an error title) and says why it is red and how to
  write a brace itself.

### Notices, tooltips and hints

- **Notice**: 380 px of overlay glass, `--ag-radius-container`, padding one inset with a leading
  inset; columns: a glyph (success, warning, error, or the accent for information), a title at 600
  over its text at label size in text secondary, and a close button; actions 6 px apart under the
  text. An error, urgent or warning notice carries a 3 px bar of its colour inset along its leading
  edge. Its time bar is a 2 px line of the accent at 70 % along its bottom edge, inside the notice,
  clipped by its corners.
- **Banner** (the project's state): its tone's edge at 40 %, a fill of its tone at 14 % over base at
  70 %, a 20 px blur, a 24 px glow of its tone; its sentence wraps.
- **Status item**: 22 px tall, 8 px padding, `--ag-radius-control`, a glyph at
  `--ag-icon-size-inline`. Success: the success colour as text. Warning and error: their colour as
  text on a 12 % fill with a 30 % edge. Recording: text primary on recording at 20 % with a 38 % edge,
  led by the recording LED (8 px, a 3 px ring at 25 %, a 10 px glow).
- **Tooltip**: overlay glass at 92 %, 5 px by 9 px padding (a text chip), `--ag-radius-control`,
  label size; its shortcut in key caps at 10 px. A rich variant (title and second line) at 8 px by
  10 px.
- **Hint**: an 18 px round button holding an (i) at `--ag-icon-size-inline` in text secondary; open,
  it turns accent on accent subtle and its popover holds the explanation a panel used to print.
- **Popover**: overlay glass, at most 320 px, padding one inset by a leading inset, text at label
  size in text secondary under a title at body size, 600, with its glyph; a reason popover's glyph is
  the warning colour.
- **Badge**: a pill, 1 px by 7 px padding (a text chip), caption size, 600, fill quiet and quiet
  edge; a tone badge takes its colour at 14 % with an edge at 35 %. **Status LED**: 7 px of its
  colour with an 8 px glow; idle: text disabled, no glow.

### Dock chrome

- **Splitter**: the gutter's width, invisible at rest. Under the pointer: a 2 px accent line the
  splitter's full length with a 10 px accent glow at 70 % opacity, pulsing at the full motion level.
  Dragged: the line and a grip (6 by 28 px, radius 3 px, on the overlay surface with an accent edge
  and glow) filled with the accent. Keyboard focus: the line in the focus colour with a 2 px ring at
  35 %.
- **Floating panel**: the floating level of [section 6](#surface-levels) with a breathing accent
  halo.
- **Drop targets** (owner's finding, 2026-10-17): a target is drawn as the group it would make. A
  compass of five targets (a 3 by 3 grid of 34 px cells, 5 px apart, 7 px padding, radius
  `--ag-radius-control` + 7 px) on overlay glass at 62 % with a 24 px blur and a 30 px accent glow.
  Each cell: fill quiet, quiet edge, a 22 px diagram of the group (frame 1.5 units at 70 %, the
  part the panel would take filled at 55 %, the tab line). The lit cell: `--ag-effect-cta-fill`
  with a top gloss, a white diagram with a 1 px drop shadow, and a 16 px accent glow.
- **Landing area**: where the panel would land, for the target under the pointer: a 1 px accent
  edge, accent at 26 %, a 24 px outer and 20 px inner accent glow, `--ag-radius-control`; the panel's
  name and glyph centred in it at caption size, 600, the glyph at `--ag-icon-size-feature`.
- **Tab slot**: where a dragged tab would enter a strip: 90 px by h, a dashed accent edge at 50 %
  on accent at 8 %.
- **Empty group**: base at 35 % with a dashed edge and an empty state.

### Hardware tokens

The materials of the hardware controls are fixed: metal is metal in both themes. They are a
`hardware` palette in `tokens/palette.ts`, built in OKLCH at the surface hue with chroma 0.004 to
0.01, and finished for contrast level like every palette; their printed parts (pointer, index line,
scale) are solved against the material they sit on.

### New tokens

| Token                           | Value                                              |
| ------------------------------- | -------------------------------------------------- |
| `--ag-hardware-metal-highlight` | L 0.95                                             |
| `--ag-hardware-metal-mid`       | L 0.70                                             |
| `--ag-hardware-metal-shade`     | L 0.38                                             |
| `--ag-hardware-chamfer-dark`    | L 0.30                                             |
| `--ag-hardware-chamfer-light`   | L 0.86                                             |
| `--ag-hardware-cutout`          | Black at 0.55 / 0.30                               |
| `--ag-hardware-cap-unlit`       | L 0.30 to L 0.13                                   |
| `--ag-hardware-led-off`         | L 0.30                                             |
| `--ag-hardware-gloss`           | White at 0.55                                      |
| `--ag-hardware-drop-shadow`     | `0 1.5px 1.5px` at 0.45 / `0 1.5px 2px` at 0.35    |
| `--ag-hardware-deep-shadow`     | The knob's and fader's two-layer shadow, per theme |
| `--ag-hardware-power-lit-cap`   | The accent mixed 50 % with L 0.22                  |
| `--ag-hardware-record-lit`      | The lamp's five lit stops, from the recording hue  |
| `--ag-hardware-record-unlit`    | The lamp's three unlit stops                       |
| `--ag-hardware-knob-size`       | 52 px / 44 px                                      |
| `--ag-hardware-switch-width`    | 38 px / 32 px                                      |
| `--ag-hardware-switch-height`   | 22 px / 20 px                                      |
| `--ag-hardware-meter-segment`   | 4 px (3 px vertical)                               |
| `--ag-hardware-meter-gap`       | 1 px                                               |
| `--ag-effect-token-wash`        | The template token's wash                          |

## 11. Panel composition

Every panel follows one pattern, so two panels showing the same kind of thing look alike.

1. **Header**: the tab strip in the panel's inset. The tab carries the panel's glyph and title; a
   sub-label may follow it; the panel's actions are full-size icon buttons at the trailing end.
2. **Toolbar** (where the panel has tools): one row in the inset under the header, grouped, with
   separators between groups; modes as toggled icon buttons or a tool group.
3. **Subject** (an inspector): a 36 px / 30 px glyph tile (accent on fill accent,
   `--ag-radius-control`), the subject's title at heading size and its scope as a chip.
4. **Sections**: stacked, each a hairline above a quiet header (label size, 600, a glyph at
   `--ag-icon-size-inline`, an optional summary and small actions), collapsible, holding a property
   grid, a list or a display. Advanced settings sit in a collapsed section, never removed
   (`REQ-UX-071`).
5. **Property grid** or **list** or **display**, built from the control set.
6. **Empty, loading and error states** in the body when there is nothing to show.

The body pads 0 at the top (the header already insets it) and one inset on the other sides, with
one inset between its parts. A display (the editing surface, a spectrogram, an equaliser graph)
sits one inset from the panel's sides with `--ag-radius-control` and a 1 px subtle edge, and
reaches the panel's bottom inset.

A dialogue follows the same pattern: a header (glyph in the accent, a terse title at heading size,
an optional segmented choice, a hint, the close button at the far end), a body two insets in, and a
footer whose leading side holds a status or reason and whose trailing side holds the buttons.

### Button order

The same everywhere (owner's finding, 2026-10-17): the safe action first, and a destructive action
last, at the trailing end, after Cancel or Keep. In a narrow dialogue an unavailable reason sits
above the buttons.

## 12. Visual richness

The owner chose direction C, Luminous, and asks for as much flair, glow and animation as the
application can carry within the motion levels: "lots of flashy visual flair fits this application
very well". A glow is never clipped: a control that glows has room round it to show the glow whole,
and a container that holds glowing controls does not clip its overflow (the transport's body is
`overflow: visible`, with room above and below the play button).

| Effect                     | Where                                                                      | Dark                     | Light                                  | Full     | Reduced                     | Off     |
| -------------------------- | -------------------------------------------------------------------------- | ------------------------ | -------------------------------------- | -------- | --------------------------- | ------- |
| Coloured backdrop          | The window                                                                 | Accent and rose glows    | The same over the light sunken surface | Still    | Still                       | Still   |
| Translucent glass and blur | Panels, overlays, banners, buttons                                         | Panel 62 %, overlay 66 % | Overlay 70 %                           | Present  | Present                     | Present |
| Gradients                  | Call to action, switch, check, slider, progress, compass target, swatches  | Present                  | Present                                | Present  | Present                     | Present |
| Lit from above             | Call to action, compass target, check                                      | Present                  | Present                                | Present  | Present                     | Present |
| Glows                      | Focus, selected cards, lit rows, play, LEDs, meters, value rings, playhead | Present                  | Present, softer by the token colours   | Present  | Present                     | Present |
| Breathing and pulsing      | Focus halo, floating halo, splitter, landing area, recording LED           |                          |                                        | Animated | Held at their resting value | Held    |
| Sheen and shimmer          | Progress, skeleton                                                         |                          |                                        | Animated | Opacity pulse in place      | Still   |
| Spring and grow            | Compass, landing area, notices, menus                                      |                          |                                        | Animated | Fade only                   | None    |
| Hardware realism           | Knob, fader, switches, lamps, meters                                       | Present                  | Deeper shadows                         | Present  | Present                     | Present |

The static effects (glass, gradients, glows) stay at every motion level: they are the language's
appearance, not motion. Only movement and change over time follow the level. No effect is a global
filter or opacity over the application (`REQ-UX-070`), and no effect may cost editing latency
(the WU-16.F measurement holds it).

**Swatches**: each accent the settings offer is a glass bead of its colour, 32 px: a soft specular
highlight (white at 34 % from the upper leading third), a light pooled at its foot, a body gradient
from accent hover to the accent to the accent mixed 75 % with black, an inset edge of white at 22 %,
an inset lower shade and a coloured drop shadow. The chosen one gains a 3 px gap ring, a 2 px ring
of its colour and a 22 px halo, and a white tick.

### New tokens

| Token                | Value                                        |
| -------------------- | -------------------------------------------- |
| `--ag-effect-swatch` | The glass bead's layers, computed per accent |

## 13. Text economy and writing

### Text economy

- A control is labelled in a word or two, or by an icon with an accessible name.
- An explanation is a hint behind an (i), a popover, an empty state or progressive disclosure,
  never a paragraph standing in a panel.
- Text economy never removes what a reader needs: the reason an action is unavailable (`ADR-0013`),
  an accessible name for every control, and every announcement stay, reached through the hint, the
  popover or the live region.
- An unavailable command keeps its reason: a menu or palette row shows it under its name when
  highlighted; a button keeps its focus and opens its reason on hover or focus; a standing
  explanation becomes a hint.

### Writing

- **Every word is natural British English**, written as a person would say it, plainly and kindly,
  with none of the tropes of machine writing: no hedging openers, no stacked adjectives, no
  "seamless", "effortless" or "powerful", no em dash as a flourish, no rhetorical triplets.
- **A dialogue's title is terse**, a few words such as "File already exists"; its explanation is
  body text, never the title.
- **Every label, value and control is one the application has**, in its own wording.
- **A value is never cut short**: where it does not fit, it wraps (`overflow-wrap: anywhere` for a
  long token or path). No value, summary or second line is truncated with an ellipsis. A list row's
  name may truncate only where its full text is in its accessible name and its tooltip.

## MotionSpec

`REQ-UX-222`: one motion system, not transitions each component chooses. This section states every
kind of motion of `REQ-UX-069`, every shell animation and every animated feedback, with what
animates, its tokens, and what it becomes at each level.

### The levels

| Level   | Stored value                               | What it means                                                                                                                              |
| ------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Full    | `full`                                     | The intended experience (`REQ-UX-069`): every animation in this section                                                                    |
| Reduced | `reduced`                                  | Only what helps a reader follow a change, without movement across the screen: opacity and colour, short and linear; no overshoot, no loops |
| Off     | `minimal` (labelled "Minimal" in Settings) | Nothing animates: every change is immediate                                                                                                |

`prefers-reduced-motion: reduce` selects Reduced until the user chooses a level (`resolveMotion`,
already in `tokens/preferences.ts`). A user who chooses Full while the system asks for less gets
Full. The theme writes the level as `data-ag-motion` on the theme root and the document element.

### Rules that hold at every level

- **Motion never delays input.** Direct manipulation (a selection drag, a fader, a knob, a slider,
  a zoom gesture, a scrub, a splitter, a tab drag) follows the pointer in the next frame with no
  easing and no transition on the property being dragged. A component names the properties it
  animates; no rule sets a duration for everything (`tokens.css`).
- **Meters follow their ballistics, not an easing.** They show the level the engine reports.
- **Nothing appears or leaves at once** at the full level (owner's finding, 2026-10-17).
- **An entering element eases out; a leaving one eases in; a moving one eases in and out.**
- **A loop runs only at the full level** and only while its element is visible.
- **A level that cannot reach a third-party animation disables that animation** rather than leaving
  it at full motion (Phase 16 failure behaviour).

### Motion tokens

Existing (`tokens/scale.ts`, `MotionScale`):

| Token                     | Full                             | Reduced  | Off      |
| ------------------------- | -------------------------------- | -------- | -------- |
| `--ag-motion-instant`     | 90 ms                            | 60 ms    | 0 ms     |
| `--ag-motion-quick`       | 160 ms                           | 90 ms    | 0 ms     |
| `--ag-motion-moderate`    | 240 ms                           | 120 ms   | 0 ms     |
| `--ag-motion-deliberate`  | 360 ms                           | 150 ms   | 0 ms     |
| `--ag-motion-ease-out`    | `cubic-bezier(0.16, 1, 0.3, 1)`  | `linear` | `linear` |
| `--ag-motion-ease-in`     | `cubic-bezier(0.7, 0, 0.84, 0)`  | `linear` | `linear` |
| `--ag-motion-ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | `linear` | `linear` |

New:

| Token                            | Full                                                                                                                                                                                         | Reduced  | Off      | Carries                                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------- | --------------------------------------------------------------------------------------------------- |
| `--ag-motion-ease-spring`        | `linear(0, 0.059 4%, 0.207 8%, 0.402 12%, 0.610 16%, 0.803 20%, 0.964 24%, 1.085 28%, 1.162 32%, 1.199 36%, 1.204 40%, 1.168 46%, 1.108 52%, 1.028 60%, 0.969 70%, 0.959 80%, 0.976 90%, 1)` | `linear` | `linear` | A damped spring (damping ratio 0.45): a 20 % overshoot at 40 % of the duration, settling by the end |
| `--ag-motion-loop-focus`         | 1.8 s                                                                                                                                                                                        |          |          | The focus halo's breath                                                                             |
| `--ag-motion-loop-float`         | 3.2 s                                                                                                                                                                                        |          |          | The floating panel's halo                                                                           |
| `--ag-motion-loop-splitter`      | 2.2 s                                                                                                                                                                                        |          |          | The splitter's pulse                                                                                |
| `--ag-motion-loop-landing`       | 2.5 s                                                                                                                                                                                        |          |          | The landing area's glow                                                                             |
| `--ag-motion-loop-recording`     | 1.6 s                                                                                                                                                                                        |          |          | The recording LED's breath                                                                          |
| `--ag-motion-loop-shimmer`       | 1.6 s                                                                                                                                                                                        |          |          | Skeleton shimmer and progress sheen                                                                 |
| `--ag-motion-loop-spinner`       | 0.8 s                                                                                                                                                                                        |          |          | One turn of a spinner                                                                               |
| `--ag-motion-loop-indeterminate` | 1.4 s                                                                                                                                                                                        |          |          | One pass of an indeterminate bar                                                                    |
| `--ag-motion-distance-small`     | 4 px                                                                                                                                                                                         | 0        | 0        | A menu's, popover's or list item's travel                                                           |
| `--ag-motion-distance-medium`    | 8 px                                                                                                                                                                                         | 0        | 0        | A dialogue's travel                                                                                 |
| `--ag-motion-distance-large`     | 16 px                                                                                                                                                                                        | 0        | 0        | A notice's travel                                                                                   |
| `--ag-motion-scale-overlay`      | 0.96                                                                                                                                                                                         | 1        | 1        | A menu's, popover's or select's starting scale                                                      |
| `--ag-motion-scale-dialogue`     | 0.98                                                                                                                                                                                         | 1        | 1        | A dialogue's or panel's starting scale                                                              |
| `--ag-motion-scale-spring`       | 0.82                                                                                                                                                                                         | 1        | 1        | The drop compass's starting scale                                                                   |

The loop tokens keep their value at every level; only `[data-ag-motion='full']` selects the
animations that use them. The distance and scale tokens are 0 and 1 below Full, so a rule written
once moves at Full and only fades at Reduced. The loop periods marked as recording, shimmer, spinner
and indeterminate are proposed here: the mock-ups do not animate them.

Meter ballistics (new group `ballistics`, read by the meter renderer; unchanged at every level,
because they are the meter's measurement, not an animation):

| Token                              | Value   | Meaning                                         |
| ---------------------------------- | ------- | ----------------------------------------------- |
| `--ag-ballistics-fall-rate`        | 20 dB/s | A level falls back at about 20 dB a second      |
| `--ag-ballistics-peak-hold`        | 1.2 s   | The peak hold waits, then falls                 |
| `--ag-ballistics-peak-fall-rate`   | 12 dB/s | The held peak's fall (0.6 of the level's)       |
| `--ag-ballistics-clip-hold`        | 1.5 s   | The clip LED stays lit after an over            |
| `--ag-ballistics-correlation-time` | 170 ms  | The correlation pointer's glide (time constant) |

A rise is immediate: a new peak is shown in the frame it arrives.

The typed `MotionScale` gains the same values, so a canvas renderer (the editor's zoom, the meters)
reads them through the design system rather than parsing CSS.

### The kinds of motion of REQ-UX-069

| Kind                         | What animates                                                                                                                                             | Duration and easing (Full)                                                                                               | Full                                                                                                                                                                                                                                                               | Reduced                                                                                                                                                                                                            | Off                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Dock and panel transitions   | A panel's group: opacity and scale on opening; its box's position and size when docked, floated or moved                                                  | Open `moderate`, `ease-out`; close `quick`, `ease-in`; move `moderate`, `ease-in-out`                                    | Opens from `--ag-motion-scale-dialogue` and transparent; closes to transparent at 0.98; a dock, float or move morphs the group's box from its old place to its new one (a view transition), and a floated group gains its shadow and starts its halo               | Cross-fade between the old and new layout, no geometry morph                                                                                                                                                       | Immediate                                                                                                                  |
| Menu and context transitions | Opacity, scale from the trigger's or pointer's origin, `--ag-motion-distance-small` of travel away from the trigger                                       | Open `quick`, `ease-out`; close `instant`, `ease-in`                                                                     | Grows from 0.96 at its origin while fading in; fades and shrinks slightly out                                                                                                                                                                                      | Opacity only                                                                                                                                                                                                       | Immediate                                                                                                                  |
| Zoom transitions             | The editor's visible time range (and frequency range in Spectral), drawn per frame                                                                        | `moderate`, `ease-in-out` (a zoom command: to selection, to fit, a step)                                                 | The range interpolates from the old to the new; the gesture itself (wheel, pinch, drag) is direct and never eased                                                                                                                                                  | The range changes at once and the region zoomed to is outlined, the outline fading over `deliberate`                                                                                                               | Immediate, no outline                                                                                                      |
| Drag-and-drop targets        | The compass: opacity and scale. The landing area: opacity and a clip from its target outward; its glow. The tab slot: width (Dockview's own tab shifting) | Compass in `deliberate`, `ease-spring`; out `quick`, `ease-in`. Landing `moderate`, `ease-out`. Slot `quick`, `ease-out` | The compass springs in from 0.82 and out to 0.92; the landing area grows out of its target and glows, its glow breathing on `loop-landing`; the slot opens; the dragged tab's source lifts (opacity 0.5); a drop settles the panel into place as a dock transition | Compass and landing area fade; the glow holds still; the slot appears at once                                                                                                                                      | Immediate                                                                                                                  |
| Meter movement               | The level, the peak hold, the clip LED, the correlation pointer                                                                                           | Ballistics tokens                                                                                                        | Rise at once, fall at 20 dB/s; hold 1.2 s, then fall at 12 dB/s; the clip LED lights at once, holds 1.5 s, then fades over `deliberate`; the correlation pointer glides with a 170 ms time constant; segments glow                                                 | The ballistics are unchanged; the clip LED's fade is `deliberate` at its reduced value (150 ms)                                                                                                                    | The ballistics are unchanged; the clip LED switches off without a fade                                                     |
| Selection feedback           | A row's lit edge and wash: opacity. An audio selection's handles: opacity. A card's glow: box shadow                                                      | `quick`, `ease-out`                                                                                                      | The wash and lit edge fade in as the row is chosen, and the edge sweeps from the leading side; a card's glow rises; an audio selection draws in the frame of the drag and its handles fade in on release                                                           | Fades, no sweep                                                                                                                                                                                                    | Immediate                                                                                                                  |
| Processor state changes      | The power LED and cap: opacity and colour; the card: opacity; the value rings and index lines: colour and glow                                            | LED `quick`, `ease-out`; card `moderate`, `ease-in-out`                                                                  | The LED lights through the lens and the spill grows; the card's controls light or dim with it                                                                                                                                                                      | Same properties, reduced durations                                                                                                                                                                                 | Immediate                                                                                                                  |
| Loading and progress         | A determinate bar's width; a sheen's position; an indeterminate segment's position; a spinner's rotation; a skeleton's shimmer                            | Width `moderate`, `ease-out`; loops on their tokens, `linear`                                                            | The bar grows to each new value; its sheen runs along it on `loop-shimmer`; an indeterminate segment passes on `loop-indeterminate`; a spinner turns on `loop-spinner`; a skeleton shimmers                                                                        | The bar steps to each value over the reduced `moderate`, `linear`; the indeterminate segment and skeleton pulse their opacity in place; a spinner turns at half speed (it moves in place, never across the screen) | The bar shows each value at once; the indeterminate segment and spinner stand still and the loading text carries the state |
| Workspace transitions        | The dock region: opacity and scale of the old and new workspaces; panels both workspaces share keep their identity and morph                              | `deliberate`, `ease-in-out`                                                                                              | A view transition: the old workspace fades and settles back to 0.99 while the new one fades in from 1.01; a panel both share morphs from its old box to its new one                                                                                                | A cross-fade over the reduced `deliberate` (150 ms), no scale, no morph                                                                                                                                            | Immediate                                                                                                                  |

### The shell animations

| Animation                  | What animates                                           | Duration and easing (Full)                        | Full                                                                      | Reduced                                                           | Off                                       |
| -------------------------- | ------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------- |
| Panel opening              | Opacity, scale                                          | `moderate`, `ease-out`                            | From 0.98 and transparent                                                 | Fade                                                              | Immediate                                 |
| Panel closing              | Opacity, scale                                          | `quick`, `ease-in`                                | To 0.98 and transparent, then removed                                     | Fade                                                              | Immediate                                 |
| Panel docking              | Box position and size                                   | `moderate`, `ease-in-out`                         | Morphs into its dock                                                      | Cross-fade                                                        | Immediate                                 |
| Panel floating             | Box position and size, shadow, halo                     | `moderate`, `ease-in-out`; halo `loop-float`      | Lifts out to its floating place, gains its shadow, then its halo breathes | Cross-fade; the halo holds at its resting value                   | Immediate; halo still                     |
| Menu opening               | Opacity, scale, travel                                  | `quick`, `ease-out`                               | As in menu transitions                                                    | Fade                                                              | Immediate                                 |
| Popover and select opening | Opacity, scale from the anchor, travel                  | `quick`, `ease-out`                               | Grows from 0.96 at its arrow                                              | Fade                                                              | Immediate                                 |
| Tooltip appearing          | Opacity, travel                                         | `instant`, `ease-out` after the platform delay    | Fades in rising 4 px                                                      | Fade                                                              | Immediate                                 |
| Dialogue entering          | Scrim opacity and blur; dialogue opacity, scale, travel | `moderate`, `ease-out`                            | The scrim fades in; the dialogue rises 8 px from 0.98                     | Both fade                                                         | Immediate                                 |
| Dialogue leaving           | The same, reversed                                      | `quick`, `ease-in`                                | Falls back 4 px and fades; the scrim fades                                | Both fade                                                         | Immediate                                 |
| Command palette            | As a dialogue                                           | As a dialogue                                     | As a dialogue                                                             | Fade                                                              | Immediate                                 |
| Workspace switching        | As workspace transitions                                | `deliberate`, `ease-in-out`                       | View transition                                                           | Cross-fade                                                        | Immediate                                 |
| Notice appearing           | Opacity, travel from the trailing edge, scale           | `moderate`, `ease-spring`                         | Slides 16 px in from the trailing edge from 0.98 and settles              | Fades                                                             | Immediate                                 |
| Notice leaving             | Opacity, travel, then the notices below close the gap   | `quick`, `ease-in`; gap `moderate`, `ease-in-out` | Slides out to the trailing edge and fades; the others move up             | Fades; the others move at once                                    | Immediate                                 |
| Notice time bar            | Width                                                   | Its timeout, `linear`                             | Runs down smoothly                                                        | Runs down smoothly: it shrinks in place and carries the time left | Steps once a second, without a transition |

### Animated feedback

| Feedback                                        | What animates                                                                          | Duration and easing (Full)                             | Full                                                                                                             | Reduced                                         | Off                 |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------- |
| Hover                                           | Background, colour, edge, glow                                                         | `instant`, `ease-out`                                  | The fill and glyph brighten                                                                                      | Same, reduced                                   | Immediate           |
| Press                                           | Background, the call to action's lighting                                              | `instant`, `ease-out`                                  | The fill deepens to `fill-press`; a call to action's gloss and top edge dim by half while held                   | Same, reduced                                   | Immediate           |
| State change (a switch, check, toggle, segment) | The bead's `translate`, the track's fill, the LED's opacity and glow, a segment's wash | `quick`, `ease-out`                                    | The bead slides and its LED lights; the track fills; a segment's wash moves to the chosen choice                 | Colour and opacity only; the bead moves at once | Immediate           |
| Selection appearing                             | As selection feedback                                                                  | `quick`, `ease-out`                                    | Fade and sweep                                                                                                   | Fade                                            | Immediate           |
| List item added                                 | Height (a grid row from 0 to its size), opacity, travel                                | `moderate`, `ease-out`                                 | The row opens its space and fades in from 4 px above                                                             | Fades in; its space opens at once               | Immediate           |
| List item removed                               | Opacity, then height                                                                   | `quick`, `ease-in`; height `moderate`, `ease-in-out`   | Fades out, then its space closes                                                                                 | Fades out; the space closes at once             | Immediate           |
| Progress and loading                            | As loading and progress                                                                |                                                        |                                                                                                                  |                                                 |                     |
| Meter                                           | As meter movement                                                                      | Ballistics                                             |                                                                                                                  |                                                 |                     |
| Recording indicator                             | The recording LED's glow and the record lamp's rim glow                                | `loop-recording`, `ease-in-out`                        | Breathes between its resting glow and 1.5 times it; the lamp's lens stays fully lit so recording never looks off | Steady, lit                                     | Steady, lit         |
| Playhead                                        | Its position, from the audio clock each frame                                          | None: it is drawn where the clock is                   | Drawn with its glow                                                                                              | Drawn with its glow                             | Drawn with its glow |
| Focus halo                                      | The halo's spread and glow                                                             | `loop-focus`, `ease-in-out`                            | Breathes                                                                                                         | Still halo                                      | Still halo          |
| Floating panel halo                             | The halo's ring and glow                                                               | `loop-float`, `ease-in-out`                            | Breathes from the accent ring at 22 % with a 30 px glow to 40 % with a 54 px glow                                | Still, at its resting value                     | Still               |
| Splitter pulse                                  | The line's glow                                                                        | `loop-splitter`, `ease-in-out`                         | Pulses under the pointer                                                                                         | Lit, still                                      | Lit, still          |
| Drop-target compass spring                      | Opacity, scale                                                                         | In `deliberate`, `ease-spring`; out `quick`, `ease-in` | Springs in and out                                                                                               | Fades                                           | Immediate           |

The mock-ups play the dock drag on a five-second loop to show it; the durations above are the
language's, from the tokens.

## Motion: CSS or a library, against ADR-0014

`ADR-0014` installs no animation library until a component imports one, carries the motion levels
by CSS transitions over the motion tokens, and keeps Motion for React for the first requirement CSS
cannot meet. Its amendment (`CHG-0002`) asks Phase 16 to decide, against the motion system it
designs, whether CSS meets `REQ-UX-222`.

### What the platform offers

| Mechanism                                                          | What it carries here                                                                                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| CSS transitions over the motion tokens                             | Hover, press, state change, selection feedback, processor state, determinate progress, the clip LED's fade, the notice time bar                  |
| CSS `@keyframes` animations                                        | The loops (focus, float, splitter, landing, recording, shimmer, spinner, indeterminate) and every Radix overlay's entry and exit                 |
| `linear()` easing                                                  | The spring of the compass and the notices, as `--ag-motion-ease-spring`; at Reduced the token is `linear`, so the overshoot goes with it         |
| `@starting-style`                                                  | Entry of anything that mounts: a panel's content, a list item, a notice, the compass, the landing area                                           |
| `transition-behavior: allow-discrete` with `display` and `overlay` | Exit of an element the application hides rather than unmounts: the compass, the landing area, a notice, an element in the top layer              |
| `@property` registration                                           | Animating a custom property that a gradient or shadow reads (the lit edge's sweep, a halo's strength), so it interpolates instead of jumping     |
| Grid rows from `0fr` to `1fr`                                      | A list item's or section's height opening and closing without measuring                                                                          |
| The View Transitions API (same document)                           | The workspace switch, and the dock, float, close and move of a panel, whose before and after are two layouts the docking engine builds           |
| The Web Animations API                                             | The few motions JavaScript must drive: a list item's exit before React removes it, and the close of a panel before the docking engine removes it |
| `requestAnimationFrame` with the typed `MotionScale`               | The editor's zoom transition and the meters, which are canvases                                                                                  |

### Row by row

Every row of MotionSpec is met by the mechanisms above:

- **Overlays** (menu, select, popover, tooltip, dialogue, palette) are Radix primitives behind the
  design system (`ADR-0009`). Radix keeps a closing element mounted until its CSS animation ends and
  ignores transitions, so their entry and exit are `@keyframes` on `[data-state='open']` and
  `[data-state='closed']`, with different animation names for entry and exit (Radix unmounts at once
  when the name does not change). Their origin is Radix's `--radix-popper-transform-origin`.
- **Panels opening** use `@starting-style` on the group's content. **Panels closing, docking,
  floating and moving** go through the workspace adapter: it wraps the docking engine's layout call
  in `document.startViewTransition()`, giving each group a `view-transition-name`, so the browser
  morphs each group's box from its old place to its new one, including one that leaves. The
  pseudo-elements take the motion tokens. `::view-transition` is set to `pointer-events: none`, so
  input reaches the live document while the transition draws.
- **The workspace switch** is a view transition over the dock region; a panel both workspaces share
  keeps its name and morphs.
- **List items**: entry by `@starting-style` and the grid row; exit by a design-system helper that
  keeps the removed row rendered in a closing state until its Web Animation finishes, then lets React
  remove it. The row window (`useRowWindow`) animates only rows it renders.
- **The zoom transition and the meters** are drawn on canvases, so no CSS or animation library
  reaches them: they interpolate per frame from the typed tokens, and the meters follow their
  ballistics.
- **Direct manipulation** has no transition on the property being dragged, in CSS or anywhere else.

Two things no mechanism can do, CSS or library: the image under the pointer while a tab is dragged
is the browser's native drag image (Dockview uses HTML drag and drop with `setDragImage`), which
cannot animate, so the "floating" of a dragged tab is given to its source tab and the landing area;
and a canvas cannot be animated by a stylesheet.

The one capability Motion for React adds that CSS lacks is an interruptible spring that inherits a
gesture's velocity. No row needs it: direct manipulation is never eased, and a drop settles from
rest.

### How the levels reach the docking engine

Dockview 8.3.1 animates with its own durations and easings, and has its own reduced-motion rule
keyed to the operating system rather than to the user's level. The workspace adapter's stylesheet
(`packages/workspace/src/styles/workspace.css`, the only place the engine is restyled, `ADR-0010`)
takes each over:

| Dockview's animation                                                                                | Its own value                                                                | The adapter's rule                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drop target anchor (`.dv-drop-target-container`, `.dv-drop-target-anchor`): position, size, opacity | `--dv-transition-duration` 300 ms on the container, `ease-in` and `ease-out` | `--dv-transition-duration: var(--ag-motion-moderate)` on the container, and `transition-timing-function` from the motion tokens                                                                                |
| Drop target (`.dv-drop-target`)                                                                     | 70 ms                                                                        | `var(--ag-motion-instant)`                                                                                                                                                                                     |
| Tab shifting, collapsing and expanding (`.dv-tab--shifting`, the group chip)                        | 200 ms default, `ease-out`                                                   | `var(--ag-motion-quick)` and `var(--ag-motion-ease-out)`                                                                                                                                                       |
| The active sash                                                                                     | `--dv-active-sash-transition-duration` and `-delay`                          | `var(--ag-motion-instant)`, no delay                                                                                                                                                                           |
| Its `prefers-reduced-motion` rule (`transition: none !important` on tabs)                           | Follows the system                                                           | At Full, a rule under `[data-ag-motion='full']` with `!important` restores the tab transitions, so a user who chose Full gets them; at Reduced the engine's tab movement stays off, which is what Reduced asks |
| Everything, at Off                                                                                  |                                                                              | The existing guard in `tokens.css` (`[data-ag-motion='minimal'] *`, durations 1 ms, one iteration)                                                                                                             |

A motion test reads each of these from the browser at each level (`getAnimations()` and the
computed transition values), as `REQ-UX-222` requires.

### Decision

**CSS suffices. `ADR-0014` stands.** CSS transitions and animations over the motion tokens, with
`linear()`, `@starting-style`, `transition-behavior: allow-discrete`, `@property`, the View
Transitions API and the Web Animations API, meet every row of MotionSpec at every level. All of
them are platform features: none adds a dependency, a licence or a supply-chain surface. A stylesheet
rule over `data-ag-motion` reaches the application's own animation, Radix's and Dockview's alike,
which a library's calls would not (the driver `ADR-0014` names). Motion for React is not installed,
because no row needs it.

WU-16.C records this outcome against `ADR-0014` in the phase evidence (Phase 16 evidence package:
"ADRs created or changed, including the outcome against `ADR-0014`"), and `ADR-0014` is not
superseded.

The browser matrix is Phase 14's. Where a browser lacks one of these features (an older engine
without view transitions or `@starting-style`), that motion falls back to its Reduced form, a fade,
or to none, never to a broken state; the screenshot suite captures with motion off in its pinned
Chromium.

## Token summary

| Section                                           | New tokens |
| ------------------------------------------------- | ---------- |
| 1. Layout grid                                    | 9          |
| 2. Type scale                                     | 25         |
| 3. Spacing and radius                             | 6          |
| 4. Icons                                          | 5          |
| 5. Colour                                         | 16         |
| 6. Elevation and panel chrome                     | 17         |
| 7. Focus and selection                            | 6          |
| 8. The presentation of audio                      | 9          |
| 9. Empty, loading and error states                | 3          |
| 10. The control set (hardware and the token wash) | 20         |
| 12. Visual richness                               | 1          |
| MotionSpec: motion                                | 15         |
| MotionSpec: ballistics                            | 5          |
| **Total**                                         | **137**    |

Existing tokens whose value changes or which retire are listed in each section's **Changed
tokens** table: 23 entries, besides the light branches of the waveform, selection, meter and
spectrogram palettes. Every value this document states that no token carries today is in one of
the **New tokens** tables.

## Values the owner confirms at sign-off

The mock-ups did not show these, so the language proposes them, and the owner confirms them when
the rendered surfaces and the motion recordings are signed off (`contracts/review-gates.md`):

- The loops the mock-ups do not animate (the recording LED, shimmer, the spinner and the
  indeterminate bar) and the press feedback.
- The values snapped to the 2 px grid and the icon sizes consolidated to five
  ([section 1](#values-snapped-to-the-grid), [section 4](#sizes)).
