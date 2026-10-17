import { buildDraftStreamEnvelopes } from './events.js'
import {
  publishProgressEnvelope,
  isStreamingWsEnabled,
} from '#services/streaming/streaming_ws_service'
import logger from '@adonisjs/core/services/logger'

export interface PublishDraftProgressToWsArgs {
  organizationId: number
  draftUid: string
  version: number
  projectType: string
  result: unknown
  validation: unknown | null
  startSequence?: number
}

export function publishDraftProgressToWs(args: PublishDraftProgressToWsArgs): void {
  if (!isStreamingWsEnabled()) return
  try {
    const envelopes = buildDraftStreamEnvelopes({
      draftUid: args.draftUid,
      version: args.version,
      projectType: args.projectType as never,
      result: args.result as never,
      validation: args.validation as never,
      startSequence: args.startSequence,
    })
    for (const envelope of envelopes) {
      publishProgressEnvelope(args.organizationId, 'ai-draft', args.draftUid, envelope)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown'
    logger.warn(
      { draftUid: args.draftUid, error: message },
      'AI Draft WebSocket 广播失败（旁路，不影响 SSE）',
    )
  }
}

export default { publishDraftProgressToWs }
