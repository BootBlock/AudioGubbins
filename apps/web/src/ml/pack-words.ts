/**
 * What a person is told of a model pack (REQ-AUDIO-139): its name and version,
 * the state of its installation, what a step with it came to, and which of the
 * requirement's five conditions holds, each named as the requirement names it,
 * so the manager and its commands say one thing.
 */

import type { InstallState, PackAvailability } from '@audiogubbins/model-packs';

import { describeBytes } from '../wording.js';

/** A pack version as a person knows it: "DeepFilterNet 3 1.0.0". */
export function packTitle(name: string, version: string): string {
  return `${name} ${version}`;
}

/** REQ-AUDIO-139's conditions, and that a pack is available, as the requirement names them. */
export const CONDITION_NAMES: Readonly<Record<PackAvailability['condition'], string>> = {
  available: 'Available',
  'update-available': 'Model update available',
  'required-unavailable': 'Required model unavailable',
  'optional-unavailable': 'Optional enhancement unavailable',
  incompatible: 'Model incompatible with current runtime',
  'device-unavailable': 'Model unavailable because of browser/device capability',
};

/** How much of a download is kept: "2.1 MB of 8.2 MB". */
export function progressWords(received: number, total: number): string {
  return `${describeBytes(received)} of ${describeBytes(total)}`;
}

/** The state of a version's installation, in a phrase: "Downloading, 2.1 MB of 8.2 MB". */
export function stateWords(state: InstallState): string {
  switch (state.kind) {
    case 'available':
      return 'Not installed';
    case 'queued':
      return `Waiting for another download to finish, ${progressWords(state.received, state.total)} kept`;
    case 'downloading':
      return `Downloading, ${progressWords(state.received, state.total)}`;
    case 'paused':
      return `Paused, ${progressWords(state.received, state.total)} kept`;
    case 'verifying':
      return 'Checking every file against its SHA-256';
    case 'installed':
      return 'Installed, every file checked against its SHA-256';
    case 'failed':
      return `Failed: ${state.reason.summary}`;
    case 'removing':
      return 'Removing';
  }
}

/** What a download, a resume, a retry or an import of `title` came to, said once it settles. */
export function settledWords(title: string, state: InstallState): string {
  switch (state.kind) {
    case 'installed':
      return `Installed ${title}. Every file matched its SHA-256.`;
    case 'paused':
      return `Paused ${title}, with ${progressWords(state.received, state.total)} kept.`;
    case 'failed':
      return `${title} could not be installed. ${state.reason.summary}`;
    case 'available':
      return `Cancelled ${title}. Nothing of it is kept.`;
    case 'queued':
    case 'downloading':
    case 'verifying':
    case 'removing':
      return `${title} is ${stateWords(state).toLowerCase()}.`;
  }
}
