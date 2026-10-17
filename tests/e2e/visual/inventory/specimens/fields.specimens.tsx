/**
 * The inventory's specimens of the fields and the overlays: the text field and
 * its template variant, the select, the menus, the menu bar, tooltips, rich
 * tooltips, popovers, hints and the modal dialogue, each in every state it has.
 *
 * A control is drawn by the component itself, its hover, focus and press forced
 * by the harness on the specimen's wrapper. A surface that floats over the page
 * once open (a menu, a list, a tooltip, a popover, a dialogue) is drawn open
 * and in place, as the markup its component renders with the classes that style
 * it, so every state can be seen at once on one page.
 */

import { useState, type ReactNode } from 'react';

import {
  Button,
  ButtonTone,
  DialogueVariant,
  Hint,
  HintTone,
  Icon,
  IconSize,
  type IconName,
  MenuBar,
  MenuBarMenu,
  OptionSelect,
  PopoverBody,
  PopoverTone,
  RichTooltipBody,
  RichTooltipTone,
  SegmentedControl,
  ShortcutKeys,
  TemplateText,
  type TemplateVocabulary,
  TextField,
} from '@audiogubbins/design-system';

import type { Specimen } from '../specimen.js';

/** The naming template's tokens, as the export naming describes them. */
const NAMING: TemplateVocabulary = {
  tokens: [
    { name: 'project', summary: 'The project’s name', description: <p>The project’s name.</p> },
    {
      name: 'asset',
      summary: 'The sound’s name',
      description: (
        <p>
          The name the sound has in the project. <TemplateText text="{asset:snake}" /> writes it in
          lower case, with an underscore between words.
        </p>
      ),
      examples: [
        <>
          “Footsteps take 2” gives <code>footsteps_take_2</code>.
        </>,
      ],
      modifiers: new Set(['snake', 'kebab', 'lower', 'upper', 'pascal']),
    },
    { name: 'region', summary: 'The region’s name', description: <p>The region’s name.</p> },
    { name: 'group', summary: 'The group’s name', description: <p>The group’s name.</p> },
    {
      name: 'number',
      summary: 'Its place in the group',
      description: (
        <>
          <p>Counts the sounds in the group from 1, so a sound keeps its number.</p>
          <ul>
            <li>
              <TemplateText text="{number}" /> pads with zeros to the digits the group needs
            </li>
            <li>
              <TemplateText text="{number:2}" /> always uses at least two digits
            </li>
          </ul>
        </>
      ),
      examples: [
        <>
          <TemplateText text="step_{number:3}" /> gives <code>step_007</code> for the seventh sound.
        </>,
      ],
      modifiers: new Set(['1', '2', '3', '4', '5', '6']),
    },
    { name: 'date', summary: 'The day you export', description: <p>The day you export.</p> },
  ],
  insertLabel: 'Insert a token',
  braceHelp: (
    <>
      To write a brace itself, type it twice: <TemplateText text="{{" /> gives {'{'}.
    </>
  ),
  explain: (problem) => ({
    title: 'Not a token',
    body: (
      <p>
        {problem.kind === 'lone-brace'
          ? 'A brace on its own opens or closes a token.'
          : 'The naming template names a token it doesn’t know.'}
      </p>
    ),
    example: <p>To write a brace itself, type it twice.</p>,
  }),
};

/** A text field that holds what is typed into it. */
function Field(props: {
  readonly initial: string;
  readonly label?: string;
  readonly placeholder?: string;
  readonly unit?: string;
  readonly error?: string;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly template?: boolean;
}): ReactNode {
  const [value, setValue] = useState(props.initial);
  return (
    <TextField
      label={props.label ?? 'Naming'}
      value={value}
      onValueChange={setValue}
      {...(props.placeholder === undefined ? {} : { placeholder: props.placeholder })}
      {...(props.unit === undefined ? {} : { unit: props.unit })}
      {...(props.error === undefined ? {} : { error: props.error })}
      {...(props.description === undefined ? {} : { description: props.description })}
      {...(props.disabled === undefined ? {} : { disabled: props.disabled })}
      {...(props.template === true ? { template: NAMING } : {})}
    />
  );
}

/** A select that holds its choice. */
function Select(props: {
  readonly disabled?: boolean;
  readonly icons?: boolean;
  readonly labelHidden?: boolean;
  readonly hinted?: boolean;
}): ReactNode {
  const [value, setValue] = useState('above');
  const icon = (name: IconName) => (props.icons === true ? { icon: name } : {});
  return (
    <OptionSelect
      label="Show"
      labelHidden={props.labelHidden ?? false}
      {...(props.hinted === true
        ? {
            description: {
              hintLabel: 'About the display',
              text: 'What the editor draws for the asset it shows.',
            },
          }
        : {})}
      value={value}
      onValueChange={setValue}
      disabled={props.disabled ?? false}
      options={[
        { value: 'waveform', label: 'Waveform', ...icon('waveform') },
        { value: 'spectrogram', label: 'Spectrogram', ...icon('spectrogram') },
        {
          value: 'above',
          label: 'Waveform above spectrogram',
          ...icon('waveform-above-spectrogram'),
        },
      ]}
    />
  );
}

/** One row of an open menu, as `menuItemContent` lays it out. */
interface Row {
  readonly label: string;
  readonly icon?: IconName;
  readonly shortcut?: string;
  readonly reason?: string;
  readonly highlighted?: boolean;
}

/** An open menu drawn in place: rows, a group's name and separators. */
function OpenMenu({
  groups,
}: {
  readonly groups: readonly { readonly label?: string; readonly rows: readonly Row[] }[];
}): ReactNode {
  const glyphs = groups.some((group) => group.rows.some((row) => row.icon !== undefined));
  return (
    <div
      className="ag-menu"
      role="menu"
      aria-label="Edit"
      {...(glyphs ? { 'data-ag-glyphs': '' } : {})}
    >
      {groups.flatMap((group, index) => [
        ...(index > 0
          ? [<div key={`sep-${String(index)}`} className="ag-menu-separator" role="separator" />]
          : []),
        ...(group.label === undefined
          ? []
          : [
              <div key={`label-${String(index)}`} className="ag-menu-label">
                {group.label}
              </div>,
            ]),
        ...group.rows.map((row) => (
          <div
            key={row.label}
            role="menuitem"
            className="ag-menu-item ag-lit-row"
            {...(row.highlighted === true ? { 'data-highlighted': '' } : {})}
            {...(row.reason === undefined
              ? {}
              : { 'aria-disabled': true, 'data-ag-unavailable': '' })}
          >
            {glyphs &&
              (row.icon === undefined ? (
                <span className="ag-menu-item-glyph" aria-hidden="true" />
              ) : (
                <Icon name={row.icon} className="ag-menu-item-glyph" />
              ))}
            <span className="ag-menu-item-label">{row.label}</span>
            {row.shortcut !== undefined && (
              <ShortcutKeys shortcut={row.shortcut} className="ag-menu-item-shortcut" />
            )}
            {row.reason !== undefined && <span className="ag-menu-item-reason">{row.reason}</span>}
          </div>
        )),
      ])}
    </div>
  );
}

/** The Edit menu, with the keyboard on `on`. */
function editMenu(on: string): ReactNode {
  const row = (label: string, rest: Omit<Row, 'label'>): Row => ({
    label,
    ...rest,
    ...(label === on ? { highlighted: true } : {}),
  });
  return (
    <OpenMenu
      groups={[
        {
          rows: [
            row('Undo Trim to 0:09.200', { icon: 'undo', shortcut: 'Ctrl+Z' }),
            row('Redo', { icon: 'redo', shortcut: 'Ctrl+Y', reason: 'There is nothing to redo.' }),
          ],
        },
        {
          label: 'Clipboard',
          rows: [
            row('Cut', { icon: 'cut', shortcut: 'Ctrl+X' }),
            row('Copy', { icon: 'copy', shortcut: 'Ctrl+C' }),
            row('Paste', { icon: 'paste', shortcut: 'Ctrl+V' }),
          ],
        },
        {
          label: 'Level',
          rows: [row('Fade in', { icon: 'fade-in' }), row('Fade out', { icon: 'fade-out' })],
        },
      ]}
    />
  );
}

/** A template field's highlighting with one token under the pointer, as the editor draws it. */
function hoveredTemplate(text: readonly ReactNode[]): ReactNode {
  return (
    <div className="ag-text-field">
      <span className="ag-text-field-label">Naming</span>
      <div className="ag-text-field-box">
        <div className="ag-template-editor">
          <span className="ag-template-mirror">
            <span className="ag-template-mirror-text">{text}</span>
          </span>
          <input className="ag-text-field-input" aria-label="Naming" readOnly value="" />
        </div>
        <span className="ag-template-tokens-button">
          <Button tone={ButtonTone.Quiet} compact iconOnly label="Insert a token">
            <Icon name="insert-token" />
          </Button>
        </span>
      </div>
    </div>
  );
}

/** A dialogue drawn open in place, rather than fixed over the page. */
const IN_PLACE = {
  position: 'relative',
  insetBlockStart: 'auto',
  insetInlineStart: 'auto',
  translate: 'none',
} as const;

/** Does nothing: a specimen's controls are drawn, not used. */
const noop = (): void => undefined;

/** What a dialogue drawn in place shows: the markup `ModalDialog` renders. */
interface DialogueInPlaceProps {
  readonly variant: DialogueVariant;
  readonly title: string;
  readonly icon: IconName;
  readonly hint?: ReactNode;
  readonly headerControls?: ReactNode;
  readonly status?: ReactNode;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}

/** A dialogue of a drawn head, open in place. */
function DialogueInPlace({
  variant,
  title,
  icon,
  hint,
  headerControls,
  status,
  actions,
  children,
}: DialogueInPlaceProps) {
  return (
    <div
      className="ag-dialog"
      role="dialog"
      aria-label={title}
      data-ag-variant={variant}
      style={IN_PLACE}
    >
      <header className="ag-dialog-header">
        <div className="ag-dialog-heading">
          <Icon name={icon} />
          <h2 className="ag-dialog-title">{title}</h2>
          {hint}
        </div>
        {headerControls !== undefined && (
          <div className="ag-dialog-header-controls">{headerControls}</div>
        )}
        <Button tone={ButtonTone.Quiet} iconOnly label="Close">
          <Icon name="close" />
        </Button>
      </header>
      <div className="ag-dialog-scroll">{children}</div>
      <div className="ag-dialog-footer">
        {status !== undefined && <div className="ag-dialog-status">{status}</div>}
        {actions !== undefined && <div className="ag-dialog-actions">{actions}</div>}
      </div>
    </div>
  );
}

const PROJECT_SECTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'new', label: 'New' },
  { value: 'this', label: 'This project' },
  { value: 'import', label: 'Import' },
] as const;

/** Projects: the wide dialogue, its sections chosen in its header beside an (i). */
function ProjectsInPlace() {
  const [section, setSection] = useState<string>('open');
  return (
    <DialogueInPlace
      variant={DialogueVariant.Wide}
      title="Projects"
      icon="open-project"
      hint={
        <Hint label="About projects">
          <p>Make, open and bring in projects, and look after the one open.</p>
        </Hint>
      }
      headerControls={
        <SegmentedControl
          label="Section"
          small
          value={section}
          options={PROJECT_SECTIONS}
          onValueChange={setSection}
        />
      }
      actions={<Button tone={ButtonTone.Primary}>Open</Button>}
    >
      <p className="ag-dialog-description">Choose a project to open.</p>
    </DialogueInPlace>
  );
}

const specimens: readonly Specimen[] = [
  // The text field.
  {
    component: 'TextField',
    state: 'default',
    render: () => <Field label="Folder" initial="audio" />,
  },
  {
    component: 'TextField',
    state: 'placeholder',
    render: () => <Field label="New group" initial="" placeholder="Footsteps/Gravel" />,
  },
  {
    component: 'TextField',
    state: 'hover',
    render: () => <Field label="Folder" initial="audio" />,
  },
  {
    component: 'TextField',
    state: 'active',
    render: () => <Field label="Folder" initial="audio" />,
  },
  {
    component: 'TextField',
    state: 'focus-visible',
    render: () => <Field label="Folder" initial="audio" />,
  },
  {
    component: 'TextField',
    state: 'unit',
    render: () => <Field label="Lead-in" initial="10" unit="ms" />,
  },
  {
    component: 'TextField',
    state: 'description',
    render: () => (
      <Field label="Folder" initial="audio" description="Where the files go, inside the export." />
    ),
  },
  {
    component: 'TextField',
    state: 'description behind a hint',
    render: () => (
      <TextField
        label="Folder"
        description={{
          hintLabel: 'About the folder',
          text: 'Where the files go, inside the export.',
        }}
        value="audio"
        onValueChange={noop}
      />
    ),
  },
  {
    component: 'TextField',
    state: 'label hidden',
    render: () => <TextField label="Search commands" labelHidden value="" onValueChange={noop} />,
  },
  {
    component: 'TextField',
    state: 'error',
    render: () => (
      <Field label="Lead-in" initial="-4" unit="ms" error="A lead-in can’t be less than 0 ms." />
    ),
  },
  {
    component: 'TextField',
    state: 'disabled',
    render: () => <Field label="Folder" initial="audio" disabled />,
  },

  // The template field.
  {
    component: 'TextField',
    state: 'template',
    render: () => <Field initial="{asset:snake}_{number:2}" template />,
  },
  {
    component: 'TextField',
    state: 'template-unknown-token',
    render: () => <Field initial="{group:snake}_{take:2}" template />,
  },
  {
    component: 'TextField',
    state: 'template-literal-brace',
    render: () => <Field initial="{asset:snake}_{{v2}}" template />,
  },
  {
    component: 'TextField',
    state: 'template-focus-visible',
    render: () => <Field initial="{asset:snake}_{number:2}" template />,
  },
  {
    component: 'TextField',
    state: 'template-error',
    render: () => (
      <Field
        initial="{group:snake}_{take:2}"
        template
        error="The naming template names {take}, which isn’t one of its tokens."
      />
    ),
  },
  {
    component: 'TextField',
    state: 'template-disabled',
    render: () => <Field initial="{asset:snake}_{number:2}" template disabled />,
  },
  {
    component: 'TextField',
    state: 'template-token-hovered',
    render: () =>
      hoveredTemplate([
        <span key="a" className="ag-template-token" data-ag-hovered="">
          {'{asset'}
          <span className="ag-template-modifier">:snake</span>
          {'}'}
        </span>,
        '_',
        <span
          key="b"
          className="ag-template-token"
          data-ag-problem="unknown-token"
          data-ag-hovered=""
        >
          {'{take'}
          <span className="ag-template-modifier">:2</span>
          {'}'}
        </span>,
      ]),
  },
  {
    component: 'TextField',
    state: 'template-token-list',
    render: () => (
      <div className="ag-token-menu">
        <div className="ag-menu ag-token-list" role="menu" aria-label="Insert a token">
          {NAMING.tokens.map((token) => (
            <div
              key={token.name}
              role="menuitem"
              className="ag-menu-item ag-token-row ag-lit-row"
              {...(token.name === 'number' ? { 'data-highlighted': '' } : {})}
            >
              <span className="ag-menu-item-label">
                <TemplateText text={`{${token.name}}`} />
              </span>
              <span className="ag-token-row-summary">{token.summary}</span>
            </div>
          ))}
          <div className="ag-token-list-footer">{NAMING.braceHelp}</div>
        </div>
        <div className="ag-rich-tooltip ag-token-tip" data-ag-tone={RichTooltipTone.Plain}>
          <RichTooltipBody
            title="Its place in the group"
            example={<p>{NAMING.tokens[4]?.examples?.[0]}</p>}
          >
            {NAMING.tokens[4]?.description}
          </RichTooltipBody>
        </div>
      </div>
    ),
  },

  // The select.
  { component: 'OptionSelect', state: 'default', render: () => <Select /> },
  { component: 'OptionSelect', state: 'hover', render: () => <Select /> },
  { component: 'OptionSelect', state: 'active', render: () => <Select /> },
  { component: 'OptionSelect', state: 'focus-visible', render: () => <Select /> },
  { component: 'OptionSelect', state: 'pressed', render: () => <Select icons /> },
  { component: 'OptionSelect', state: 'disabled', render: () => <Select disabled /> },
  { component: 'OptionSelect', state: 'icons', render: () => <Select icons /> },
  { component: 'OptionSelect', state: 'label hidden', render: () => <Select labelHidden /> },
  {
    component: 'OptionSelect',
    state: 'description behind a hint',
    render: () => <Select hinted />,
  },
  {
    component: 'OptionSelect',
    state: 'open-list',
    render: () => (
      <div className="ag-select-content" role="listbox" aria-label="Show" data-ag-glyphs="">
        <div className="ag-select-viewport">
          {(
            [
              ['waveform', 'Waveform', false, false],
              ['spectrogram', 'Spectrogram', true, false],
              ['waveform-above-spectrogram', 'Waveform above spectrogram', false, true],
              ['waveform-over-spectrogram', 'Waveform over spectrogram', false, false],
            ] as const
          ).map(([icon, label, highlighted, chosen]) => (
            <div
              key={icon}
              role="option"
              aria-selected={chosen}
              className="ag-select-item ag-lit-row"
              {...(highlighted ? { 'data-highlighted': '' } : {})}
            >
              <Icon name={icon} className="ag-menu-item-glyph" />
              <span className="ag-select-item-text">{label}</span>
              {chosen && (
                <span className="ag-select-indicator">
                  <Icon name="checked" />
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    ),
  },

  // Menus and context menus.
  { component: 'Menu', state: 'open', render: () => editMenu('') },
  { component: 'Menu', state: 'highlighted', render: () => editMenu('Copy') },
  { component: 'Menu', state: 'unavailable-highlighted', render: () => editMenu('Redo') },
  {
    component: 'ContextActions',
    state: 'open',
    render: () => (
      <OpenMenu
        groups={[
          {
            rows: [
              { label: 'Play', icon: 'play', highlighted: true },
              { label: 'Add a marker at the playhead', icon: 'add-marker', shortcut: 'M' },
              {
                label: 'Remove the selected markers',
                icon: 'remove-markers',
                reason: 'No marker is selected.',
              },
            ],
          },
          {
            rows: [
              { label: 'Zoom in', icon: 'zoom-in', shortcut: '↑' },
              { label: 'Zoom to the selection', icon: 'zoom-to-selection', shortcut: 'Shift+F' },
              { label: 'Select all', icon: 'select-all', shortcut: 'Ctrl+K, Ctrl+A' },
            ],
          },
        ]}
      />
    ),
  },

  // The menu bar.
  ...(['default', 'hover', 'active', 'focus-visible', 'pressed'] as const).map(
    (state): Specimen => ({
      component: 'MenuBar',
      state,
      render: () => (
        <MenuBar label="Main menu">
          <MenuBarMenu
            label="Edit"
            groups={[
              { key: 'edit', items: [{ key: 'undo', label: 'Undo', onSelect: () => undefined }] },
            ]}
          />
        </MenuBar>
      ),
    }),
  ),
  {
    component: 'MenuBar',
    state: 'open',
    render: () => (
      <div className="ag-menu-bar-root" role="menubar" aria-label="Main menu">
        <button type="button" role="menuitem" className="ag-menu-bar-trigger">
          File
        </button>
        <button type="button" role="menuitem" className="ag-menu-bar-trigger" data-state="open">
          Edit
        </button>
        <button type="button" role="menuitem" className="ag-menu-bar-trigger">
          View
        </button>
      </div>
    ),
  },

  // Tooltips.
  {
    component: 'Tooltip',
    state: 'default',
    render: () => (
      <div className="ag-tooltip" role="tooltip">
        <span className="ag-tooltip-name">Zoom to fit</span>
        <ShortcutKeys shortcut="F" className="ag-tooltip-shortcut" />
      </div>
    ),
  },
  {
    component: 'Tooltip',
    state: 'rich',
    render: () => (
      <div className="ag-tooltip" role="tooltip" data-ag-rich="">
        <span className="ag-tooltip-text">
          <span className="ag-tooltip-name">Hand</span>
          <span className="ag-tooltip-detail">Drags the view along the timeline.</span>
        </span>
        <ShortcutKeys shortcut="H" className="ag-tooltip-shortcut" />
      </div>
    ),
  },
  {
    component: 'Tooltip',
    state: 'chord',
    render: () => (
      <div className="ag-tooltip" role="tooltip">
        <span className="ag-tooltip-name">Run a command</span>
        <ShortcutKeys shortcut="Ctrl+K, P" className="ag-tooltip-shortcut" />
      </div>
    ),
  },
  {
    component: 'RichTooltip',
    state: 'default',
    render: () => (
      <div className="ag-rich-tooltip" data-ag-tone={RichTooltipTone.Plain} role="tooltip">
        <RichTooltipBody title="The sound’s name" example={NAMING.tokens[1]?.examples?.[0]}>
          {NAMING.tokens[1]?.description}
        </RichTooltipBody>
      </div>
    ),
  },
  {
    component: 'RichTooltip',
    state: 'danger',
    render: () => (
      <div className="ag-rich-tooltip" data-ag-tone={RichTooltipTone.Danger} role="tooltip">
        <RichTooltipBody
          title="Not a token"
          icon="field-error"
          example={
            <p>
              To write a brace itself, type it twice: <TemplateText text="{{" /> gives {'{'}.
            </p>
          }
        >
          <p>
            The naming template names <TemplateText text="{take}" tokens={NAMING.tokens} />, which
            isn’t one of <TemplateText text="{project}, {asset}, {region}, {group}, {number}" /> and{' '}
            <TemplateText text="{date}" />.
          </p>
        </RichTooltipBody>
      </div>
    ),
  },

  // Popovers and hints.
  {
    component: 'InfoPopover',
    state: 'default',
    render: () => (
      <div
        className="ag-popover"
        role="dialog"
        aria-label="Monitoring"
        data-ag-tone={PopoverTone.Plain}
      >
        <PopoverBody title="Monitoring" icon="monitoring">
          <p>What is monitored is never recorded: the recording is the dry input.</p>
        </PopoverBody>
      </div>
    ),
  },
  {
    component: 'InfoPopover',
    state: 'reason',
    render: () => (
      <div className="ag-popover" role="dialog" aria-label="Play" data-ag-tone={PopoverTone.Reason}>
        <PopoverBody title="Play is unavailable" icon="unavailable">
          <p>No editor view shows an asset. Open one from an Editor panel first.</p>
        </PopoverBody>
      </div>
    ),
  },
  ...[HintTone.Warning, HintTone.Error].flatMap((tone): Specimen[] =>
    (['default', 'hover', 'pressed'] as const).map((state) => ({
      component: `Hint (${tone})`,
      state,
      render: () => (
        <Hint label="About the seam" title="The seam clicks" tone={tone}>
          <p>The waveform jumps where the loop starts again.</p>
        </Hint>
      ),
    })),
  ),
  ...[PopoverTone.Warning, PopoverTone.Error].map((tone): Specimen => ({
    component: 'InfoPopover',
    state: tone,
    render: () => (
      <div className="ag-popover" role="dialog" aria-label="The seam" data-ag-tone={tone}>
        <PopoverBody
          title={tone === PopoverTone.Error ? 'The loop could not be checked' : 'The seam clicks'}
          icon={tone === PopoverTone.Error ? 'error' : 'warning'}
        >
          <p>The waveform jumps where the loop starts again.</p>
        </PopoverBody>
      </div>
    ),
  })),
  ...(['default', 'hover', 'focus-visible', 'pressed'] as const).map((state): Specimen => ({
    component: 'Hint',
    state,
    render: () => (
      <Hint label="About monitoring" title="Monitoring">
        <p>What is monitored is never recorded.</p>
      </Hint>
    ),
  })),

  // The modal dialogue, one specimen per kind, each at its own width.
  {
    component: 'ModalDialog',
    state: 'open',
    render: () => (
      <DialogueInPlace
        variant={DialogueVariant.Standard}
        title="File already exists"
        icon="warning"
        status={
          <>
            <Icon name="information" size={IconSize.Inline} />
            Nothing has been written yet.
          </>
        }
        actions={
          <>
            <Button>Cancel</Button>
            <Button tone={ButtonTone.Primary}>Keep both</Button>
            <Button tone={ButtonTone.Destructive}>Replace</Button>
          </>
        }
      >
        <p className="ag-dialog-description">
          There’s already a file called “door_slam_03.wav” in the audio folder.
        </p>
        <div className="ag-dialog-body">
          <p>You can keep both, or replace the one that’s there.</p>
        </div>
      </DialogueInPlace>
    ),
  },
  {
    component: 'ModalDialog',
    state: 'sections and hint',
    render: () => <ProjectsInPlace />,
  },
  {
    component: 'ModalDialog',
    state: 'narrow',
    render: () => (
      <DialogueInPlace
        variant={DialogueVariant.Narrow}
        title="Exporting"
        icon="export"
        actions={<Button>Cancel</Button>}
      >
        <p className="ag-dialog-description">Writing “door_slam_03.wav” to the audio folder.</p>
      </DialogueInPlace>
    ),
  },
  {
    component: 'ModalDialog',
    state: 'palette',
    render: () => (
      <div
        className="ag-dialog"
        role="dialog"
        aria-label="Run a command"
        data-ag-variant={DialogueVariant.Palette}
        style={IN_PLACE}
      >
        <div className="ag-dialog-scroll">
          <div className="ag-dialog-body">
            <TextField label="Search commands" labelHidden value="fade" onValueChange={noop} />
          </div>
        </div>
        <div className="ag-dialog-footer">
          <div className="ag-dialog-status">
            <ShortcutKeys shortcut="Enter" /> run
          </div>
        </div>
      </div>
    ),
  },
  {
    component: 'ModalDialog',
    state: 'scrim',
    // Over a field, so the blur it lays over the page shows.
    render: () => (
      <div style={{ position: 'relative' }}>
        <Field label="Folder" initial="audio" />
        <div className="ag-dialog-overlay" style={{ position: 'absolute' }} />
      </div>
    ),
  },
];

export default specimens;
