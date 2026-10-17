/**
 * The parts the Inspector is composed of (design language, section 11): the
 * subject it shows, with its glyph tile, title and scope, and the sections
 * under it, each a design-system `Section` that opens and closes.
 *
 * A `Section` names itself by the button that opens it, which is not a
 * heading, so each part keeps a heading of its own in the page for a screen
 * reader's heading navigation, naming the part as a region. The heading says
 * what the part is about in full ("Region: Loop body") where the section's
 * header says it in a word ("Region").
 */

import { useId, type ReactNode } from 'react';

import { Badge, Icon, type IconName, Section } from '@audiogubbins/design-system';

/** What the Inspector shows: its glyph, its title, what it is, and what a command acts on. */
export function InspectorSubject({
  icon,
  title,
  detail,
  scope,
  hint,
}: {
  readonly icon: IconName;
  readonly title: string;
  /** What it is, in a line under its title. */
  readonly detail?: string | undefined;
  /** What a command would act on, as a chip under it. */
  readonly scope?: string | undefined;
  /** An explanation behind an (i) beside the title. */
  readonly hint?: ReactNode;
}): ReactNode {
  return (
    <div className="ag-inspector-subject">
      <div className="ag-inspector-subject-head">
        <span className="ag-inspector-tile">
          <Icon name={icon} />
        </span>
        <div className="ag-inspector-subject-text">
          <p className="ag-inspector-title">{title}</p>
          {detail !== undefined && <p className="ag-inspector-detail">{detail}</p>}
        </div>
        {hint}
      </div>
      {scope !== undefined && (
        <span className="ag-inspector-scope">
          <Badge icon="locate">{scope}</Badge>
        </span>
      )}
    </div>
  );
}

/** What a part of the Inspector takes. */
interface PartProps {
  /** What the part is about, in full: its heading in the page. */
  readonly heading: string;
  /** Its section header's word or two. */
  readonly title: string;
  readonly summary?: string | undefined;
  /** Small buttons at its header's trailing end. */
  readonly actions?: ReactNode;
  /** Whether it starts open. Open unless this says `false`. */
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
}

/** The props a `Section` takes of `props`, leaving out what was not given. */
function sectionProps(props: Omit<PartProps, 'heading' | 'children'>) {
  return {
    title: props.title,
    ...(props.summary === undefined ? {} : { summary: props.summary }),
    ...(props.actions === undefined ? {} : { actions: props.actions }),
    ...(props.defaultOpen === undefined ? {} : { defaultOpen: props.defaultOpen }),
  };
}

/** A part of the Inspector: a section, headed in the page and named as a region by its heading. */
export function InspectorPart({ heading, children, ...rest }: PartProps): ReactNode {
  const id = useId();
  return (
    <section className="ag-inspector-part" aria-labelledby={id}>
      <h3 id={id} className="ag-visually-hidden">
        {heading}
      </h3>
      <Section {...sectionProps(rest)}>{children}</Section>
    </section>
  );
}

/**
 * A section inside a part, whose heading leads what it holds, so the heading
 * is followed by its list or its facts.
 */
export function InspectorSubpart({ heading, children, ...rest }: PartProps): ReactNode {
  return (
    <Section {...sectionProps(rest)}>
      <h4 className="ag-visually-hidden">{heading}</h4>
      {children}
    </Section>
  );
}
