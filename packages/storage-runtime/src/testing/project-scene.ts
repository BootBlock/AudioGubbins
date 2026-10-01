/**
 * A page whose storage worker holds one project, and the steps the tests of
 * open projects take with it: opening it through the page's client, renaming
 * it, and reading it from storage as another window would, which rebuilds it
 * from what the worker wrote rather than from anything the page was sent.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import type { ProjectId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { ProjectCommandId } from '@audiogubbins/project-commands';
import { openProject, type ProjectModel } from '@audiogubbins/storage';

import type { RemoteOpenedProject } from '../client/projects-client.js';
import type { RemoteProjectSession, RemoteReadOnlyProject } from '../client/remote-project.js';
import {
  SETTINGS,
  memoryStorage,
  type MemoryStorage,
  type MemoryStorageOptions,
} from './memory-storage.js';

/** A page, the project its storage holds, and that project open to write. */
export interface ProjectScene {
  readonly storage: MemoryStorage;
  readonly project: ProjectId;
  readonly session: RemoteProjectSession;
}

/** An invocation naming the project. */
export function rename(name: string): CommandInvocation {
  return { commandId: ProjectCommandId.Rename, arguments: { name } };
}

/** Makes a project in a new page's storage and gives its identifier. */
export async function madeProject(storage: MemoryStorage): Promise<ProjectId> {
  const header = await storage.client.library.create({ name: 'Forest walk', settings: SETTINGS });
  return expectSuccess(header).id;
}

/** Opens a project through the page's client, or throws. */
export async function opened(
  storage: MemoryStorage,
  project: ProjectId,
  access: 'write' | 'read' = 'write',
): Promise<RemoteOpenedProject> {
  return expectSuccess(await storage.client.projects.open({ project, access }));
}

/** The session a project opened to write as, or throws naming how it opened. */
export function writable(project: RemoteOpenedProject): RemoteProjectSession {
  if (project.kind !== 'writable') throw new Error(`The project opened ${project.kind}.`);
  return project.session;
}

/** The view a project opened to read as, or throws naming how it opened. */
export function readOnly(project: RemoteOpenedProject): RemoteReadOnlyProject {
  if (project.kind !== 'read-only') throw new Error(`The project opened ${project.kind}.`);
  return project.view;
}

/** A page whose storage holds one project, open to write (see the module comment). */
export async function projectScene(options?: MemoryStorageOptions): Promise<ProjectScene> {
  const storage = memoryStorage(options);
  const project = await madeProject(storage);
  return { storage, project, session: writable(await opened(storage, project)) };
}

/** The project as storage holds it, read as another window of the profile would. */
export async function storedModel(
  storage: MemoryStorage,
  project: ProjectId,
): Promise<ProjectModel> {
  const read = expectSuccess(await openProject({ project, access: 'read' }, storage.another));
  if (read.kind !== 'read-only') throw new Error(`The project opened ${read.kind}.`);
  const { model } = read.view.getSnapshot();
  read.view.close();
  return model;
}
