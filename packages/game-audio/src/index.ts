/**
 * The public contract of AudioGubbins game audio (ADR-0100).
 *
 * The game-audio domain as values. Its asset groups (ADR-0101) form one
 * forest whose policy each member resolves field by field, with the group or
 * override every value comes from; a group's processing is heard through each
 * inheriting member's rack, and the users of a chain count the groups that
 * name it. Its export layer (ADR-0102) names a group's members by a template
 * read by the export's own grammar, places their files in a relative
 * destination folder, and resolves a game export profile to the export
 * settings Phase 09 plans, renders and delivers: many members planned as one
 * itemised plan, each item planned or refused with its owner named. Its game
 * preview (ADR-0104) simulates a scenario's emitters by the authored rules
 * over the one counter-based generator, as an event log that is the reference
 * an engine's runtime reproduces, and makes the log a plan the engine plays,
 * continued as hand triggers arrive without changing what was heard; its
 * scenarios are project state beside the groups they play.
 *
 * Portable: no clock, browser global or thread. Nothing here imports anything
 * of an engine integration, which depends on these contracts instead.
 */

export { type CaseModifier, inCase } from './export/case-modifiers.js';
export { type DestinationPath, destinationPath } from './export/destination-path.js';
export { type GameExportProfile, profileFromPreset } from './export/game-export-profile.js';
export { type NamingTemplate, namingTemplate } from './export/naming-template.js';
export {
  type GameExportItem,
  type GameExportPlan,
  type GameExportProvenance,
  type GameExportRequest,
  planGameExport,
} from './export/game-export-plan.js';
export { type RegionMember, type RegionName, memberNames } from './export/member-names.js';

export { type GameAssetGroupId } from './groups/group-ids.js';
export { type GameAssetGroup } from './groups/game-asset-group.js';
export { type GameAudioState, NO_GAME_AUDIO, holdsNoGameAudio } from './groups/game-audio-state.js';
export { groupPath } from './groups/group-forest.js';
export { pathText } from './groups/group-names.js';
export {
  type GroupMember,
  type GroupMembership,
  type MemberProcessing,
  memberKey,
} from './groups/membership.js';
export { validateGameAudioState } from './groups/state-validation.js';

export { POLICY_FIELDS, type PolicyField, type PolicyValues } from './policy/policy-fields.js';
export {
  type InheritedPolicy,
  OVERRIDABLE_FIELDS,
  type OverridableField,
  type PolicyOverrides,
  isOverridableField,
  withOverride,
  withPolicyField,
} from './policy/inherited-policy.js';
export { type LoudnessTarget } from './policy/loudness-target.js';
export { type BusName, busName } from './policy/bus-name.js';
export {
  type Attenuation,
  DEFAULT_EMITTER_RULES,
  DEFAULT_VOICE_VARIATION,
  type DistanceFilter,
  type EmitterRules,
  type SelectionRule,
  type VoiceStealing,
  type VoiceVariation,
} from './policy/playback-rules.js';
export {
  type EffectivePolicy,
  type GroupEffectivePolicy,
  type PolicySource,
  type Resolved,
  type ResolvedTag,
  resolveAll,
  resolveGroupPolicy,
  resolvePolicy,
} from './policy/policy-resolution.js';
export { inheritedProcessing, inheritingRacks } from './policy/processing-realisation.js';
export {
  type StateChainUsers,
  projectChainUsers,
  stateChainUseCount,
} from './policy/chain-users.js';

export {
  type BusLevel,
  type GamePreviewScenario,
  type GamePreviewScenarioId,
  type Listener,
  type Motion,
  type Position,
  type PreviewEmitter,
  type PreviewEmitterId,
  type PreviewSubject,
  type TriggerPattern,
  type Waypoint,
  previewScenarioProblems,
  scenarioSubjectProblems,
} from './preview/preview-scenario.js';
export {
  type MemberSound,
  type PoolMember,
  type PreviewSubjects,
  previewSubjects,
} from './preview/preview-subjects.js';
export {
  type PreviewEvent,
  type PreviewEventLog,
  type RefusedEvent,
  type StartedEvent,
  type VoiceEndEvent,
} from './preview/preview-event-log.js';
export { type HandAction } from './preview/trigger-schedule.js';
export {
  type PreviewInput,
  type PreviewSimulation,
  type SimulationState,
  simulatePreview,
} from './preview/preview-simulation.js';
export { previewVoiceBudget } from './preview/voice-budget.js';
export { type PreviewControls } from './preview/plan-layout.js';
export { type PreviewPlanBuild } from './preview/plan-build.js';
export { type PreviewPlan, extendPreviewPlan, previewPlan } from './preview/preview-plan.js';
