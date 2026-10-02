/**
 * The files a project links to as a test scripts them: each kept under its
 * handle key, with the leave the browser has to read it and the person's answer
 * when asked for it, as after a reload (REQ-STOR-104).
 */

import type { ExternalSourceIdentity } from '@audiogubbins/project-format';
import type { PageFile } from '@audiogubbins/storage-runtime';

import type { LinkedFileAccess, LinkedFilesPort } from '../io/linked-files.js';

/** A file kept under a handle, and the browser's leave to read it. */
export interface ScriptedLinkedFile {
  file: PageFile | undefined;
  leave: 'granted' | 'asks' | 'denied';
  answer: 'granted' | 'denied';

  /** Whether an ask answers a gesture still in force, without which the browser will not ask. */
  activated: boolean;
}

/** The browser's side of linked files, every one kept under its handle key. */
export class ScriptedLinkedFiles implements LinkedFilesPort {
  readonly kept = new Map<string, ScriptedLinkedFile>();

  /** How many times the person was asked, in all. */
  asked = 0;

  /** Keeps `file` under its own handle key, with the browser's `leave` to read it. */
  keep(file: PageFile, leave: ScriptedLinkedFile['leave'] = 'granted'): ScriptedLinkedFile {
    if (file.handleKey === undefined) throw new Error('A kept file needs a handle key.');
    const kept: ScriptedLinkedFile = { file, leave, answer: 'granted', activated: true };
    this.kept.set(file.handleKey, kept);
    return kept;
  }

  look(identity: ExternalSourceIdentity): Promise<LinkedFileAccess> {
    return Promise.resolve(this.access(identity));
  }

  ask(identity: ExternalSourceIdentity): Promise<LinkedFileAccess> {
    const kept = this.keptFor(identity);
    if (kept?.leave === 'asks' && kept.activated) {
      this.asked += 1;
      kept.leave = kept.answer;
    }
    return Promise.resolve(this.access(identity));
  }

  private keptFor(identity: ExternalSourceIdentity): ScriptedLinkedFile | undefined {
    return identity.handleKey === undefined ? undefined : this.kept.get(identity.handleKey);
  }

  private access(identity: ExternalSourceIdentity): LinkedFileAccess {
    const kept = this.keptFor(identity);
    if (kept?.file === undefined) return { kind: 'missing' };
    switch (kept.leave) {
      case 'asks':
        return { kind: 'permission-needed' };
      case 'denied':
        return { kind: 'denied' };
      case 'granted':
        return { kind: 'available', file: kept.file };
    }
  }
}
