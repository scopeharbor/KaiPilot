import { apiFetch, apiRawFetch } from '@/lib/api-client'
import { runAnalysisJob, type AnalysisJobOptions } from './analysis-jobs'
import type {
  AiFixProjectDraftRequest,
  AiFixProjectDraftResponse,
  ConfirmProjectDraftRequest,
  ConfirmProjectDraftResponse,
  GenerateProjectDraftRequest,
  ProjectDraftDetail,
  ProjectDraftStreamEvent,
  ValidateProjectDraftRequest,
  ValidateProjectDraftResponse,
  DraftValidationReport,
  ConfirmedProjectContext,
  ProjectPlanUnderstanding,
  FeasibilityAssessment,
  FeasibilityNegotiationReply,
  FeasibilityNegotiationTurn,
  FeasibilityDecision,
  ReplanPreview,
} from '@aiproj/types'

export const aiDraftApi = {
  stream: (input: GenerateProjectDraftRequest) =>
    apiRawFetch('/ai/project-drafts/stream', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** 生成前的项目理解（问题 / 成功画面 / 能力地图）；不落库，返回服务端解析后的上下文。 */
  understanding: (
    input: {
      context: ConfirmedProjectContext
      connectionId?: number
      modelId?: number
      /** 实时输出频道编号：等待期间经 GET /ai/live-output/:id 看到模型正在吐出的文字。 */
      liveOutputId?: string
    },
    signal?: AbortSignal,
    options?: AnalysisJobOptions,
  ) =>
    runAnalysisJob<{ understanding: ProjectPlanUnderstanding; context: ConfirmedProjectContext }>(
      'understanding',
      input,
      signal,
      options,
    ),

  /** 生成前评估能否如期完成（模型估工作量、程序算产能与方案）；只读、不落库。 */
  feasibility: (input: {
    context: ConfirmedProjectContext
    connectionId?: number
    modelId?: number
    liveOutputId?: string
  }) =>
    apiFetch<{ assessment: FeasibilityAssessment }>('/ai/project-drafts/feasibility', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** 就能否如期完成对话商量：模型回应、提方案，程序核算数字；用户确认才生效。 */
  negotiateFeasibility: (input: {
    assessment: FeasibilityAssessment
    history: FeasibilityNegotiationTurn[]
    message: string
    connectionId?: number
    modelId?: number
    liveOutputId?: string
    /** 审查页：带草案编号时，模型提的方案按这份草案真实重排核算。 */
    draftId?: string
  }) => {
    const { draftId, ...body } = input
    return apiFetch<FeasibilityNegotiationReply>(
      draftId
        ? `/ai/project-drafts/${draftId}/replan/negotiate`
        : '/ai/project-drafts/feasibility/negotiate',
      { method: 'POST', body: JSON.stringify(body) },
    )
  },

  /** 审查页「能否如期完成」：按这份草案的实际排期给结论与方案（程序计算）。 */
  replanAssessment: (draftId: string) =>
    apiFetch<{ assessment: FeasibilityAssessment; version: number }>(
      `/ai/project-drafts/${draftId}/replan`,
    ),

  /** 按决定重排，只看前后对比（不落库）。 */
  replanPreview: (draftId: string, decision: Omit<FeasibilityDecision, 'decidedAt'>) =>
    apiFetch<{ preview: ReplanPreview; version: number }>(
      `/ai/project-drafts/${draftId}/replan/preview`,
      { method: 'POST', body: JSON.stringify({ decision }) },
    ),

  /** 用户确认：重排结果存成新的草案版本（仍是草案）。 */
  replanApply: (
    draftId: string,
    input: { decision: Omit<FeasibilityDecision, 'decidedAt'>; version: number },
  ) =>
    apiFetch<ProjectDraftDetail>(`/ai/project-drafts/${draftId}/replan/apply`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  get: (draftId: string) => apiFetch<ProjectDraftDetail>(`/ai/project-drafts/${draftId}`),

  events: (draftId: string, lastSequence?: number) => {
    const query = lastSequence ? `?after=${lastSequence}` : ''
    return apiRawFetch(`/ai/project-drafts/${draftId}/events${query}`)
  },

  save: (draftId: string) =>
    apiFetch<ProjectDraftDetail>(`/ai/project-drafts/${draftId}/save`, { method: 'POST' }),

  reject: (draftId: string) =>
    apiFetch<{ draftId: string; status: string }>(`/ai/project-drafts/${draftId}/reject`, {
      method: 'POST',
    }),

  /**
   * 复用同一会话重跑生成（SSE）：带原上下文 POST /retry，服务端加载
   * generationCheckpoint 断点续跑——已完成阶段不重新调模型，版本 +1。
   */
  retry: (draftId: string, input: GenerateProjectDraftRequest) =>
    apiRawFetch(`/ai/project-drafts/${draftId}/retry`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  confirm: (draftId: string, input: ConfirmProjectDraftRequest) =>
    apiFetch<ConfirmProjectDraftResponse>(`/ai/project-drafts/${draftId}/confirm`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  validate: (draftId: string, input: ValidateProjectDraftRequest = {}) =>
    apiFetch<ValidateProjectDraftResponse>(`/ai/project-drafts/${draftId}/validations`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** AI 同事全自动：模型针对阻断项提出字段修改（零写入，返回带着修改重算的校验）。 */
  aiFix: (draftId: string, input: AiFixProjectDraftRequest = {}) =>
    apiFetch<AiFixProjectDraftResponse>(`/ai/project-drafts/${draftId}/ai-fix`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  latestValidation: (draftId: string) =>
    apiFetch<DraftValidationReport | null>(`/ai/project-drafts/${draftId}/validations/latest`),
}

export const aiDraftKeys = {
  all: ['ai-draft'] as const,
  detail: (draftId: string) => [...aiDraftKeys.all, 'detail', draftId] as const,
}

export async function* consumeDraftSse(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<ProjectDraftStreamEvent> {
  if (!response.body) {
    throw new Error('SSE response body is null')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      if (signal?.aborted) break

      const read = reader.read()
      const { done, value } = signal
        ? await Promise.race([
            read,
            new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
              if (signal.aborted) {
                resolve({ done: true, value: undefined })
                return
              }
              signal.addEventListener('abort', () => resolve({ done: true, value: undefined }), {
                once: true,
              })
            }),
          ])
        : await read
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''

      for (const frame of frames) {
        const event = parseSseFrame(frame)
        if (event) yield event
      }
    }

    if (buffer.trim()) {
      const event = parseSseFrame(buffer)
      if (event) yield event
    }
  } finally {
    if (signal?.aborted) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export function parseSseFrame(frame: string): ProjectDraftStreamEvent | null {
  const lines = frame.split('\n')
  let eventType = 'message'
  const dataLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('event:')) eventType = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }

  const data = dataLines.join('\n')
  if (!data) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }

  const knownEventTypes = new Set([
    'draft.started',
    'module.delta',
    'module.completed',
    'draft.progress',
    'draft.heartbeat',
    'generation.output',
    'validation.warning',
    'draft.completed',
    'draft.failed',
  ])

  if (knownEventTypes.has(eventType) && typeof parsed === 'object' && parsed !== null) {
    const value = parsed as Record<string, unknown>
    if (
      value.type === eventType &&
      typeof value.draftId === 'string' &&
      typeof value.version === 'number' &&
      typeof value.sequence === 'number'
    ) {
      return parsed as ProjectDraftStreamEvent
    }
    return null
  }

  if (eventType === 'message' && typeof parsed === 'object' && parsed !== null) {
    const p = parsed as Record<string, unknown>
    if (typeof p.type === 'string' && typeof p.draftId === 'string') {
      return parsed as ProjectDraftStreamEvent
    }
  }

  return null
}
