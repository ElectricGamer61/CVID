/**
 * Adapter exports for timeline utility dependencies.
 * Editor modules should import timeline utility helpers from here.
 */

export {
  createClassicTrack,
  createDefaultAdjustmentItem,
  createScrubThrottleState,
  shouldCommitScrubFrame,
  createDefaultShapeItem,
  createTextTemplateItem,
  findCompatibleTrackForItemType,
  findNearestAvailableSpace,
  getDefaultActiveTrackId,
  getDefaultGeneratedLayerDurationInFrames,
  getTrackKind,
  resolveEffectiveTrackStates,
  getMaxTransitionDurationForHandles,
  resolveTransitionTargetFromSelection,
  searchTimelineTranscript,
  timelineToSourceFrames,
  sourceToTimelineFrames,
  linkItems,
} from './timeline-contract'
export type { TranscriptSearchMatch } from './timeline-contract'
