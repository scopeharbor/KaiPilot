/**
 * v3-unified-ai-feedback-ledger —— 服务层 barrel export。
 */

export {
  projectFromDraftLayerChanges,
  queryFeedbackEvents,
  combinedProjection,
  mapReviewStatusToFeedbackType,
  mapEntityTypeToArtifactKind,
  deriveCapabilitySurface,
  computeDraftLayerDeduplicationKey,
} from './projection_service.js'

export { mapRationaleFeedback, mapAssistantFeedback } from './endpoint_adapter.js'

export { aggregateAdoptionRate, downstreamSummary, listEvents } from './aggregation_service.js'

export { recordFeedbackEvent } from './recorder.js'
