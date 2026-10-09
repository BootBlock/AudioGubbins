/**
 * The public contract of AudioGubbins recording.
 *
 * Recording as values (ADR-0070): the recording session's states and the
 * transitions between them, monitoring as a second machine apart from it, the
 * capture profiles and what each asks a browser for, the comparison of what
 * was asked with what the browser granted, the loopback calibration's analysis
 * and the compensation it gives a take, the retrospective buffer's setting and
 * arithmetic, the storage time a recording has left, the scheduling of a
 * controlled recording, and the diagnostics that explain what the browser and
 * the hardware can do. It depends on the domain and text alone and knows no
 * browser, storage or audio host: the application composes it with the
 * capabilities adapter, the audio runtime and the storage client, which do the
 * work these values decide.
 */

export {
  type DeviceIdentity,
  type OutputIdentity,
  UNKNOWN_OUTPUT,
  isSameDevice,
} from './device-identity.js';

export {
  type CaptureOffer,
  type CapturePlan,
  type CaptureProfile,
  CaptureProfileKind,
  type CaptureRequest,
  PROCESSING_CONTROLS,
  PROFILE_NAME_CHARACTERS,
  type ProcessingChoice,
  ProcessingControl,
  RAW_STUDIO_PROFILE,
  VOICE_PROFILE,
  capturePlan,
  customProfile,
  processingOf,
  withHeadphones,
} from './capture-profile.js';

export {
  type CaptureComparison,
  type CaptureDifference,
  type GrantedCapture,
  type UncontrollableProcessing,
  compareCapture,
} from './capture-comparison.js';

export {
  type Armed,
  type ArmedInput,
  type ArmedPurpose,
  CLOSED_SESSION,
  type InputIndicator,
  type OpenInput,
  type RecordingSession,
  type RecordingStart,
  type SessionSetup,
  type StopReason,
  inputIndicator,
  inputIsOpen,
  stoppedUnexpectedly,
} from './session-state.js';

export { type SessionEvent } from './session-events.js';

export { nextSession } from './session-transition.js';

export {
  type ChainVerdict,
  type FeedbackRisk,
  MONITORING_UNAVAILABLE,
  type Monitoring,
  type MonitoringContext,
  type MonitoringEvent,
  type MonitoringLatency,
  type MonitoringPath,
  type MonitoringRoute,
  feedbackRisk,
  monitoringLatency,
  nextMonitoring,
} from './monitoring.js';

export {
  CALIBRATION_SIGNAL_LENGTH,
  CALIBRATION_SIGNAL_PEAK,
  calibrationSignal,
} from './calibration-signal.js';

export {
  type LoopbackMeasurement,
  MAXIMUM_ROUND_TRIP_SECONDS,
  MINIMUM_PEAK_RATIO,
  loopbackCaptureLength,
  measureRoundTrip,
} from './loopback-analysis.js';

export {
  type CalibrationPath,
  type CompensationBasis,
  type LatencyCalibration,
  type MeasuredLatency,
  type PathChange,
  type ReportedLatency,
  type TakeCompensation,
  calibrationOf,
  manualCalibration,
  measuredCalibration,
  pathChanges,
  takeCompensation,
  withManualOffset,
} from './latency-calibration.js';

export {
  MAXIMUM_RETROSPECTIVE_SECONDS,
  MINIMUM_RETROSPECTIVE_SECONDS,
  RETROSPECTIVE_OFF,
  type RetrospectiveSetting,
  retrospectiveFrames,
  retrospectiveMemory,
  retrospectiveOn,
} from './retrospective-buffer.js';

export {
  STORAGE_WARNING_SECONDS,
  type StorageEstimate,
  type StorageTimeLeft,
  recordingBytesPerSecond,
  storageTimeLeft,
} from './storage-time.js';

export {
  type ControlledRecording,
  type PunchWindow,
  type RecordingSchedule,
  SUSPENSION_CAUTION,
  type ScheduleFacts,
  type SchedulePhase,
  type ScheduleStep,
  punchWindow,
  scheduleRecording,
  scheduleStep,
} from './controlled-recording.js';

export {
  type CalibrationStanding,
  DiagnosticSeverity,
  type RecordingDiagnostic,
  type RecordingFacts,
} from './diagnostic-facts.js';

export { HIGH_LATENCY_SECONDS } from './latency-diagnostics.js';

export { recordingBlocked, recordingDiagnostics } from './recording-diagnostics.js';
