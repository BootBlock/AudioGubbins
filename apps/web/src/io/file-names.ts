/**
 * The names a project's bundles are saved under: one the person is offered for
 * an export, and one each backup copied into the backups folder is written as
 * (REQ-STOR-099, REQ-STOR-105).
 *
 * A project's name may hold what no file name may on the systems a bundle is
 * saved to, so each is cleaned the one way.
 */

import type { ProjectId } from '@audiogubbins/domain';

/** Characters no file name may hold on the systems a bundle is saved to. */
const NOT_IN_A_FILE_NAME = /[\\/:*?"<>|\p{Cc}]+/gu;

/** A run of white space, written as one space. */
const SPACES = /\s+/gu;

/** How long the part of a project's identifier that tells two projects of one name apart is. */
const IDENTIFIER_SHOWN = 8;

/** A project's name as a file name's stem, `Project` where nothing of it can be used. */
function stemOf(projectName: string): string {
  const cleaned = projectName.replace(NOT_IN_A_FILE_NAME, ' ').replace(SPACES, ' ').trim();
  return cleaned === '' ? 'Project' : cleaned;
}

/** The name a project's bundle, or one of its backups, is suggested as. */
export function bundleNameOf(projectName: string): string {
  return `${stemOf(projectName)}.zip`;
}

/** A part of a date or a time, written in two digits. */
function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * The name a backup is written into the backups folder as: the project's name,
 * the start of its identifier and when the backup was made, to the second, in
 * this machine's time. The identifier keeps two projects of one name from
 * writing over each other's backups, and the time keeps one project's apart,
 * however its backups are numbered; neither holds a colon, which Windows
 * refuses in a name.
 */
export function backupFileNameOf(backup: {
  readonly project: ProjectId;
  readonly name: string;
  readonly at: number;
}): string {
  const made = new Date(backup.at);
  const day = `${String(made.getFullYear())}-${twoDigits(made.getMonth() + 1)}-${twoDigits(made.getDate())}`;
  const time = `${twoDigits(made.getHours())}.${twoDigits(made.getMinutes())}.${twoDigits(made.getSeconds())}`;
  return `${stemOf(backup.name)} (${backup.project.slice(0, IDENTIFIER_SHOWN)}), backup of ${day} ${time}.zip`;
}
