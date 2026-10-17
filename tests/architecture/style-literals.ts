/**
 * The literal values in a stylesheet that REQ-UX-155 clause 155.1 refuses in a
 * component's styles: a colour, a length, a duration or a shadow written as a
 * value rather than read from a token.
 *
 * Every value a declaration holds is read, with the function it sits in and
 * the property it belongs to, and every at-rule's condition with it. Each
 * number with a unit, each colour and each colour name found is a candidate,
 * and is a violation unless one of {@link EXCEPTIONS} allows it. The
 * exceptions are the one place a literal is allowed, each with its reason.
 *
 * A custom property declared in a component's stylesheet is read like any
 * other declaration. The tokens are declared by the theme, from the token
 * modules, and by the token definitions in `tokens.css`; a component that
 * gives a property of its own a literal value has written a literal under
 * another name.
 */

import { tokenise, type CssToken } from './stylesheet-tokens.js';

/** What a literal stands for, in the clause's words. */
export type LiteralKind = 'colour' | 'length' | 'duration' | 'shadow';

/** A value found where a token belongs, before the exceptions are applied. */
export interface Candidate {
  readonly kind: LiteralKind;

  /** The literal as written, or a function's name and what it was given. */
  readonly text: string;

  /** The declaration's property, or the at-rule a condition belongs to, `@media`. */
  readonly property: string;

  /** Whether it is in an at-rule's condition rather than a declaration's value. */
  readonly inCondition: boolean;

  /** A length or a duration: its number and unit. Nothing for a colour. */
  readonly dimension?: { readonly value: number; readonly unit: string };

  readonly line: number;
  readonly column: number;
}

/** One allowed literal, and why it is allowed. */
export interface LiteralException {
  readonly name: string;
  readonly reason: string;
  readonly allows: (candidate: Candidate) => boolean;
}

/**
 * Every literal a component's stylesheet may write, and why. Nothing else is
 * allowed: a literal not listed here is a value the design language states
 * and a token carries.
 */
export const EXCEPTIONS: readonly LiteralException[] = [
  {
    name: 'zero',
    reason:
      'Zero of any unit is no size, offset or time at all, and the same at every density and in every theme.',
    allows: (candidate) => candidate.dimension?.value === 0,
  },
  {
    name: 'hairline',
    reason:
      'A hairline, a 1 px border, separator or lit edge, is the one width the design language exempts from the grid (section 1): the thinnest line a display draws, the same at both densities, and offset up or down by itself where a shadow draws one.',
    allows: (candidate) =>
      candidate.kind !== 'duration' &&
      Math.abs(candidate.dimension?.value ?? 0) === 1 &&
      candidate.dimension?.unit === 'px',
  },
  {
    name: 'whole viewport',
    reason:
      'A hundred of a viewport or container unit is the whole of the viewport or container, as 100 % is the whole of a parent: a layout bound the page has, not a size the language states.',
    allows: (candidate) =>
      candidate.dimension?.value === 100 && WHOLE_UNITS.test(candidate.dimension.unit),
  },
  {
    name: 'one line',
    reason:
      "One `lh` is the height of the element's own line of text, which places a glyph on a first line whatever the type size: a measure the text already has, not a size the language states.",
    allows: (candidate) =>
      candidate.dimension?.value === 1 && /^r?lh$/i.test(candidate.dimension.unit),
  },
  {
    name: 'colour keyword',
    reason:
      '`transparent` and `currentColor` name no colour of their own: one is no paint, the other the colour the element already has.',
    allows: (candidate) => /^(?:transparent|currentcolor)$/i.test(candidate.text),
  },
  {
    name: 'system colour',
    reason:
      "A system colour (`Canvas`, `CanvasText`, `Highlight`, `GrayText`, `Mark` and the rest) is the user's own platform palette, which forced-colours mode requires a stylesheet to use and no theme can supply.",
    allows: (candidate) => SYSTEM_COLOURS.has(candidate.text.toLowerCase()),
  },
  {
    name: 'query condition',
    reason:
      "A media or container query's condition cannot read a custom property (Media Queries Level 4), so the width at which a layout changes is written in the condition and nowhere else.",
    allows: (candidate) => candidate.inCondition,
  },
];

/** A literal no exception allows, where it is. */
export interface Violation extends Candidate {
  readonly path: string;
}

/** The units of a length, absolute, relative to a font, to the viewport or to a container. */
const LENGTH_UNITS: ReadonlySet<string> = new Set([
  'px',
  'cm',
  'mm',
  'q',
  'in',
  'pt',
  'pc',
  'em',
  'rem',
  'ex',
  'rex',
  'cap',
  'rcap',
  'ch',
  'rch',
  'ic',
  'ric',
  'lh',
  'rlh',
  'vw',
  'vh',
  'vi',
  'vb',
  'vmin',
  'vmax',
  'svw',
  'svh',
  'svi',
  'svb',
  'svmin',
  'svmax',
  'lvw',
  'lvh',
  'lvi',
  'lvb',
  'lvmin',
  'lvmax',
  'dvw',
  'dvh',
  'dvi',
  'dvb',
  'dvmin',
  'dvmax',
  'cqw',
  'cqh',
  'cqi',
  'cqb',
  'cqmin',
  'cqmax',
]);

/** The units that measure the viewport or a container, a hundred of which is the whole. */
const WHOLE_UNITS = /^(?:[sld]?v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max))$/;

/** The units of a duration. */
const TIME_UNITS: ReadonlySet<string> = new Set(['s', 'ms']);

/** The functions that write a colour from its channels. */
const COLOUR_FUNCTIONS: ReadonlySet<string> = new Set([
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
]);

/** The properties whose every value is a shadow. */
const SHADOW_PROPERTIES: ReadonlySet<string> = new Set(['box-shadow', 'text-shadow']);

/**
 * The properties whose identifiers are names an author gives, where a word
 * that is also a colour's name, an animation called `tomato`, is no colour.
 */
const AUTHOR_NAMES: ReadonlySet<string> = new Set([
  'animation',
  'animation-name',
  'container',
  'container-name',
  'counter-increment',
  'counter-reset',
  'counter-set',
  'font',
  'font-family',
  'grid-area',
  'grid-column',
  'grid-column-end',
  'grid-column-start',
  'grid-row',
  'grid-row-end',
  'grid-row-start',
  'grid-template-areas',
  'transition',
  'transition-property',
  'view-transition-name',
  'will-change',
]);

/** The system colours of CSS Color Module Level 4, lower case. */
const SYSTEM_COLOURS: ReadonlySet<string> = new Set([
  'accentcolor',
  'accentcolortext',
  'activetext',
  'buttonborder',
  'buttonface',
  'buttontext',
  'canvas',
  'canvastext',
  'field',
  'fieldtext',
  'graytext',
  'highlight',
  'highlighttext',
  'linktext',
  'mark',
  'marktext',
  'selecteditem',
  'selecteditemtext',
  'visitedtext',
]);

/** The named colours of CSS Color Module Level 4, lower case, with `transparent` and `currentcolor`. */
const NAMED_COLOURS: ReadonlySet<string> = new Set([
  'transparent',
  'currentcolor',
  'aliceblue',
  'antiquewhite',
  'aqua',
  'aquamarine',
  'azure',
  'beige',
  'bisque',
  'black',
  'blanchedalmond',
  'blue',
  'blueviolet',
  'brown',
  'burlywood',
  'cadetblue',
  'chartreuse',
  'chocolate',
  'coral',
  'cornflowerblue',
  'cornsilk',
  'crimson',
  'cyan',
  'darkblue',
  'darkcyan',
  'darkgoldenrod',
  'darkgray',
  'darkgreen',
  'darkgrey',
  'darkkhaki',
  'darkmagenta',
  'darkolivegreen',
  'darkorange',
  'darkorchid',
  'darkred',
  'darksalmon',
  'darkseagreen',
  'darkslateblue',
  'darkslategray',
  'darkslategrey',
  'darkturquoise',
  'darkviolet',
  'deeppink',
  'deepskyblue',
  'dimgray',
  'dimgrey',
  'dodgerblue',
  'firebrick',
  'floralwhite',
  'forestgreen',
  'fuchsia',
  'gainsboro',
  'ghostwhite',
  'gold',
  'goldenrod',
  'gray',
  'green',
  'greenyellow',
  'grey',
  'honeydew',
  'hotpink',
  'indianred',
  'indigo',
  'ivory',
  'khaki',
  'lavender',
  'lavenderblush',
  'lawngreen',
  'lemonchiffon',
  'lightblue',
  'lightcoral',
  'lightcyan',
  'lightgoldenrodyellow',
  'lightgray',
  'lightgreen',
  'lightgrey',
  'lightpink',
  'lightsalmon',
  'lightseagreen',
  'lightskyblue',
  'lightslategray',
  'lightslategrey',
  'lightsteelblue',
  'lightyellow',
  'lime',
  'limegreen',
  'linen',
  'magenta',
  'maroon',
  'mediumaquamarine',
  'mediumblue',
  'mediumorchid',
  'mediumpurple',
  'mediumseagreen',
  'mediumslateblue',
  'mediumspringgreen',
  'mediumturquoise',
  'mediumvioletred',
  'midnightblue',
  'mintcream',
  'mistyrose',
  'moccasin',
  'navajowhite',
  'navy',
  'oldlace',
  'olive',
  'olivedrab',
  'orange',
  'orangered',
  'orchid',
  'palegoldenrod',
  'palegreen',
  'paleturquoise',
  'palevioletred',
  'papayawhip',
  'peachpuff',
  'peru',
  'pink',
  'plum',
  'powderblue',
  'purple',
  'rebeccapurple',
  'red',
  'rosybrown',
  'royalblue',
  'saddlebrown',
  'salmon',
  'sandybrown',
  'seagreen',
  'seashell',
  'sienna',
  'silver',
  'skyblue',
  'slateblue',
  'slategray',
  'slategrey',
  'snow',
  'springgreen',
  'steelblue',
  'tan',
  'teal',
  'thistle',
  'tomato',
  'turquoise',
  'violet',
  'wheat',
  'white',
  'whitesmoke',
  'yellow',
  'yellowgreen',
]);

/** The at-rules whose condition is a media or container query. */
const QUERY_AT_RULES: ReadonlySet<string> = new Set(['media', 'container', 'custom-media']);

/** Where a value is being read: its property, and whether it draws a shadow. */
interface Context {
  readonly property: string;
  readonly inCondition: boolean;
  readonly shadow: boolean;
}

/** Whether a token is no part of a value's meaning. */
function isBlank(token: CssToken): boolean {
  return token.type === 'whitespace';
}

/**
 * The tokens of a function's arguments, from the token after its name to its
 * closing parenthesis, and the index after that parenthesis.
 */
function argumentsOf(
  tokens: readonly CssToken[],
  start: number,
): { readonly inside: readonly CssToken[]; readonly end: number } {
  let depth = 1;
  let index = start;
  while (index < tokens.length) {
    const type = tokens[index]?.type;
    if (type === '(' || type === 'function') depth += 1;
    else if (type === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
    index += 1;
  }
  return { inside: tokens.slice(start, index), end: index + 1 };
}

/** The text a function was written with, for a report: its name and its arguments' kinds. */
function functionText(name: string, inside: readonly CssToken[]): string {
  const parts = inside
    .filter((token) => !isBlank(token))
    .map((token) =>
      'text' in token
        ? token.text
        : 'value' in token
          ? token.value
          : 'name' in token
            ? `${token.name}(`
            : token.type,
    );
  return `${name}(${parts.join(' ')})`;
}

/**
 * Whether a colour function draws from tokens alone: relative to a colour it
 * reads (`oklch(from var(--ag-chrome-accent) l c h / 50%)`), or with every
 * channel a token. One with a number for a channel writes a colour of its own.
 */
function colourFromTokens(inside: readonly CssToken[]): boolean {
  const meaningful = inside.filter((token) => !isBlank(token));
  const first = meaningful[0];
  if (first?.type === 'ident' && first.value.toLowerCase() === 'from') return true;
  return !meaningful.some(
    (token) =>
      token.type === 'number' ||
      token.type === 'percentage' ||
      token.type === 'dimension' ||
      token.type === 'hash' ||
      (token.type === 'ident' && token.value.toLowerCase() === 'none'),
  );
}

/** Every candidate in a run of value tokens. */
function valueCandidates(tokens: readonly CssToken[], context: Context): Candidate[] {
  const found: Candidate[] = [];
  const kindFor = (kind: LiteralKind): LiteralKind =>
    context.shadow && kind !== 'duration' ? 'shadow' : kind;
  const at = (token: CssToken) => ({
    property: context.property,
    inCondition: context.inCondition,
    line: token.line,
    column: token.column,
  });

  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    index += 1;
    if (token === undefined) break;

    switch (token.type) {
      case 'dimension': {
        const kind = LENGTH_UNITS.has(token.unit)
          ? 'length'
          : TIME_UNITS.has(token.unit)
            ? 'duration'
            : undefined;
        if (kind !== undefined) {
          found.push({
            ...at(token),
            kind: kindFor(kind),
            text: token.text,
            dimension: { value: token.value, unit: token.unit },
          });
        }
        break;
      }
      case 'hash':
        found.push({ ...at(token), kind: kindFor('colour'), text: `#${token.value}` });
        break;
      case 'ident':
        if (!AUTHOR_NAMES.has(context.property) && NAMED_COLOURS.has(token.value.toLowerCase())) {
          found.push({ ...at(token), kind: kindFor('colour'), text: token.value });
        } else if (SYSTEM_COLOURS.has(token.value.toLowerCase())) {
          found.push({ ...at(token), kind: kindFor('colour'), text: token.value });
        }
        break;
      case 'function': {
        const { inside, end } = argumentsOf(tokens, index);
        index = end;
        if (COLOUR_FUNCTIONS.has(token.name) && !colourFromTokens(inside)) {
          found.push({
            ...at(token),
            kind: kindFor('colour'),
            text: functionText(token.name, inside),
          });
        } else {
          found.push(
            ...valueCandidates(inside, {
              ...context,
              shadow: context.shadow || token.name === 'drop-shadow',
            }),
          );
        }
        break;
      }
      default:
        break;
    }
  }
  return found;
}

/** The index of the first token at the top level of `tokens` from `start` that is one of `types`. */
function nextAtTopLevel(
  tokens: readonly CssToken[],
  start: number,
  types: ReadonlySet<CssToken['type']>,
): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const type = tokens[index]?.type;
    if (depth === 0 && type !== undefined && types.has(type)) return index;
    if (type === '(' || type === '[' || type === 'function' || type === '{') depth += 1;
    else if (type === ')' || type === ']' || type === '}') {
      if (depth === 0) return index;
      depth -= 1;
    }
  }
  return tokens.length;
}

/** The index of the brace that closes the block opened at `open`. */
function blockEnd(tokens: readonly CssToken[], open: number): number {
  return nextAtTopLevel(tokens, open + 1, new Set(['}']));
}

const STATEMENT_END: ReadonlySet<CssToken['type']> = new Set(['semicolon', '{', '}']);

/**
 * Every candidate in the contents of a block, or of the whole stylesheet: its
 * declarations' values and the conditions of its at-rules, and every rule
 * nested in it, as CSS nesting and the conditional at-rules nest them.
 */
function blockCandidates(tokens: readonly CssToken[]): Candidate[] {
  const found: Candidate[] = [];
  let index = 0;
  while (index < tokens.length) {
    while (tokens[index]?.type === 'whitespace' || tokens[index]?.type === 'semicolon') {
      index += 1;
    }
    const first = tokens[index];
    if (first === undefined) break;

    const stop = nextAtTopLevel(tokens, index, STATEMENT_END);
    const stopper = tokens[stop];

    if (stopper?.type === '{') {
      // A rule with a block: an at-rule, whose condition is read, or a rule
      // with a selector, which holds no value.
      if (first.type === 'at-keyword' && QUERY_AT_RULES.has(first.name)) {
        found.push(
          ...valueCandidates(tokens.slice(index + 1, stop), {
            property: `@${first.name}`,
            inCondition: true,
            shadow: false,
          }),
        );
      }
      const close = blockEnd(tokens, stop);
      found.push(...blockCandidates(tokens.slice(stop + 1, close)));
      index = close + 1;
      continue;
    }

    const statement = tokens.slice(index, stop);
    index = stop + 1;
    if (first.type !== 'ident') continue;
    const colon = statement.findIndex((token) => token.type === 'colon');
    if (colon === -1) continue;

    const property = first.value.toLowerCase();
    found.push(
      ...valueCandidates(statement.slice(colon + 1), {
        property,
        inCondition: false,
        shadow: SHADOW_PROPERTIES.has(property),
      }),
    );
  }
  return found;
}

/** Every literal in a stylesheet's text that no exception allows. */
export function literalViolations(path: string, text: string): readonly Violation[] {
  return blockCandidates(tokenise(text))
    .filter((candidate) => !EXCEPTIONS.some((exception) => exception.allows(candidate)))
    .map((candidate) => ({ ...candidate, path }));
}

/** A violation as one line of a report: where, what kind, the literal and its property. */
export function describeViolation(violation: Violation): string {
  return `${violation.path}:${String(violation.line)}:${String(violation.column)} ${violation.kind} ${violation.text} (${violation.property})`;
}
