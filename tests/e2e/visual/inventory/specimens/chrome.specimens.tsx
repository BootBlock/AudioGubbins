/**
 * The chrome around content, in every state it has: tabs, the panel and its
 * header, sections, property grids, source chips, lists, tables and verdicts,
 * badges, status chips and key caps, the empty, loading and error states,
 * spinners and progress bars, notices and banners.
 *
 * The harness draws each in both themes and both densities and forces the
 * hover, focus-visible and pressed states on the specimen's wrapper. Every
 * word is one the application says, in its own wording.
 */

import {
  Badge,
  Banner,
  Button,
  ButtonTone,
  EmptyState,
  Icon,
  KeyCap,
  List,
  ListRow,
  Notice,
  Panel,
  PanelHeader,
  ProgressBar,
  PropertyGrid,
  Section,
  Skeleton,
  SourceChip,
  Spinner,
  StatusChip,
  TabSet,
  Table,
  Verdict,
  type PropertyRow,
  type TabDescriptor,
  type TableColumn,
  type TableRow,
} from '@audiogubbins/design-system';
import type { ReactNode } from 'react';

import type { Specimen } from '../specimen.js';

/** Does nothing: a specimen's controls are drawn, not used. */
const ignore = (): void => undefined;

const TABS: readonly TabDescriptor[] = [
  { value: 'appearance', label: 'Appearance', content: <p>Theme, accent and density.</p> },
  { value: 'accessibility', label: 'Accessibility', content: <p>Motion and contrast.</p> },
  { value: 'shortcuts', label: 'Shortcuts', content: <p>Keys for every command.</p> },
];

const TABS_WITH_GLYPHS: readonly TabDescriptor[] = [
  {
    value: 'appearance',
    label: 'Appearance',
    icon: 'appearance',
    content: <p>Theme, accent and density.</p>,
  },
  {
    value: 'accessibility',
    label: 'Accessibility',
    icon: 'accessibility',
    content: <p>Motion and contrast.</p>,
  },
  {
    value: 'shortcuts',
    label: 'Shortcuts',
    icon: 'shortcuts',
    content: <p>Keys for every command.</p>,
  },
];

/** A tab set with Appearance chosen. */
function tabs(set: readonly TabDescriptor[] = TABS): ReactNode {
  return <TabSet label="Settings" value="appearance" onValueChange={ignore} tabs={set} />;
}

/** A full-size header action. */
function action(icon: 'more' | 'import-audio' | 'import-folder', label: string): ReactNode {
  return (
    <Button tone={ButtonTone.Quiet} iconOnly label={label}>
      <Icon name={icon} />
    </Button>
  );
}

const ASSET_ROWS: readonly PropertyRow[] = [
  { id: 'kept', label: 'Kept', value: 'Copied into the project' },
  { id: 'format', label: 'Format', value: 'WAV, 24-bit' },
  { id: 'rate', label: 'Sample rate', value: '48,000 Hz' },
  { id: 'channels', label: 'Channels', value: 'Stereo' },
  { id: 'duration', label: 'Duration', value: '0:10.000' },
];

const POLICY_ROWS: readonly PropertyRow[] = [
  {
    id: 'processing',
    label: 'Processing',
    value: 'Filter, then Loudness normalisation, then Limiter',
    source: { kind: 'set', label: 'Set on this group' },
  },
  {
    id: 'loudness',
    label: 'Loudness target',
    value: '−16 LUFS within 1 LU',
    source: { kind: 'inherited', label: 'Inherited from Footsteps' },
  },
  {
    id: 'emitter',
    label: 'Emitter rules',
    value: 'The preview plays it by the default rules.',
    source: { kind: 'unset', label: 'Not set' },
  },
];

const LONG_ROWS: readonly PropertyRow[] = [
  {
    id: 'folder',
    label: 'Destination folder',
    value: 'sfx/footsteps/gravel/outdoor_loose_stones_and_wet_shingle_by_the_harbour_wall',
  },
  {
    id: 'voice',
    label: 'Voice variation',
    value: 'Pitch −50 to 50 cents, gain −1.5 to 1.5 dB, start up to 20 ms in',
  },
];

const MEMBER_COLUMNS: readonly TableColumn[] = [
  { id: 'name', header: 'Name' },
  { id: 'length', header: 'Length', kind: 'numeric' },
  { id: 'peak', header: 'Peak', kind: 'numeric' },
  { id: 'check', header: 'Loudness', kind: 'verdict' },
];

const MEMBER_ROWS: readonly TableRow[] = [
  {
    id: 'gravel-01',
    cells: {
      name: 'gravel_01',
      length: '0:00.412',
      peak: '−1.2 dB',
      check: <Verdict kind="passes">−16.2 LUFS</Verdict>,
    },
  },
  {
    id: 'gravel-02',
    cells: {
      name: 'gravel_02',
      length: '0:00.388',
      peak: '−0.4 dB',
      check: <Verdict kind="warns">−14.9 LUFS, louder than the target by 1.1 LU</Verdict>,
    },
  },
  {
    id: 'gravel-03',
    cells: {
      name: 'gravel_03',
      length: '0:00.451',
      peak: '0.0 dB',
      check: <Verdict kind="fails">Clipped: 12 samples at full scale</Verdict>,
    },
  },
  {
    id: 'gravel-04',
    cells: {
      name: 'gravel_04',
      length: '0:00.402',
      peak: '−2.0 dB',
      check: <Verdict kind="running">Measuring</Verdict>,
    },
  },
  {
    id: 'gravel-05',
    cells: {
      name: 'gravel_05',
      length: '0:00.397',
      peak: '−1.8 dB',
      check: <Verdict kind="none">Not measured</Verdict>,
    },
  },
];

/** A panel holding `body` under the Assets header. */
function assetsPanel(body: ReactNode): ReactNode {
  return (
    <Panel
      header={
        <PanelHeader
          title="Assets"
          icon="assets"
          actions={
            <>
              {action('import-audio', 'Import audio')}
              {action('import-folder', 'Import a folder')}
              {action('more', 'More')}
            </>
          }
        />
      }
    >
      {body}
    </Panel>
  );
}

const specimens: readonly Specimen[] = [
  // Tabs.
  { component: 'TabSet', state: 'default', render: () => tabs() },
  { component: 'TabSet', state: 'with glyphs', render: () => tabs(TABS_WITH_GLYPHS) },
  { component: 'TabSet', state: 'hover', render: () => tabs(TABS_WITH_GLYPHS) },
  { component: 'TabSet', state: 'focus-visible', render: () => tabs(TABS_WITH_GLYPHS) },
  { component: 'TabSet', state: 'pressed', render: () => tabs(TABS_WITH_GLYPHS) },

  // The panel header and the panel.
  {
    component: 'PanelHeader',
    state: 'default',
    render: () => <PanelHeader title="History" icon="history" />,
  },
  {
    component: 'PanelHeader',
    state: 'with a sub-line and actions',
    render: () => (
      <PanelHeader
        title="Effects rack"
        icon="effects-rack"
        subLabel="4 processors, 1 parallel group"
        actions={action('more', 'More')}
      />
    ),
  },
  {
    component: 'PanelHeader',
    state: 'with a long sub-line',
    render: () => (
      <PanelHeader
        title="Recorder"
        icon="recorder"
        subLabel="Take 4 of “Harbour ambience”, heard on USB microphone"
        actions={action('more', 'More')}
      />
    ),
  },
  {
    component: 'Panel',
    state: 'default',
    render: () => (
      <Panel
        header={<PanelHeader title="Inspector" icon="inspector" actions={action('more', 'More')} />}
      >
        <Section title="Asset" summary="Tone bursts">
          <PropertyGrid rows={ASSET_ROWS} />
        </Section>
        <Section title="File metadata" summary="2 entries" defaultOpen={false}>
          <PropertyGrid rows={ASSET_ROWS.slice(0, 2)} />
        </Section>
      </Panel>
    ),
  },
  {
    component: 'Panel',
    state: 'without a header',
    render: () => (
      <Panel>
        <PropertyGrid rows={ASSET_ROWS} />
      </Panel>
    ),
  },
  {
    component: 'Panel',
    state: 'empty',
    render: () =>
      assetsPanel(
        <EmptyState
          icon="waveform"
          title="No audio yet"
          text="Import audio files to add some."
          actions={
            <>
              <Button tone={ButtonTone.Primary}>Import audio…</Button>
              <Button>Folder…</Button>
            </>
          }
        />,
      ),
  },
  {
    component: 'Panel',
    state: 'loading',
    render: () =>
      assetsPanel(<Skeleton label="Loading the assets" lines={[1, 0.7, 0.85, 0.5, 0.75]} />),
  },
  {
    component: 'Panel',
    state: 'error',
    render: () =>
      assetsPanel(
        <EmptyState
          tone="error"
          icon="waveform"
          title="The waveform could not be made"
          text="The decoder stopped at 0:01.2: the file ends early."
          actions={<Button>Try again</Button>}
        />,
      ),
  },
  {
    component: 'Panel',
    state: 'warning',
    render: () =>
      assetsPanel(
        <EmptyState
          tone="warning"
          icon="analysis"
          title="The audio changed since it was analysed"
          text="The findings below are for the audio as it was."
          actions={<Button>Analyse again</Button>}
        />,
      ),
  },

  // Sections.
  {
    component: 'Section',
    state: 'open',
    render: () => (
      <Section title="Level" icon="gain">
        <PropertyGrid rows={ASSET_ROWS.slice(0, 2)} />
      </Section>
    ),
  },
  {
    component: 'Section',
    state: 'closed',
    render: () => (
      <Section title="Time and rate" summary="Silence, Stretch, Rate" defaultOpen={false}>
        <PropertyGrid rows={ASSET_ROWS.slice(0, 2)} />
      </Section>
    ),
  },
  {
    component: 'Section',
    state: 'with actions',
    render: () => (
      <Section
        title="Rack"
        summary="Gain, Compressor, Limiter"
        actions={
          <Button compact tone={ButtonTone.Quiet}>
            Show
          </Button>
        }
      >
        <PropertyGrid rows={ASSET_ROWS.slice(0, 1)} />
      </Section>
    ),
  },
  {
    component: 'Section',
    state: 'hover',
    render: () => (
      <Section title="Time and rate" summary="Silence, Stretch, Rate" defaultOpen={false}>
        <PropertyGrid rows={ASSET_ROWS.slice(0, 2)} />
      </Section>
    ),
  },
  {
    component: 'Section',
    state: 'focus-visible',
    render: () => (
      <Section title="Time and rate" summary="Silence, Stretch, Rate" defaultOpen={false}>
        <PropertyGrid rows={ASSET_ROWS.slice(0, 2)} />
      </Section>
    ),
  },

  // Property grids and source chips.
  { component: 'PropertyGrid', state: 'default', render: () => <PropertyGrid rows={ASSET_ROWS} /> },
  {
    component: 'PropertyGrid',
    state: 'with sources',
    render: () => <PropertyGrid rows={POLICY_ROWS} />,
  },
  {
    component: 'PropertyGrid',
    state: 'long values wrapping',
    render: () => <PropertyGrid rows={LONG_ROWS} />,
  },
  {
    component: 'SourceChip',
    state: 'set',
    render: () => <SourceChip source="set">Set on this group</SourceChip>,
  },
  {
    component: 'SourceChip',
    state: 'inherited',
    render: () => <SourceChip source="inherited">Inherited from Footsteps</SourceChip>,
  },
  {
    component: 'SourceChip',
    state: 'unset',
    render: () => <SourceChip source="unset">Not set</SourceChip>,
  },

  // Lists.
  {
    component: 'ListRow',
    state: 'one line',
    render: () => (
      <List label="Sounds">
        <ListRow name="Intro hit" leading={<Icon name="audio-file" />} />
      </List>
    ),
  },
  {
    component: 'ListRow',
    state: 'two lines',
    render: () => (
      <List label="Sounds">
        <ListRow
          name="Quay ambience"
          detail="1:42.6 · Stereo · 48 kHz"
          leading={<Icon name="audio-file" />}
        />
      </List>
    ),
  },
  {
    component: 'ListRow',
    state: 'hover',
    render: () => (
      <List label="Sounds">
        <ListRow
          name="Door slam 03"
          detail="0:01.8 · Mono · 44.1 kHz"
          leading={<Icon name="audio-file" />}
        />
      </List>
    ),
  },
  {
    component: 'ListRow',
    state: 'chosen',
    render: () => (
      <List label="Sounds">
        <ListRow
          name="Tone bursts"
          detail="0:10.0 · Stereo · 48 kHz"
          leading={<Icon name="audio-file" />}
          chosen
        />
      </List>
    ),
  },
  {
    component: 'ListRow',
    state: 'refused',
    render: () => (
      <List label="Importing">
        <ListRow
          name="notes.txt"
          detail="Refused: not recognised as audio"
          leading={<Icon name="refused" />}
          refused
        />
      </List>
    ),
  },
  {
    component: 'ListRow',
    state: 'nested, with actions',
    render: () => (
      <List label="Sounds">
        <ListRow name="Tone bursts" detail="0:10.0 · Stereo · 48 kHz" />
        <ListRow
          name="Loop body"
          detail="0:05.000 – 0:08.000"
          leading={<Icon name="region" />}
          nested
          actions={action('more', 'More')}
        />
      </List>
    ),
  },
  {
    component: 'List',
    state: 'default',
    render: () => (
      <List label="Sounds">
        <ListRow name="Tone bursts" detail="0:10.0 · Stereo · 48 kHz" chosen />
        <ListRow name="Quay ambience" detail="1:42.6 · Stereo · 48 kHz" />
        <ListRow name="Door slam 03" detail="0:01.8 · Mono · 44.1 kHz" />
        <ListRow name="Take 4" detail="Being read…" leading={<Spinner />} />
      </List>
    ),
  },

  // Tables and verdicts.
  {
    component: 'Table',
    state: 'default',
    render: () => <Table label="Members" columns={MEMBER_COLUMNS} rows={MEMBER_ROWS} />,
  },
  {
    component: 'Verdict',
    state: 'passes',
    render: () => <Verdict kind="passes">Within the target</Verdict>,
  },
  {
    component: 'Verdict',
    state: 'warns',
    render: () => <Verdict kind="warns">Louder than the target by 1.1 LU</Verdict>,
  },
  {
    component: 'Verdict',
    state: 'fails',
    render: () => <Verdict kind="fails">Clipped: 12 samples at full scale</Verdict>,
  },
  {
    component: 'Verdict',
    state: 'running',
    render: () => <Verdict kind="running">Measuring</Verdict>,
  },
  {
    component: 'Verdict',
    state: 'none',
    render: () => <Verdict kind="none">Not measured</Verdict>,
  },

  // Badges, status chips and key caps.
  { component: 'Badge', state: 'neutral', render: () => <Badge>Snapshot</Badge> },
  { component: 'Badge', state: 'accent', render: () => <Badge tone="accent">Quick Edit</Badge> },
  { component: 'Badge', state: 'success', render: () => <Badge tone="success">Current</Badge> },
  { component: 'Badge', state: 'warning', render: () => <Badge tone="warning">Read only</Badge> },
  { component: 'Badge', state: 'error', render: () => <Badge tone="error">Unavailable</Badge> },
  {
    component: 'Badge',
    state: 'with a glyph',
    render: () => (
      <Badge tone="accent" icon="loop">
        Loops
      </Badge>
    ),
  },
  {
    component: 'StatusChip',
    state: 'neutral',
    render: () => (
      <StatusChip tone="neutral" icon="workspace">
        Editing
      </StatusChip>
    ),
  },
  {
    component: 'StatusChip',
    state: 'success',
    render: () => (
      <StatusChip tone="success" icon="saved">
        Saved
      </StatusChip>
    ),
  },
  {
    component: 'StatusChip',
    state: 'accent',
    render: () => (
      <StatusChip tone="accent" icon="monitoring">
        Monitoring
      </StatusChip>
    ),
  },
  {
    component: 'StatusChip',
    state: 'warning',
    render: () => (
      <StatusChip tone="warning" icon="backup-not-made">
        Backup not made
      </StatusChip>
    ),
  },
  {
    component: 'StatusChip',
    state: 'error',
    render: () => (
      <StatusChip tone="error" icon="not-saved">
        Not saved
      </StatusChip>
    ),
  },
  {
    component: 'StatusChip',
    state: 'recording',
    render: () => <StatusChip tone="recording">USB microphone: recording</StatusChip>,
  },
  { component: 'KeyCap', state: 'default', render: () => <KeyCap>Ctrl</KeyCap> },
  {
    component: 'KeyCap',
    state: 'a shortcut',
    render: () => (
      <span>
        <KeyCap>Ctrl</KeyCap> <KeyCap>Shift</KeyCap> <KeyCap>Z</KeyCap>
      </span>
    ),
  },

  // Empty, loading and error states.
  {
    component: 'EmptyState',
    state: 'empty',
    render: () => (
      <EmptyState
        icon="waveform"
        title="Choose an asset to open"
        actions={<Button tone={ButtonTone.Primary}>Import audio…</Button>}
      />
    ),
  },
  {
    component: 'EmptyState',
    state: 'warning',
    render: () => (
      <EmptyState
        tone="warning"
        icon="storage"
        title="Storage is running low"
        text="About 4 min of recording is left."
      />
    ),
  },
  {
    component: 'EmptyState',
    state: 'error',
    render: () => (
      <EmptyState
        tone="error"
        icon="diagnostics"
        title="The History panel stopped working"
        text="The rest of AudioGubbins still works."
        actions={
          <>
            <Button tone={ButtonTone.Primary}>Try the panel again</Button>
            <Button tone={ButtonTone.Quiet}>Details</Button>
          </>
        }
      />
    ),
  },
  {
    component: 'Skeleton',
    state: 'loading',
    render: () => <Skeleton label="Loading the history" lines={[0.9, 0.6, 0.8, 0.45]} />,
  },
  { component: 'Spinner', state: 'default', render: () => <Spinner label="Saving" /> },
  { component: 'Spinner', state: 'small', render: () => <Spinner size="small" label="Saving" /> },
  { component: 'Spinner', state: 'inline', render: () => <Spinner size="inline" label="Saving" /> },
  {
    component: 'ProgressBar',
    state: 'starting',
    render: () => <ProgressBar label="Copying Harbour bell.wav" value={0} />,
  },
  {
    component: 'ProgressBar',
    state: 'under way',
    render: () => <ProgressBar label="Making the waveform" value={0.64} />,
  },
  {
    component: 'ProgressBar',
    state: 'complete',
    render: () => <ProgressBar label="Exporting" value={1} />,
  },
  {
    component: 'ProgressBar',
    state: 'indeterminate',
    render: () => <ProgressBar label="Opening the project" value={null} />,
  },
  {
    component: 'ProgressBar',
    state: 'in a row',
    render: () => <ProgressBar label="Copying Harbour bell.wav" value={0.43} place="row" />,
  },
  {
    component: 'ProgressBar',
    state: 'in a dialogue',
    render: () => <ProgressBar label="Exporting 12 files" value={0.3} place="dialogue" />,
  },

  // Notices.
  {
    component: 'Notice',
    state: 'information',
    render: () => (
      <Notice
        tone="information"
        icon="workspace"
        title="Switched to “Editing”."
        onDismiss={ignore}
        durationMs={5_000}
      />
    ),
  },
  {
    component: 'Notice',
    state: 'with a second line',
    render: () => (
      <Notice
        tone="information"
        icon="diagnostic-mode"
        title="Diagnostic mode is on for thirty minutes."
        text="AudioGubbins is collecting more detail, on this machine only."
        onDismiss={ignore}
        durationMs={8_000}
      />
    ),
  },
  {
    component: 'Notice',
    state: 'success',
    render: () => (
      <Notice tone="success" title="The report was saved." onDismiss={ignore} durationMs={5_000} />
    ),
  },
  {
    component: 'Notice',
    state: 'warning',
    render: () => (
      <Notice
        tone="warning"
        icon="refused"
        title="The interface is already at its brightest."
        onDismiss={ignore}
        durationMs={8_000}
      />
    ),
  },
  {
    component: 'Notice',
    state: 'urgent',
    render: () => (
      <Notice
        tone="error"
        urgent
        title="Your changes are not being saved."
        text="This site's storage is full."
        onDismiss={ignore}
        durationMs={8_000}
      />
    ),
  },
  {
    component: 'Notice',
    state: 'with actions',
    render: () => (
      <Notice
        tone="warning"
        icon="interrupted-recording"
        title="A recording was cut short."
        text="Take 4 ended because the tab was closed."
        actions={
          <>
            <Button compact tone={ButtonTone.Primary}>
              Recover
            </Button>
            <Button compact>Discard…</Button>
          </>
        }
        onDismiss={ignore}
      />
    ),
  },

  // Banners.
  {
    component: 'Banner',
    state: 'information',
    render: () => (
      <Banner
        icon="open-project"
        title="No project is open."
        actions={
          <>
            <Button compact tone={ButtonTone.Primary}>
              New project…
            </Button>
            <Button compact>Open project…</Button>
          </>
        }
      />
    ),
  },
  {
    component: 'Banner',
    state: 'busy',
    render: () => <Banner icon="busy" title="Opening the project…" />,
  },
  {
    component: 'Banner',
    state: 'warning',
    render: () => (
      <Banner tone="warning" icon="read-only" actions={<Button compact>Ask to change it</Button>}>
        “Quayside” is open to read here, because another tab is changing it.
      </Banner>
    ),
  },
  {
    component: 'Banner',
    state: 'error',
    render: () => (
      <Banner
        tone="error"
        icon="warning"
        title="Take over?"
        actions={
          <>
            <Button compact>Cancel</Button>
            <Button compact tone={ButtonTone.Destructive}>
              Take over now
            </Button>
          </>
        }
      >
        Taking over stops the other tab changing it at once. Anything it has not saved yet is lost.
      </Banner>
    ),
  },
  {
    component: 'Banner',
    state: 'success',
    render: () => (
      <Banner tone="success" icon="recovered" title="Some of “Quayside” was recovered.">
        The newest save could not be read, so the project was opened from the one before it.
      </Banner>
    ),
  },
  {
    component: 'Banner',
    state: 'long sentence wrapping',
    render: () => (
      <Banner tone="error" icon="stored-projects" actions={<Button compact>Decide now</Button>}>
        Your stored projects were made by another version of AudioGubbins, so none can be opened
        until you decide what to do with them. Nothing has been changed or removed in the meantime.
      </Banner>
    ),
  },
];

export default specimens;
