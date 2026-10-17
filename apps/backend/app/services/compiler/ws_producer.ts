import {
  publishProgressEnvelope,
  publishRealtimeLog,
  isStreamingWsEnabled,
} from '#services/streaming/streaming_ws_service'
import logger from '@adonisjs/core/services/logger'

export interface StageProgressData {
  streamId: string
  stageId: string
  phase: string
  attempt: number
  sequence: number
  status: 'started' | 'progress' | 'completed' | 'failed'
  durationMs?: number
  safeRefs?: string[]
  hash?: string
  messageCode?: string
  errorCode?: string
}

export function publishCompilerStageProgress(
  organizationId: number,
  domain: string,
  data: StageProgressData,
): void {
  if (!isStreamingWsEnabled()) return
  try {
    const eventType =
      data.status === 'started'
        ? ('started' as const)
        : data.status === 'completed'
          ? ('completed' as const)
          : data.status === 'failed'
            ? ('failed' as const)
            : ('progress' as const)
    const envelope: Record<string, unknown> = {
      contractVersion: '1.0',
      eventId: `${data.streamId}-${data.sequence}`,
      streamId: data.streamId,
      domain: 'compiler' as const,
      sequence: data.sequence,
      occurredAt: new Date().toISOString(),
      type: eventType,
      payload: {
        phase: data.phase,
        messageCode: data.messageCode,
        errorCode: data.errorCode,
      },
      _domainPayload: {
        domain: 'compiler',
        runId: data.streamId,
        progress: {
          stageId: data.stageId,
          attempt: data.attempt,
        },
      },
    }
    publishProgressEnvelope(organizationId, domain || 'compiler', data.streamId, envelope as never)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown'
    logger.warn({ streamId: data.streamId, error: message }, 'Compiler WebSocket 广播失败（旁路）')
  }
}

export function publishCompilerRealtimeLog(
  organizationId: number,
  streamId: string,
  stageId: string,
  phase: string,
  attempt: number,
  messageCode: string,
  severity: 'info' | 'warn' | 'error',
  count?: number,
  durationMs?: number,
  safeRefs?: string[],
): void {
  if (!isStreamingWsEnabled()) return
  try {
    publishRealtimeLog(organizationId, 'compiler', streamId, {
      streamId,
      stageId,
      phase,
      attempt,
      severity,
      messageCode,
      count,
      durationMs,
      safeRefs,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown'
    logger.warn({ streamId, stageId, error: message }, 'Compiler 实时日志广播失败（旁路）')
  }
}

export function publishCodeGenerationProgress(
  organizationId: number,
  streamId: string,
  stageId: string,
  phase: string,
  attempt: number,
  sequence: number,
  status: 'started' | 'progress' | 'completed',
  safeRefs?: string[],
  hash?: string,
  messageCode?: string,
): void {
  const data: StageProgressData = {
    streamId,
    stageId,
    phase,
    attempt,
    sequence,
    status,
    safeRefs,
    hash,
    messageCode,
  }
  publishCompilerStageProgress(organizationId, 'code-generation', data)
}
