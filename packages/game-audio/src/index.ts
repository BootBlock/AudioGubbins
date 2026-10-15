/**
 * The public contract of AudioGubbins game audio (ADR-0100).
 *
 * The game-audio domain as values. Its export layer (ADR-0102) names a
 * group's members by a template read by the export's own grammar, places
 * their files in a relative destination folder, and resolves a game export
 * profile to the export settings Phase 09 plans, renders and delivers.
 *
 * Portable: no clock, browser global or thread. Nothing here imports anything
 * of an engine integration, which depends on these contracts instead.
 */

export { type DestinationPath, destinationPath } from './export/destination-path.js';
export { type GameExportProfile, profileFromPreset } from './export/game-export-profile.js';
export { type NamingTemplate, namingTemplate } from './export/naming-template.js';
