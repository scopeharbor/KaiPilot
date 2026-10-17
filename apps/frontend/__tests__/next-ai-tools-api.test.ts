/**
 * AI 工具编排层 API 客户端封装测试（v3-ui-next-ai-colleague W1 · tasks 1.2）。
 *
 * Mock `@/lib/api-client` 的 `apiFetchEnvelope`，验证：
 * - GET /ai/tools 元数据信封直通；
 * - POST /ai/tools/execute 的请求路径/方法/载荷序列化与 SUCCESS / PREVIEW_REQUIRED 信封；
 * - POST /ai/tools/confirm 提交载荷与 committed 结果；
 * - 409 SCHEDULE_STALE / TOKEN_EXPIRED 精准映射为 AiToolScheduleConflictError，
 *   403/404 及其他错误原样透传（RL-01 冲突防御：严禁静默吞错）。
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  aiToolsApi,
  AiToolScheduleConflictError,
  isScheduleStaleError,
  isToolPreviewRequired,
  isToolSuccess,
  SCHEDULE_STALE_ERROR_CODE,
  TOKEN_EXPIRED_ERROR_CODE,
} from '@/lib/api/ai-tools'

const mocks = vi.hoisted(() => ({
  apiFetchEnvelope: vi.fn(),
  apiFetch: vi.fn(),
}))

vi.mock('@/lib/api-client', () => ({
  apiFetch: mocks.apiFetch,
  apiFetchEnvelope: mocks.apiFetchEnvelope,
}))

import { apiFetchEnvelope } from '@/lib/api-client'

const SUCCESS_ENVELOPE = {
  data: { path: '/next/projects/42?lens=gantt', lens: 'gantt', projectId: 42 },
  meta: { toolName: 'navigate_to_space', status: 'SUCCESS', durationMs: 12 },
}

const PREVIEW_ENVELOPE = {
  data: { projectId: 42, committed: false, changes: [] },
  meta: {
    toolName: 'update_task_schedule',
    status: 'PREVIEW_REQUIRED',
    durationMs: 8,
    previewToken: 'a'.repeat(64),
    diff: [{ taskId: 12, from: '2026-09-10', to: '2026-09-15' }],
  },
}

function apiError(status: number, code: string, message: string) {
  return Object.assign(new Error(message), { status, code, message })
}

beforeEach(() => {
  mocks.apiFetchEnvelope.mockReset()
  mocks.apiFetch.mockReset()
})

describe('aiToolsApi.list — 工具注册表元数据', () => {
  test('GET /ai/tools 信封直通（含 meta.total）', async () => {
    const meta = [
      { name: 'get_project_summary', description: '项目摘要', param: {}, sideEffect: 'read' },
      { name: 'navigate_to_space', description: '导航', param: {}, sideEffect: 'navigate' },
    ]
    mocks.apiFetchEnvelope.mockResolvedValue({ data: meta, meta: { total: 2 } })

    const envelope = await aiToolsApi.list()

    expect(apiFetchEnvelope).toHaveBeenCalledWith('/ai/tools')
    expect(envelope.data).toHaveLength(2)
    expect(envelope.meta.total).toBe(2)
    expect(envelope.data[0]?.name).toBe('get_project_summary')
  })
})

describe('aiToolsApi.execute — 统一执行入口', () => {
  test('15s 超时：AbortController 中止在途请求并映射为 timeout 错误（修补4a）', async () => {
    vi.useFakeTimers()
    try {
      // 模拟真实 fetch 行为：signal abort 时拒绝
      mocks.apiFetchEnvelope.mockImplementation(
        (_path: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted.', 'AbortError')),
            )
          }),
      )

      const pending = aiToolsApi.execute('get_project_summary', { projectId: 42 })
      // 先挂上吸收器避免提前拒绝时的 unhandled rejection，再推进 15s 触发 abort
      const outcome = pending.then(
        () => 'resolved',
        (e: unknown) => e,
      )
      await vi.advanceTimersByTimeAsync(15_000)

      const result = await outcome
      expect(result).toMatchObject({
        code: 'REQUEST_TIMEOUT',
        kind: 'timeout',
        status: 408,
        message: '请求超时，请检查网络后重试',
      })
      // 透传的 AbortSignal 到达 apiFetchEnvelope
      const init = mocks.apiFetchEnvelope.mock.calls[0]?.[1] as RequestInit | undefined
      expect(init?.signal).toBeInstanceOf(AbortSignal)
    } finally {
      vi.useRealTimers()
    }
  })

  test('正常请求不受超时门限影响，且不残留计时器', async () => {
    mocks.apiFetchEnvelope.mockResolvedValue(SUCCESS_ENVELOPE)
    const envelope = await aiToolsApi.execute('navigate_to_space', {
      lens: 'gantt',
      depth: 'workbench',
      projectId: 42,
    })
    expect(envelope.meta.status).toBe('SUCCESS')
  })

  test('只读/导航工具返回 SUCCESS 信封与分类器', async () => {
    mocks.apiFetchEnvelope.mockResolvedValue(SUCCESS_ENVELOPE)

    const envelope = await aiToolsApi.execute('navigate_to_space', {
      lens: 'gantt',
      depth: 'workbench',
      projectId: 42,
    })

    const [url, init] = mocks.apiFetchEnvelope.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/ai/tools/execute')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      toolName: 'navigate_to_space',
      parameters: { lens: 'gantt', depth: 'workbench', projectId: 42 },
    })
    expect(envelope.meta.status).toBe('SUCCESS')
    expect(envelope.meta.previewToken).toBeUndefined()
    expect(isToolSuccess(envelope)).toBe(true)
    expect(isToolPreviewRequired(envelope)).toBe(false)
  })

  test('写工具阶段一返回 PREVIEW_REQUIRED 信封（previewToken + diff）', async () => {
    mocks.apiFetchEnvelope.mockResolvedValue(PREVIEW_ENVELOPE)

    const envelope = await aiToolsApi.execute('update_task_schedule', {
      projectId: 42,
      taskId: 12,
      startDate: '2026-09-15',
      operation: 'move',
    })

    expect(envelope.meta.status).toBe('PREVIEW_REQUIRED')
    expect(envelope.meta.previewToken).toHaveLength(64)
    expect(envelope.meta.diff).toEqual(PREVIEW_ENVELOPE.meta.diff)
    expect(isToolPreviewRequired(envelope)).toBe(true)
    expect(isToolSuccess(envelope)).toBe(false)
  })

  test('409 SCHEDULE_STALE 映射为 AiToolScheduleConflictError', async () => {
    mocks.apiFetchEnvelope.mockRejectedValue(apiError(409, 'SCHEDULE_STALE', '排程已过期'))

    const error = await aiToolsApi.execute('update_task_schedule', {}).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(AiToolScheduleConflictError)
    const conflict = error as AiToolScheduleConflictError
    expect(conflict.status).toBe(409)
    expect(conflict.code).toBe(SCHEDULE_STALE_ERROR_CODE)
    expect(conflict.message).toBe('排程已过期')
    expect(isScheduleStaleError(conflict)).toBe(true)
  })

  test('409 TOKEN_EXPIRED 同样映射为冲突错误', async () => {
    mocks.apiFetchEnvelope.mockRejectedValue(apiError(409, 'TOKEN_EXPIRED', '令牌过期'))

    const error = await aiToolsApi.execute('update_task_schedule', {}).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(AiToolScheduleConflictError)
    expect((error as AiToolScheduleConflictError).code).toBe(TOKEN_EXPIRED_ERROR_CODE)
    expect(isScheduleStaleError(error)).toBe(true)
  })

  test('403 Forbidden 原样透传（权限拒绝由卡片层呈现）', async () => {
    const forbidden = apiError(403, 'PERMISSION_DENIED', '缺少 ai:trigger 权限')
    mocks.apiFetchEnvelope.mockRejectedValue(forbidden)

    const error = await aiToolsApi.execute('get_project_summary', {}).catch((e: unknown) => e)

    expect(error).toBe(forbidden)
    expect((error as Error).message).toBe('缺少 ai:trigger 权限')
    expect(isScheduleStaleError(error)).toBe(false)
    expect(error).not.toBeInstanceOf(AiToolScheduleConflictError)
  })

  test('404 Not Found 原样透传（RL-05 中性呈现边界）', async () => {
    const notFound = apiError(404, 'RESOURCE_NOT_FOUND', '未找到指定的项目资源')
    mocks.apiFetchEnvelope.mockRejectedValue(notFound)

    const error = await aiToolsApi.execute('get_project_summary', {}).catch((e: unknown) => e)

    expect(error).toBe(notFound)
    expect((error as { status?: number }).status).toBe(404)
    expect(isScheduleStaleError(error)).toBe(false)
  })

  test('未知错误（非 ApiError）原样透传且不误判为冲突', async () => {
    const networkError = new TypeError('Failed to fetch')
    mocks.apiFetchEnvelope.mockRejectedValue(networkError)

    const error = await aiToolsApi.execute('list_project_tasks', {}).catch((e: unknown) => e)

    expect(error).toBe(networkError)
    expect(isScheduleStaleError(error)).toBe(false)
  })

  test('普通 500 透传且不触发冲突映射', async () => {
    mocks.apiFetchEnvelope.mockRejectedValue(apiError(500, 'INTERNAL_ERROR', '内部错误'))

    const error = await aiToolsApi.execute('list_project_risks', {}).catch((e: unknown) => e)

    expect((error as { status?: number }).status).toBe(500)
    expect(error).not.toBeInstanceOf(AiToolScheduleConflictError)
  })
})

describe('aiToolsApi.confirm — 写操作两阶段确认', () => {
  test('确认载荷路径与 committed 结果', async () => {
    mocks.apiFetchEnvelope.mockResolvedValue({
      data: { committed: true },
      meta: { toolName: 'update_task_schedule', committed: true, durationMs: 30 },
    })

    const envelope = await aiToolsApi.confirm({
      toolName: 'update_task_schedule',
      previewToken: 'b'.repeat(64),
      parameters: { projectId: 42, taskId: 12, startDate: '2026-09-15', operation: 'move' },
    })

    const [url, init] = mocks.apiFetchEnvelope.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/ai/tools/confirm')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      toolName: 'update_task_schedule',
      previewToken: 'b'.repeat(64),
      parameters: { projectId: 42, taskId: 12, startDate: '2026-09-15', operation: 'move' },
    })
    expect(envelope.meta.committed).toBe(true)
  })

  test('确认阶段遭遇 409 冲突同样映射并携带原始错误码', async () => {
    mocks.apiFetchEnvelope.mockRejectedValue(apiError(409, 'SCHEDULE_STALE', '并发修改'))

    const error = await aiToolsApi
      .confirm({ toolName: 'update_task_schedule', previewToken: 'c'.repeat(64), parameters: {} })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(AiToolScheduleConflictError)
    expect((error as AiToolScheduleConflictError).code).toBe('SCHEDULE_STALE')
    expect(isScheduleStaleError(error)).toBe(true)
  })

  test('确认阶段 403/404 原样透传', async () => {
    const forbidden = apiError(403, 'PERMISSION_DENIED', '缺少 task:update 权限')
    mocks.apiFetchEnvelope.mockRejectedValue(forbidden)

    const error = await aiToolsApi
      .confirm({ toolName: 'update_task_schedule', previewToken: 'd'.repeat(64), parameters: {} })
      .catch((e: unknown) => e)

    expect(error).toBe(forbidden)
    expect(isScheduleStaleError(error)).toBe(false)
  })
})

describe('错误映射契约 — isScheduleStaleError 对原始 ApiError 形态的兜底识别', () => {
  test('裸 ApiError 形态（未包装）的 SCHEDULE_STALE 同样识别', () => {
    expect(isScheduleStaleError(apiError(409, 'SCHEDULE_STALE', 'x'))).toBe(true)
    expect(isScheduleStaleError(apiError(409, 'TOKEN_EXPIRED', 'x'))).toBe(true)
    expect(isScheduleStaleError(apiError(409, 'OTHER_CODE', 'x'))).toBe(false)
    expect(isScheduleStaleError(apiError(400, 'SCHEDULE_STALE', 'x'))).toBe(false)
    expect(isScheduleStaleError(null)).toBe(false)
    expect(isScheduleStaleError('boom')).toBe(false)
    expect(isScheduleStaleError(undefined)).toBe(false)
  })
})
