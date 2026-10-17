import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  parseColleagueIntent,
  RECYCLE_BIN_SEARCH_TOOL_NAME,
  type ColleagueContext,
} from '@/lib/next/ai-colleague-intent'
import { RecycleTaskPreviewCard } from '@/components/next/ai/cards/RecycleTaskPreviewCard'
import * as invalidationNet from '@/lib/task-query-invalidation'

function setupJsdom() {
  if (typeof window.PointerEvent === 'undefined') {
    class PointerEventMock extends MouseEvent {}
    window.PointerEvent = PointerEventMock as unknown as typeof PointerEvent
  }
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers({ 'Content-Type': 'application/json' }),
  } as unknown as Response
}

const projectCtx: ColleagueContext = {
  contextType: 'project_space',
  currentProjectId: 42,
  pathname: '/next/projects/42',
}

describe('AI 同事回收站自然语言找回与人工确认恢复（W4 · 4.7 / 4.8）', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setupJsdom()

    fetchSpy = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const urlStr = String(url)
      const method = init?.method ?? 'GET'

      if (urlStr.includes('/recycle-bin') && method === 'GET') {
        return Promise.resolve(
          jsonResponse(200, {
            data: [
              {
                id: 88,
                projectId: 42,
                name: '接口验收测试',
                status: 'completed',
                priority: 'high',
                assigneeId: null,
                deletedAt: '2026-09-05T09:00:00Z',
              },
            ],
            meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
          }),
        )
      }

      if (urlStr.includes('/batch-restore') && method === 'POST') {
        return Promise.resolve(
          jsonResponse(200, {
            data: {
              action: 'restore',
              total: 1,
              successCount: 1,
              failedCount: 0,
              results: [{ taskId: 88, success: true }],
            },
          }),
        )
      }

      return Promise.resolve(jsonResponse(200, { data: [] }))
    })

    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('测试自然语言输入「帮我找回上周删掉的验收任务」命中回收站找回意图', () => {
    const intent = parseColleagueIntent('帮我找回上周删掉的验收任务', projectCtx)

    expect(intent.toolName).toBe(RECYCLE_BIN_SEARCH_TOOL_NAME)
    expect(intent.matchedRuleId).toBe('rule_recycle_bin_search')
    expect(intent.confidence).toBe(1)
    expect(intent.intentSource).toBe('rule_preset')
    expect(intent.parameters).toEqual(
      expect.objectContaining({
        search: '验收',
        projectId: 42,
      }),
    )
  })

  test('测试自然语言指定任务编号「恢复误删的任务 42」命中意图并提取 taskId', () => {
    const intent = parseColleagueIntent('恢复误删的任务 42', projectCtx)

    expect(intent.toolName).toBe(RECYCLE_BIN_SEARCH_TOOL_NAME)
    expect(intent.matchedRuleId).toBe('rule_recycle_bin_search')
    expect(intent.confidence).toBe(1)
    expect(intent.parameters).toEqual(
      expect.objectContaining({
        taskId: 42,
        projectId: 42,
      }),
    )
  })

  test('测试卡片回显已删除任务与琥珀色待确认徽标', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <RecycleTaskPreviewCard projectId={42} search="验收" />
      </QueryClientProvider>,
    )

    // 规则匹配与琥珀色待确认徽标
    expect(await screen.findByText(/快捷规则匹配 · recycle_bin_search/)).toBeInTheDocument()
    expect(screen.getByText(/⚡ 待确认恢复/)).toBeInTheDocument()

    // 回显已删除任务
    expect(await screen.findByText('接口验收测试')).toBeInTheDocument()
    expect(screen.getByText('#88')).toBeInTheDocument()
    expect(screen.getByText(/原状态: 已完成/)).toBeInTheDocument()

    // 确认恢复按钮常驻
    expect(screen.getByRole('button', { name: /确认恢复/ })).toBeInTheDocument()
  })

  test('RL-01 严苛测试：渲染卡片后 AI 不得自动调用恢复写接口', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <RecycleTaskPreviewCard projectId={42} search="验收" />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('接口验收测试')).toBeInTheDocument()

    // 严苛断言：绝不发出 POST batch-restore 请求
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('/batch-restore'),
      expect.anything(),
    )
  })

  test('测试用户点击确认恢复后发送 POST 恢复请求并刷新视图', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(invalidationNet, 'invalidateTaskQueries')
    const onRestored = vi.fn()

    render(
      <QueryClientProvider client={queryClient}>
        <RecycleTaskPreviewCard projectId={42} search="验收" onRestored={onRestored} />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('接口验收测试')).toBeInTheDocument()

    // 用户显式点击确认恢复
    const confirmBtn = screen.getByRole('button', { name: /确认恢复/ })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      // 触发向后端的恢复请求
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/projects/42/tasks/batch-restore'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ taskIds: [88] }),
        }),
      )
      // 触发集中失效网刷新
      expect(invalidateSpy).toHaveBeenCalledWith(queryClient, 42)
      expect(onRestored).toHaveBeenCalledWith([88])
    })

    // 卡片展示已恢复绿色成功态
    expect(await screen.findByText('已恢复至项目空间')).toBeInTheDocument()
    expect(screen.getByText(/任务已成功找回并恢复至项目空间/)).toBeInTheDocument()
  })
})
