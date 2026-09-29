/**
 * The public contract of AudioGubbins video reference.
 *
 * Picture as reference media (REQ-AUDIO-156, ADR-0046): the binding of a
 * picture's time to the shared media clock, exact frame arithmetic at a chosen
 * frame-rate interpretation, offset calibration, timecode, and the policy that
 * keeps the picture within a frame of the audio. The project holds no video
 * model; the video element, the file and the panel belong to the application.
 */

export {
  type ReferenceMediaClockBinding,
  bindingAtStart,
  calibratedTo,
  frameBoundariesWithin,
  frameBoundary,
  framePeriod,
  nudgedByFrames,
  pictureFrameAt,
  pictureTimeAt,
  pictureTimecodeAt,
  seekTimeFor,
} from './clock-binding.js';

export {
  type PictureCorrection,
  type PresentedPicture,
  type TransportMotion,
  pictureCorrection,
  pictureDrift,
} from './picture-sync.js';
