/**
 * ai-draft-generation / T036 —— SSE 事件序列构造（design D4，tasks 3.4）。
 *
 * V2.5：新事件以 StreamingProgressEnvelope 为权威契约（§1.1），
 * 旧 ProjectDraftStreamEvent 仅作为兼容输入/输出窗口。
 *
 * 成功序列：draft.started → (module.delta{generating} + module.completed) × 9 →
 *   [validation.warning] → draft.completed。
 * 失败序列：draft.started → draft.failed。
 */

import { randomUUID } from 'node:crypto'
import {
  PROJECT_DRAFT_MODULES,
  STREAMING_PROGRESS_CONTRACT_VERSION,
  DOMAIN_AI_DRAFT,
  type DraftValidationReport,
  type ProjectDraftStreamEvent,
  type ProjectDraftGenerationStage,
  type ProjectDraftFailureError,
  type ProjectType,
  type StreamingProgressEnvelope,
  type StreamingDomain,
  type StreamingEventType,
} from '@aiproj/types'
import type { GenerateDraftResult } from './generation_service.ts'

// =============================================================================
// 1. 新版 StreamingProgressEnvelope 工厂函数
// =============================================================================

/** 为 AI Draft 事件创建 StreamingProgressEnvelope 的基础字段。 */
function baseEnvelope(
  streamId: string,
  sequence: number,
  type: StreamingEventType,
): Omit<StreamingProgressEnvelope, 'payload' | '_domainPayload'> {
  return {
    contractVersion: STREAMING_PROGRESS_CONTRACT_VERSION,
    eventId: `${streamId}-${sequence}-${randomUUID().slice(0, 8)}`,
    streamId,
    domain: DOMAIN_AI_DRAFT as StreamingDomain,
    sequence,
    occurredAt: new Date().toISOString(),
    type,
  }
}

export interface BuildEnvelopesArgs {
  draftUid: string
  version: number
  projectType: ProjectType
  result: GenerateDraftResult
  validation: DraftValidationReport | null
  /** 续接已有事件序列时的起始 sequence（retry 时从上一版本末尾继续）。 */
  startSequence?: number
}

/**
 * 以 StreamingProgressEnvelope 格式生成草案生成事件序列。
 * 这是权威格式，替代旧的 buildDraftStreamEvents。
 */
export function buildDraftStreamEnvelopes(args: BuildEnvelopesArgs): StreamingProgressEnvelope[] {
  const { draftUid, result, validation } = args
  const events: StreamingProgressEnvelope[] = []
  let seq = args.startSequence ?? 0

  // started
  seq++
  events.push({
    ...baseEnvelope(draftUid, seq, 'started'),
    payload: {},
    _domainPayload: {
      domain: DOMAIN_AI_DRAFT,
      draftId: draftUid,
      progress: {
        module: 'charter',
        moduleStatus: 'generating' as const,
      },
    },
  })

  if (result.status === 'completed' && result.draft) {
    for (const module of PROJECT_DRAFT_MODULES) {
      // module delta (generating)
      seq++
      events.push({
        ...baseEnvelope(draftUid, seq, 'progress'),
        payload: {
          phase: module,
          completedUnits:
            events.filter(
              (e) => e.type === 'progress' && e._domainPayload?.domain === DOMAIN_AI_DRAFT,
            ).length + 1,
          totalUnits: PROJECT_DRAFT_MODULES.length,
        },
        _domainPayload: {
          domain: DOMAIN_AI_DRAFT,
          draftId: draftUid,
          progress: { module, moduleStatus: 'generating' as const },
        },
      })

      // module completed
      seq++
      events.push({
        ...baseEnvelope(draftUid, seq, 'progress'),
        payload: {
          phase: module,
          completedUnits:
            events.filter(
              (e) => e.type === 'progress' && e._domainPayload?.domain === DOMAIN_AI_DRAFT,
            ).length + 1,
          totalUnits: PROJECT_DRAFT_MODULES.length,
        },
        _domainPayload: {
          domain: DOMAIN_AI_DRAFT,
          draftId: draftUid,
          progress: { module, moduleStatus: 'completed' as const },
        },
      })
    }

    if (validation && validation.warning.length > 0) {
      seq++
      events.push({
        ...baseEnvelope(draftUid, seq, 'progress'),
        payload: {
          phase: 'validation',
          completedUnits: events.filter((e) => e.type === 'progress').length + 1,
        },
        _domainPayload: {
          domain: DOMAIN_AI_DRAFT,
          draftId: draftUid,
        },
      })
    }

    seq++
    events.push({
      ...baseEnvelope(draftUid, seq, 'completed'),
      payload: {
        summary: `Draft ${draftUid} generated successfully`,
        resultId: draftUid,
      },
      _domainPayload: {
        domain: DOMAIN_AI_DRAFT,
        draftId: draftUid,
      },
    })
  } else {
    seq++
    events.push({
      ...baseEnvelope(draftUid, seq, 'failed'),
      payload: {
        errorCode: result.errorCode ?? 'AI_SERVICE_ERROR',
        messageCode: 'draft.generation.failed',
        stage: result.stage ?? result.meta?.failure?.stage,
        reasonCode: result.reasonCode ?? result.errorCode ?? result.meta?.failure?.reasonCode,
        errors:
          result.meta?.failure?.errors ??
          (result.errors
            ? result.errors.slice(0, 20).map((e) => ({ path: e.path, message: e.message }))
            : undefined),
      },
      _domainPayload: {
        domain: DOMAIN_AI_DRAFT,
        draftId: draftUid,
      },
    })
  }

  return events
}

/**
 * 旧版 buildDraftStreamEvents 的兼容参数类型。
 * 新代码应使用 BuildEnvelopesArgs + buildDraftStreamEnvelopes。
 */
export interface BuildEventsArgs extends BuildEnvelopesArgs {}

/**
 * 旧版兼容包装 —— 内部委托给 buildDraftStreamEnvelopes 并转换回旧格式。
 *
 * @deprecated 新代码应使用 buildDraftStreamEnvelopes（返回 StreamingProgressEnvelope[]）。
 */
export function buildDraftStreamEvents(args: BuildEventsArgs): ProjectDraftStreamEvent[] {
  const envelopes = buildDraftStreamEnvelopes(args)
  return envelopes.map((e) => envelopeToLegacyEvent(e, args.version, args.draftUid))
}

/**
 * 将 StreamingProgressEnvelope 转换为旧 ProjectDraftStreamEvent。
 * 用于向后兼容：读旧持久化事件、或旧消费者期望旧格式时使用。
 */
export function envelopeToLegacyEvent(
  envelope: StreamingProgressEnvelope,
  version: number,
  draftUid: string,
): ProjectDraftStreamEvent {
  const base = { draftId: draftUid, version, sequence: envelope.sequence }
  const domainPayload = envelope._domainPayload
  const module =
    domainPayload?.domain === DOMAIN_AI_DRAFT
      ? ((
          domainPayload as {
            domain: string
            draftId: string
            progress?: { module: string; moduleStatus: string }
          }
        ).progress?.module ?? 'charter')
      : 'charter'

  switch (envelope.type) {
    case 'started':
      return {
        ...base,
        type: 'draft.started',
        projectType: 'software' as const,
        modules: [...PROJECT_DRAFT_MODULES],
      } as unknown as ProjectDraftStreamEvent
    case 'progress':
      return {
        ...base,
        type: 'module.delta',
        module: module as never,
        status: 'generating' as const,
      } as unknown as ProjectDraftStreamEvent
    case 'heartbeat':
      return {
        ...base,
        type: 'draft.heartbeat',
        elapsedMs: 0,
      } as unknown as ProjectDraftStreamEvent
    case 'completed':
      return {
        ...base,
        type: 'draft.completed',
        draft: null as never,
        meta: null as never,
        validation: null as never,
      } as unknown as ProjectDraftStreamEvent
    case 'failed': {
      const payload = envelope.payload as {
        errorCode?: string
        stage?: ProjectDraftGenerationStage
        reasonCode?: string
        errors?: ProjectDraftFailureError[]
      }
      return {
        ...base,
        type: 'draft.failed',
        errorCode: payload.errorCode ?? 'AI_SERVICE_ERROR',
        message: '草案生成失败',
        consistency: 'failed',
        stage: payload.stage,
        reasonCode: payload.reasonCode,
        errors: payload.errors,
      } as unknown as ProjectDraftStreamEvent
    }
    default:
      return {
        ...base,
        type: 'draft.started',
        projectType: 'software',
        modules: [...PROJECT_DRAFT_MODULES],
      } as unknown as ProjectDraftStreamEvent
  }
}

/**
 * 将旧 ProjectDraftStreamEvent 转换为 StreamingProgressEnvelope。
 * 用于兼容输入：读旧持久化事件时归一化为新格式。
 */
export function legacyEventToEnvelope(
  event: ProjectDraftStreamEvent,
  streamId: string,
): StreamingProgressEnvelope {
  const base = {
    contractVersion: STREAMING_PROGRESS_CONTRACT_VERSION,
    eventId: `${streamId}-${event.sequence}-legacy`,
    streamId,
    domain: DOMAIN_AI_DRAFT as StreamingDomain,
    sequence: event.sequence,
    occurredAt: new Date().toISOString(),
  }

  switch (event.type) {
    case 'draft.started':
      return {
        ...base,
        type: 'started',
        payload: {},
        _domainPayload: { domain: DOMAIN_AI_DRAFT, draftId: event.draftId },
      }
    case 'module.delta':
      return {
        ...base,
        type: 'progress',
        payload: { phase: event.module, completedUnits: 0 },
        _domainPayload: {
          domain: DOMAIN_AI_DRAFT,
          draftId: event.draftId,
          progress: { module: event.module, moduleStatus: event.status },
        },
      }
    case 'module.completed':
      return {
        ...base,
        type: 'progress',
        payload: { phase: event.module, completedUnits: 1 },
        _domainPayload: {
          domain: DOMAIN_AI_DRAFT,
          draftId: event.draftId,
          progress: { module: event.module, moduleStatus: 'completed' },
        },
      }
    case 'draft.progress':
      return {
        ...base,
        type: 'progress',
        payload: { phase: event.phase, completedUnits: 0 },
        _domainPayload: { domain: DOMAIN_AI_DRAFT, draftId: event.draftId },
      }
    case 'draft.heartbeat':
      return {
        ...base,
        type: 'heartbeat',
        payload: {},
        _domainPayload: { domain: DOMAIN_AI_DRAFT, draftId: event.draftId },
      }
    case 'validation.warning':
      return {
        ...base,
        type: 'progress',
        payload: { phase: 'validation' },
        _domainPayload: { domain: DOMAIN_AI_DRAFT, draftId: event.draftId },
      }
    case 'draft.completed':
      return {
        ...base,
        type: 'completed',
        payload: { summary: 'completed', resultId: event.draftId },
        _domainPayload: { domain: DOMAIN_AI_DRAFT, draftId: event.draftId },
      }
    case 'draft.failed':
      return {
        ...base,
        type: 'failed',
        payload: {
          errorCode: event.errorCode ?? 'AI_SERVICE_ERROR',
          stage: event.stage,
          reasonCode: event.reasonCode,
          errors: event.errors,
        },
        _domainPayload: { domain: DOMAIN_AI_DRAFT, draftId: event.draftId },
      }
    default:
      return {
        ...base,
        type: 'started',
        payload: {},
        _domainPayload: {
          domain: DOMAIN_AI_DRAFT,
          draftId: (event as { draftId: string }).draftId,
        },
      }
  }
}
