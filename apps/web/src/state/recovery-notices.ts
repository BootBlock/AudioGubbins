/**
 * What the user is told about stored text that could not be read, for every
 * store that keeps such text.
 *
 * Each store's custody words its own notices (`workspace-custody.ts`,
 * `profile-custody.ts`). What is said of them all is here, once: what each
 * notice is about, the refusal to dismiss one that is not showing, the notices
 * standing in the one order the status bar shows them and the start
 * announcement says them, and the advice that stands while any of that text
 * waits for room.
 */

/**
 * A notice that stored text could not be read, as a custody words it.
 *
 * In two parts, because the start announcement says every notice's fact
 * before any notice's consequences: said whole, one notice after another, a
 * long one would leave no words for the fact of the next.
 */
export interface Notice {
  /**
   * What could not be read, and what the user has instead; and, while its text
   * waits for room, what the user changes that cannot be kept until there is,
   * so that is said wherever the fact is.
   */
  readonly fact: string;

  /**
   * Where the text that could not be read is, and why, and whether AudioGubbins
   * tries again, then anything more beside it that could not be read.
   */
  readonly consequences: string;

  /**
   * Whether something the user changes cannot be kept until there is room to
   * set the text aside.
   */
  readonly waitsForRoom: boolean;
}

/** A notice whole, as the status bar shows it. */
export function wholeNotice({ fact, consequences }: Notice): string {
  return `${fact} ${consequences}`;
}

/**
 * The parts of the workspace recovered separately, the workspace on screen and
 * the collection of saved ones, each with a notice of its own, so dismissing
 * one does not dismiss the other.
 */
const RECOVERY_PARTS = ['layout', 'collection'] as const;

/** A part of the workspace recovered separately. */
export type RecoveryPart = (typeof RECOVERY_PARTS)[number];

/** Whether a value names a part of the workspace recovered separately. */
export function isRecoveryPart(value: string): value is RecoveryPart {
  return RECOVERY_PARTS.some((part) => part === value);
}

/** What a notice is about: a part of the workspace, or the shortcut profiles. */
export type NoticeAbout = RecoveryPart | 'profiles';

/** Whether a value names what a notice can be about. */
export function isNoticeAbout(value: string): value is NoticeAbout {
  return value === 'profiles' || isRecoveryPart(value);
}

/**
 * What each notice is about, to finish "the notice about …". Several can stand
 * at once, and named alike, each would have a button called "Dismiss notice":
 * a screen-reader user would hear identical buttons and could not tell which
 * was which.
 */
const SUBJECTS: Readonly<Record<NoticeAbout, string>> = {
  layout: 'the workspace on screen',
  collection: 'your saved workspaces',
  profiles: 'your shortcut profiles',
};

/** What a notice is about, to finish "the notice about …". */
export function subjectOf(about: NoticeAbout): string {
  return SUBJECTS[about];
}

/** The refusal to dismiss a notice that is not showing. */
export function noNoticeAbout(about: NoticeAbout): string {
  return `There is no notice about ${subjectOf(about)}.`;
}

/** A notice of the workspace's, and the part of it the notice is about. */
export interface WorkspaceRecovery {
  readonly part: RecoveryPart;
  readonly notice: Notice;
}

/** The notices the workspace starts with: a layout recovered, and a collection damaged. */
export function startingRecoveries(
  layout: Notice | undefined,
  collection: Notice | undefined,
): readonly WorkspaceRecovery[] {
  const notices: readonly (readonly [RecoveryPart, Notice | undefined])[] = [
    ['layout', layout],
    ['collection', collection],
  ];
  return notices.flatMap(([part, notice]) => (notice === undefined ? [] : [{ part, notice }]));
}

/**
 * The workspace's notices standing, each as `noticeOf` words it now: the list
 * given, the same list, where no notice's words have changed, so a caller can
 * tell whether there is anything new to show.
 */
export function recoveriesNow(
  standing: readonly WorkspaceRecovery[],
  noticeOf: (part: RecoveryPart) => Notice | undefined,
): readonly WorkspaceRecovery[] {
  const now = standing.map((one) => {
    const notice = noticeOf(one.part);
    return notice === undefined || wholeNotice(notice) === wholeNotice(one.notice)
      ? one
      : { part: one.part, notice };
  });
  return now.some((one, index) => one !== standing[index]) ? now : standing;
}

/**
 * The advice that stands while text nobody has read waits for room to be set
 * aside: that exporting it and then discarding it makes that room, and where.
 *
 * Clearing this site's data is warned against: it deletes far more than the
 * text in question, every workspace, setting and shortcut profile kept here
 * and the text that could not be read, which the notice says is kept. A build
 * served from a folder of a shared address shares its storage with every
 * other site there, and clearing it clears theirs.
 *
 * Shown once, as an item of its own, however many stores' text waits: said in
 * each notice, it would be read once for each. It stands while any text waits,
 * offers no dismissal, because it is advice for as long as that holds, and
 * dismissing a notice leaves the text waiting.
 */
export const MAKING_ROOM_SAFELY =
  "To make room without losing anything, export the text that could not be read from the Workspaces or Shortcuts settings, then discard it there. Clearing this site's data in your browser instead would delete every workspace, shortcut profile and setting kept here, the text that could not be read among them, and the data of any other site at the same address.";

/** A notice standing, and what it is about. */
export interface StandingNotice {
  readonly about: NoticeAbout;
  readonly notice: Notice;
}

/** Every notice standing, and whether the advice stands with them. */
export interface StandingRecovery {
  /** In the order they are shown and said: the workspace's, then the profiles'. */
  readonly notices: readonly StandingNotice[];

  /**
   * Whether any store's text waits for room to be set aside, so that
   * {@link MAKING_ROOM_SAFELY} stands, whether its notice does or not.
   */
  readonly waitsForRoom: boolean;
}

/** What the workspace store holds of its notices. */
interface WorkspaceNotices {
  readonly recoveries: readonly WorkspaceRecovery[];
  readonly waitsForRoom: boolean;
}

/** What the shortcut store holds of its notice. */
interface ProfileNotices {
  readonly recovery: Notice | undefined;
  readonly waitsForRoom: boolean;
}

/**
 * Every notice standing, in the one order the status bar shows them and the
 * start announcement says them, and whether the advice stands with them. One
 * list for both, so a store's notice added or moved here is shown and said
 * alike.
 */
export function standingRecovery(
  workspace: WorkspaceNotices,
  profiles: ProfileNotices,
): StandingRecovery {
  const fromWorkspace = workspace.recoveries.map(({ part, notice }) => ({ about: part, notice }));
  const fromProfiles: readonly StandingNotice[] =
    profiles.recovery === undefined ? [] : [{ about: 'profiles', notice: profiles.recovery }];
  return {
    notices: [...fromWorkspace, ...fromProfiles],
    waitsForRoom: workspace.waitsForRoom || profiles.waitsForRoom,
  };
}
