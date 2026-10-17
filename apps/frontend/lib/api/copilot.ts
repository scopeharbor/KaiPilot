/**
 * v3-copilot-live-submission-channel —— Copilot 回合 API 客户端（任务 5.1）。
 * v3-copilot-live-streaming-output —— 流式回合 API 客户端（SSE 增量）。
 *
 * 复用既有 `apiFetch`（自动附 token、401 静默 refresh 后重放、统一解包 `data`），
 * 不手滚缓存与错误处理。
 *
 * 提及候选**不在此实现**——复用既有 `searchApi.suggestions`（`/search/suggestions`），
 * 权限与组织过滤留在既有 search service 内，避免第二条过滤路径（spec REQ）。
 *
 * v3-copilot-productized-operating-entry 追加只读 readiness 端点（任务 4.1）。
 */

import {
  apiFetch,
  API_BASE_URL,
  refreshSession,
  assertAuthScopeCurrent,
  type ApiError,
} from '@/lib/api-client'
import { getAuthScopeRevision, useAuthStore } from '@/stores/auth-store'
import type {
  CopilotEntryReadinessSnapshot,
  CopilotStreamEvent,
  CopilotTurnRequest,
  CopilotTurnResponse,
} from '@aiproj/types'
import { parseCopilotEntryReadinessSnapshot } from '@aiproj/types'

const BASE = '/copilot'

/** readiness 请求 scope（组织 + 可选项目）。 */
export interface CopilotReadinessScope {
  readonly organizationId: number | null
  readonly projectId: number | null
}

/** 流式回合消费回调。 */
export interface CopilotStreamHandlers {
  /** 流打开（首帧前；已拿到响应头）。 */
  readonly onOpen?: () => void
  /** 每帧事件。 */
  readonly onEvent: (event: CopilotStreamEvent) => void
  /** 流结束（终态事件后或异常后）。 */
  readonly onEnd?: () => void
}

/**
 * 解析单个 SSE 帧为 Copilot 流事件。
 *
 * 后端每个帧形如：
 *   id: 3
 *   event: answer-delta
 *   data: {"type":"answer-delta","sequence":3,"delta":"…"}
 * 未知 event 名 / 非 JSON / 形状不合规 → null（跳过该帧）。
 */
export function parseCopilotSseFrame(frame: string): CopilotStreamEvent | null {
  let eventName = 'message'
  const dataLines: string[] = []
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim()
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
  if (!parsed || typeof parsed !== 'object') return null
  const event = parsed as Partial<CopilotStreamEvent> & { type?: unknown; sequence?: unknown }
  const type = event.type
  if (
    typeof type !== 'string' ||
    typeof event.sequence !== 'number' ||
    !Number.isInteger(event.sequence)
  ) {
    return null
  }
  if (eventName !== type) return null // event: 行与载荷类型必须一致
  return event as CopilotStreamEvent
}

/**
 * 从 SSE 原始字节流片段解析出多个 Copilot 流事件。
 * 传入未完成的 tail，会在返回值中原样返回 `pending`，供下次调用拼回。
 */
export function parseCopilotSseFrames(
  chunk: string,
  pending: string,
): { events: CopilotStreamEvent[]; pending: string } {
  const buf = pending + chunk
  const lastBoundary = buf.lastIndexOf('\n\n')
  if (lastBoundary < 0) {
    return { events: [], pending: buf }
  }
  const framesRaw = buf.slice(0, lastBoundary).split('\n\n')
  const rest = buf.slice(lastBoundary + 2)
  const events: CopilotStreamEvent[] = []
  for (const frame of framesRaw) {
    const parsed = parseCopilotSseFrame(frame)
    if (parsed) events.push(parsed)
  }
  return { events, pending: rest }
}

/** 解析非 2xx 响应为统一 ApiError（对齐 api-client 内部语义）。 */
async function toStreamApiError(res: Response): Promise<ApiError> {
  let code = 'UNKNOWN'
  let message = res.statusText
  let details: unknown
  try {
    const body = await res.json()
    code = body?.error?.code ?? code
    message = body?.error?.message ?? message
    details = body?.error?.details
  } catch {
    /* 非 JSON 响应，保留默认 */
  }
  return { status: res.status, code, message, details }
}

export const copilotApi = {
  /** POST /api/v1/copilot/turns —— 提交一次回合（非流式，向后兼容）。 */
  submitTurn: (request: CopilotTurnRequest) =>
    apiFetch<CopilotTurnResponse>(`${BASE}/turns`, {
      method: 'POST',
      body: JSON.stringify(request),
      headers: { 'Content-Type': 'application/json' },
    }),

  /**
   * POST /api/v1/copilot/turns/stream —— 流式提交一次回合。
   *
   * 消费 SSE：解析帧 → 逐帧回调事件。HTTP 错误（4xx/5xx）以 `ApiError` 抛出，
   * 由调用方按既有失败分类处理；401 先做一次静默 refresh 后重放。传输层的
   * 流中断（读流抛错）同样向上抛出，交由调用方分类（不伪造完成）。
   *
   * 注意：本函数**不**做自动重连；中断后由调用方决定是否重试。
   */
  submitTurnStream: async (
    request: CopilotTurnRequest,
    handlers: CopilotStreamHandlers,
  ): Promise<void> => {
    const url = `${API_BASE_URL}${BASE}/turns/stream`
    const revision = getAuthScopeRevision()
    const controller = new AbortController()
    const unsubscribe = useAuthStore.subscribe(() => {
      if (revision !== getAuthScopeRevision()) controller.abort()
    })
    const consume = async (): Promise<boolean> => {
      assertAuthScopeCurrent(revision)
      const headers = new Headers({ 'Content-Type': 'application/json' })
      const { accessToken } = useAuthStore.getState()
      if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
      const res = await fetch(url, {
        method: 'POST',
        body: JSON.stringify(request),
        headers,
        signal: controller.signal,
      })
      assertAuthScopeCurrent(revision)
      if (!res.ok) throw await toStreamApiError(res)
      if (!res.body) return true

      handlers.onOpen?.()
      const reader = res.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let pending = ''
      try {
        for (;;) {
          const { done, value } = await reader.read()
          assertAuthScopeCurrent(revision)
          if (done) break
          const { events, pending: nextPending } = parseCopilotSseFrames(
            decoder.decode(value, { stream: true }),
            pending,
          )
          pending = nextPending
          for (const event of events) {
            handlers.onEvent(event)
            if (
              event.type === 'answer-done' ||
              event.type === 'turn-clarify' ||
              event.type === 'turn-route' ||
              event.type === 'turn-error'
            ) {
              return true
            }
          }
        }
      } finally {
        // 传输中断：异常自发上抛，由调用方分类（保留已消费部分由调用方决定）
        reader.releaseLock()
      }
      return true
    }

    try {
      await consume()
      assertAuthScopeCurrent(revision)
      handlers.onEnd?.()
    } catch (error) {
      assertAuthScopeCurrent(revision)
      const status = (error as { status?: number }).status
      if (status === 401) {
        const refreshed = await refreshSession()
        assertAuthScopeCurrent(revision)
        // refresh token 被判无效时 refreshSession 已清空会话；临时故障（后端重启等）保留登录。
        if (!refreshed) throw error
        try {
          await consume()
          assertAuthScopeCurrent(revision)
          handlers.onEnd?.()
        } catch (retryError) {
          assertAuthScopeCurrent(revision)
          if ((retryError as { status?: number }).status === 401) {
            useAuthStore.getState().clear()
          }
          throw retryError
        }
        return
      }
      // 传输错误/HTTP 错误：不调 onEnd（避免 onEnd 兜底覆盖真实错误分类），
      // 直接抛出由调用方按既有失败分类处理。
      throw error
    } finally {
      unsubscribe()
    }
  },

  /**
   * GET /api/v1/copilot/readiness —— 宿主就绪快照（只读）。
   *
   * 响应必须通过严格契约解析：未知字段/未知枚举/越界一律 fail closed，
   * 解析失败当作不可用错误抛出，**不得**回退到部分可用状态。
   */
  readiness: async (scope: CopilotReadinessScope): Promise<CopilotEntryReadinessSnapshot> => {
    const query =
      scope.projectId !== null ? `?projectId=${encodeURIComponent(scope.projectId)}` : ''
    const raw = await apiFetch<unknown>(`${BASE}/readiness${query}`)
    const parsed = parseCopilotEntryReadinessSnapshot(raw)
    if (!parsed.ok) {
      throw {
        status: 502,
        code: 'AI_SERVICE_ERROR',
        message: '就绪快照格式不受支持',
      }
    }
    return parsed.snapshot
  },
}

/** 分层 query keys（与既有 API 客户端约定一致）。 */
export const copilotKeys = {
  all: ['copilot'] as const,
  turns: () => [...copilotKeys.all, 'turns'] as const,
  session: (sessionId: string) => [...copilotKeys.all, 'session', sessionId] as const,
  /**
   * readiness 缓存键**必须**绑定组织 + 项目 scope：
   * scope 变化即换 key，旧 snapshot 无法驱动新 scope 的提交（design D5）。
   */
  readiness: (scope: CopilotReadinessScope) =>
    [...copilotKeys.all, 'readiness', scope.organizationId ?? 0, scope.projectId ?? 0] as const,
}
