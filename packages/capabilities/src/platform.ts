/**
 * Which operating system the browser is running on.
 *
 * One parser, used by everything that needs the answer. Were the composition
 * root to decide the keyboard convention from one test of the user-agent string
 * and the diagnostic summary to name the operating system from another, the two
 * would disagree by construction on Android, and a browser test that mirrored
 * the first would make three.
 *
 * Pure, so that the application, the diagnostic summary and the browser tests
 * all ask the same function the same question. Reading the signals from the
 * browser is `readPlatformSignals`, in the one module that reads globals.
 */

/** An operating system AudioGubbins can tell apart. */
export const OperatingSystem = {
  Windows: 'Windows',
  MacOs: 'macOS',
  Ios: 'iOS',
  IpadOs: 'iPadOS',
  Android: 'Android',
  ChromeOs: 'ChromeOS',
  Linux: 'Linux',
  Unknown: 'Unknown operating system',
} as const;

/** An operating system AudioGubbins can tell apart. */
export type OperatingSystem = (typeof OperatingSystem)[keyof typeof OperatingSystem];

/** What the browser says about where it is running. */
export interface PlatformSignals {
  /** The user-agent string. */
  readonly userAgent: string;

  /**
   * The platform the browser reports through its client hints, where it has
   * them. More reliable than the user-agent string, which browsers freeze and
   * disguise, and absent outside Chromium.
   */
  readonly platformHint?: string;

  /**
   * How many simultaneous touches the device supports.
   *
   * An iPad asking for the desktop version of a site reports itself as a Mac in
   * its user-agent string, and a Mac has no touch screen, so this is what tells
   * them apart.
   */
  readonly maxTouchPoints: number;
}

/** The client-hint platform names, as Chromium writes them. */
const HINTED: Readonly<Record<string, OperatingSystem>> = {
  windows: OperatingSystem.Windows,
  macos: OperatingSystem.MacOs,
  ios: OperatingSystem.Ios,
  android: OperatingSystem.Android,
  'chrome os': OperatingSystem.ChromeOs,
  chromeos: OperatingSystem.ChromeOs,
  'chromium os': OperatingSystem.ChromeOs,
  linux: OperatingSystem.Linux,
};

/**
 * Names the operating system.
 *
 * The client hint is believed first. The user-agent tests run most specific
 * first, because the claims nest: Android and ChromeOS also claim to be Linux,
 * and an iPad asking for desktop sites claims to be a Mac.
 */
export function operatingSystemOf(signals: PlatformSignals): OperatingSystem {
  const hinted =
    signals.platformHint === undefined ? undefined : HINTED[signals.platformHint.toLowerCase()];
  if (hinted !== undefined) return hinted;

  const agent = signals.userAgent;
  if (agent.includes('Windows')) return OperatingSystem.Windows;
  if (agent.includes('Android')) return OperatingSystem.Android;
  if (agent.includes('CrOS')) return OperatingSystem.ChromeOs;
  if (/iPhone|iPod/.test(agent)) return OperatingSystem.Ios;
  if (agent.includes('iPad')) return OperatingSystem.IpadOs;
  if (agent.includes('Macintosh') || agent.includes('Mac OS X')) {
    return signals.maxTouchPoints > 1 ? OperatingSystem.IpadOs : OperatingSystem.MacOs;
  }
  if (agent.includes('Linux')) return OperatingSystem.Linux;
  return OperatingSystem.Unknown;
}

/** A browser's family and major version, all a user-agent string may say of it without identifying a machine. */
export interface BrowserFamily {
  readonly name: string;
  readonly majorVersion: string;
}

/**
 * The browser families told apart, most specific first: every Chromium
 * browser also claims to be Chrome, and Chrome also claims to be Safari, so
 * the most specific claim wins.
 */
const BROWSER_FAMILIES: readonly (readonly [name: string, pattern: RegExp])[] = [
  ['Edge', /Edg\/(\d+)/],
  ['Opera', /OPR\/(\d+)/],
  ['Firefox', /Firefox\/(\d+)/],
  ['Chrome', /Chrome\/(\d+)/],
  ['Safari', /Version\/(\d+).*Safari/],
];

/**
 * Names the browser's family and major version from its user-agent string,
 * never more of it: the rest carries build numbers and device models that
 * together identify a machine (REQ-PRIV-161). `undefined` where no family
 * matches.
 */
export function browserFamilyOf(userAgent: string): BrowserFamily | undefined {
  for (const [name, pattern] of BROWSER_FAMILIES) {
    const majorVersion = pattern.exec(userAgent)?.[1];
    if (majorVersion !== undefined) return { name, majorVersion };
  }
  return undefined;
}

/**
 * Whether the operating system writes and presses shortcuts the Apple way.
 *
 * Command rather than Control, and modifiers written as symbols. An iPad with a
 * keyboard follows the Mac, which is why the desktop-mode iPad has to be told
 * apart from a Mac for the diagnostic summary but not for this.
 */
export function usesAppleModifiers(system: OperatingSystem): boolean {
  return (
    system === OperatingSystem.MacOs ||
    system === OperatingSystem.Ios ||
    system === OperatingSystem.IpadOs
  );
}
