/**
 * The backups folder as a test scripts it: a folder on the machine that keeps
 * what is written to it, and the browser's side of choosing it, keeping it and
 * asking for leave to write to it again (REQ-STOR-105).
 */

import type { FileWriteStream, WritableDirectory } from '@audiogubbins/browser-storage';

import type { BackupFolderPort, FolderAccess } from '../io/backup-folder.js';

/** A folder on the machine, holding each file written to it once its stream closes. */
export class MachineFolder implements WritableDirectory {
  readonly files = new Map<string, number>();

  getFileHandle(name: string) {
    let bytes = 0;
    const stream: FileWriteStream = {
      write: (data) => {
        bytes += data.length;
        return Promise.resolve();
      },
      close: () => {
        this.files.set(name, bytes);
        return Promise.resolve();
      },
      abort: () => Promise.resolve(),
    };
    return Promise.resolve({ createWritable: () => Promise.resolve(stream) });
  }
}

/**
 * The browser's side of the folder: a folder kept from an earlier visit, whose
 * leave to write the browser asks for again, as after a reload.
 */
export class ScriptedFolderPort implements BackupFolderPort {
  readonly folder = new MachineFolder();
  kept: 'none' | 'asks' | 'granted' | 'denied' = 'asks';
  answer: 'granted' | 'denied' = 'granted';

  private access(): FolderAccess {
    switch (this.kept) {
      case 'none':
        return { kind: 'none' };
      case 'granted':
        return { kind: 'available', name: 'Backups', folder: this.folder };
      case 'asks':
        return { kind: 'permission-needed', name: 'Backups' };
      case 'denied':
        return { kind: 'denied', name: 'Backups' };
    }
  }

  look(): Promise<FolderAccess> {
    return Promise.resolve(this.access());
  }

  ask(): Promise<FolderAccess> {
    if (this.kept === 'asks') this.kept = this.answer;
    return Promise.resolve(this.access());
  }

  choose(): Promise<FolderAccess | undefined> {
    this.kept = 'granted';
    return Promise.resolve(this.access());
  }

  forget(): Promise<void> {
    this.kept = 'none';
    return Promise.resolve();
  }
}
