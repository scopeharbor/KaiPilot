/**
 * v3-triz-copilot-followups · tasks 7.1/7.2 —— B1 确认链成功回执与 adopt 接线测试。
 *
 * 覆盖：
 * 1. 模拟信号卡进入求解流（运行态带 sourceSignalId）→ 触发确认落库成功 →
 *    断言 adopt 请求携带正确 signalId 与 analysisId；
 * 2. 断言调用次序严格为 confirm 成功之后才发 adopt；若 confirm 失败绝不发 adopt；
 * 3. 409 容错：后端 adopt 返回 409 Conflict 时界面维持成功态不弹红，中性吞下；
 * 4. 网络异常（500）时中性记录警告，不影响落库回执展示；
 * 5. 自由对话发起的求解（无 sourceSignalId）在确认落库成功后不调用 adopt。
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AiColleagueMessageList } from '@/components/next/ai/AiColleagueMessageList'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'
import { useAuthStore } from '@/stores/auth-store'
import { jsonResponse } from './helpers/chart-gallery-network'
import { makeInterventionDiff, makeRun, TRIZ_PROJECT_ID } from './_next-triz-copilot-fixtures'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}))

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

interface FetchCall {
  url: string
  method: string
  body: Record<string, unknown> | null
  timestamp: number
}

function setAuth(
  permissions: string[] = ['project:view', 'task:view', 'ai:trigger', 'ai:confirm'],
) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

describe('tasks 7.1/7.2 B1 确认链成功回执接线与 adopt 回写', () => {
  let calls: FetchCall[] = []
  let adoptHandler: ((call: FetchCall) => Response) | null = null
  let confirmHandler: ((call: FetchCall) => Response) | null = null

  beforeEach(() => {
    calls = []
    adoptHandler = null
    confirmHandler = null
    setAuth()

    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      let body: Record<string, unknown> | null = null
      if (typeof init?.body === 'string') {
        try {
          body = JSON.parse(init.body) as Record<string, unknown>
        } catch {
          body = null
        }
      }
      const record: FetchCall = { url, method, body, timestamp: Date.now() }
      calls.push(record)

      if (url.includes('/ai/tools/confirm')) {
        if (confirmHandler) return confirmHandler(record)
        return jsonResponse(200, {
          data: {
            target: 'task',
            entityId: 999,
            committed: true,
            provenance: {
              analysisId: 1024,
              solutionIndex: 1,
              principleNumber: 10,
              confirmedByUserId: 1,
            },
          },
          meta: {
            toolName: 'create_task_from_intervention',
            committed: true,
            durationMs: 35,
          },
        })
      }

      if (url.includes('/signals/') && url.includes('/adopt')) {
        if (adoptHandler) return adoptHandler(record)
        return jsonResponse(200, {
          data: {
            id: 88,
            projectId: TRIZ_PROJECT_ID,
            status: 'adopted',
            adoptedAnalysisId: 1024,
          },
        })
      }

      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${url}` } })
    })

    vi.stubGlobal('fetch', fetchMock)

    useNextAiColleagueStore.setState({
      isOpen: true,
      executionState: 'idle',
      messages: [],
      pendingAction: null,
      pendingTriz: null,
      context: {
        contextType: 'project_space',
        currentProjectId: TRIZ_PROJECT_ID,
        pathname: `/next/projects/${TRIZ_PROJECT_ID}`,
        permissions: ['project:view', 'task:view', 'ai:trigger', 'ai:confirm'],
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test('带 sourceSignalId 触发确认落库成功：adopt 请求携带正确 signalId 与 analysisId，次序严格在 confirm 之后', async () => {
    const previewToken = 'preview-token-xyz-123'
    const messageId = 'msg-triz-solve-1'
    const sourceSignalId = 88
    const analysisId = 1024

    const run = makeRun({
      phase: 'preview_ready',
      projectId: TRIZ_PROJECT_ID,
      sourceSignalId,
      analysisId,
      previewToken,
      targetKind: 'task',
      selectedSolutionIndex: 1,
      diff: makeInterventionDiff('task'),
    })

    useNextAiColleagueStore.setState({
      messages: [
        {
          id: messageId,
          sender: 'assistant',
          timestamp: Date.now(),
          trizRun: run,
        },
      ],
      pendingTriz: {
        messageId,
        toolName: 'create_task_from_intervention',
        previewToken,
        parameters: {
          projectId: TRIZ_PROJECT_ID,
          analysisId,
          solutionIndex: 1,
        },
      },
      executionState: 'awaiting_confirmation',
    })

    renderWithClient(<AiColleagueMessageList onQuickAction={() => {}} />)

    // 界面呈现「确认落库」按钮
    const confirmButton = screen.getByRole('button', { name: '确认落库' })
    expect(confirmButton).toBeInTheDocument()

    fireEvent.click(confirmButton)

    // 等待回执渲染
    await screen.findByText(/已确认落库：/)
    expect(screen.getByText('#999')).toBeInTheDocument()

    // 断言网络请求：必须同时有 confirm 与 adopt
    const confirmCall = calls.find((c) => c.url.includes('/ai/tools/confirm'))
    const adoptCall = calls.find((c) => c.url.includes('/adopt'))

    expect(confirmCall).toBeDefined()
    expect(adoptCall).toBeDefined()

    // 断言 adopt 请求路径包含 projectId 与 signalId
    expect(adoptCall!.url).toContain(`/projects/${TRIZ_PROJECT_ID}/signals/${sourceSignalId}/adopt`)
    expect(adoptCall!.method).toBe('POST')

    // 断言 adopt 请求载荷包含 analysisId
    expect(adoptCall!.body).toEqual({ analysisId })

    // 断言调用次序严格为 confirm 在前，adopt 在后
    const confirmIndex = calls.indexOf(confirmCall!)
    const adoptIndex = calls.indexOf(adoptCall!)
    expect(confirmIndex).toBeLessThan(adoptIndex)
    expect(confirmCall!.timestamp).toBeLessThanOrEqual(adoptCall!.timestamp)

    // 运行态已落定 committed 终态
    const state = useNextAiColleagueStore.getState()
    const currentRun = state.messages[0]?.trizRun
    expect(currentRun?.phase).toBe('committed')
    expect(currentRun?.receipt?.entityId).toBe(999)
    expect(currentRun?.error).toBeNull()
  })

  test('confirm 失败时绝不调用 adopt', async () => {
    confirmHandler = () =>
      jsonResponse(500, {
        error: { code: 'INTERNAL_ERROR', message: '数据库落库失败' },
      })

    const previewToken = 'preview-token-fail-1'
    const messageId = 'msg-triz-fail-1'
    const sourceSignalId = 88
    const analysisId = 1024

    const run = makeRun({
      phase: 'preview_ready',
      projectId: TRIZ_PROJECT_ID,
      sourceSignalId,
      analysisId,
      previewToken,
      targetKind: 'task',
      selectedSolutionIndex: 1,
      diff: makeInterventionDiff('task'),
    })

    useNextAiColleagueStore.setState({
      messages: [{ id: messageId, sender: 'assistant', timestamp: Date.now(), trizRun: run }],
      pendingTriz: {
        messageId,
        toolName: 'create_task_from_intervention',
        previewToken,
        parameters: { projectId: TRIZ_PROJECT_ID, analysisId, solutionIndex: 1 },
      },
      executionState: 'awaiting_confirmation',
    })

    renderWithClient(<AiColleagueMessageList onQuickAction={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '确认落库' }))

    await waitFor(() => {
      expect(useNextAiColleagueStore.getState().executionState).toBe('error')
    })

    // confirm 发出但失败，adopt 零调用
    expect(calls.some((c) => c.url.includes('/ai/tools/confirm'))).toBe(true)
    expect(calls.some((c) => c.url.includes('/adopt'))).toBe(false)
  })

  test('后端 adopt 返回 409 Conflict（已被采纳）：界面维持成功态不弹红，控制台输出中性日志', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    adoptHandler = () =>
      jsonResponse(409, {
        error: {
          code: 'CONFLICT',
          message: '信号当前状态为「adopted」，只有待处理（open）信号可以流转为采纳',
        },
      })

    const previewToken = 'preview-token-conflict-409'
    const messageId = 'msg-triz-conflict-409'
    const sourceSignalId = 88
    const analysisId = 1024

    const run = makeRun({
      phase: 'preview_ready',
      projectId: TRIZ_PROJECT_ID,
      sourceSignalId,
      analysisId,
      previewToken,
      targetKind: 'task',
      selectedSolutionIndex: 1,
      diff: makeInterventionDiff('task'),
    })

    useNextAiColleagueStore.setState({
      messages: [{ id: messageId, sender: 'assistant', timestamp: Date.now(), trizRun: run }],
      pendingTriz: {
        messageId,
        toolName: 'create_task_from_intervention',
        previewToken,
        parameters: { projectId: TRIZ_PROJECT_ID, analysisId, solutionIndex: 1 },
      },
      executionState: 'awaiting_confirmation',
    })

    renderWithClient(<AiColleagueMessageList onQuickAction={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '确认落库' }))

    // 成功渲染回执，绝不向用户呈现红色错误警告
    await screen.findByText(/已确认落库：/)
    expect(screen.getByText('#999')).toBeInTheDocument()
    expect(screen.queryByText(/信号当前状态为/)).toBeNull()
    expect(screen.queryByText(/CONFLICT/)).toBeNull()

    // 运行态依然是 committed 且 error 为 null
    const finalRun = useNextAiColleagueStore.getState().messages[0]?.trizRun
    expect(finalRun?.phase).toBe('committed')
    expect(finalRun?.error).toBeNull()

    // 验证 console.info 捕获了中性幂等日志
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('[TrizSignal] Signal already adopted, ignoring conflict.'),
    )
  })

  test('后端 adopt 发生其他异常（500）：界面仍维持 committed 成功态，中性记录 warning', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    adoptHandler = () =>
      jsonResponse(500, {
        error: { code: 'INTERNAL_ERROR', message: '雷达回写服务网络超时' },
      })

    const previewToken = 'preview-token-warn-500'
    const messageId = 'msg-triz-warn-500'
    const sourceSignalId = 88
    const analysisId = 1024

    const run = makeRun({
      phase: 'preview_ready',
      projectId: TRIZ_PROJECT_ID,
      sourceSignalId,
      analysisId,
      previewToken,
      targetKind: 'task',
      selectedSolutionIndex: 1,
      diff: makeInterventionDiff('task'),
    })

    useNextAiColleagueStore.setState({
      messages: [{ id: messageId, sender: 'assistant', timestamp: Date.now(), trizRun: run }],
      pendingTriz: {
        messageId,
        toolName: 'create_task_from_intervention',
        previewToken,
        parameters: { projectId: TRIZ_PROJECT_ID, analysisId, solutionIndex: 1 },
      },
      executionState: 'awaiting_confirmation',
    })

    renderWithClient(<AiColleagueMessageList onQuickAction={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '确认落库' }))

    // 回执依旧正常展示（落库是已完成的业务事实，信号回写失败不影响回执展示）
    await screen.findByText(/已确认落库：/)
    expect(screen.getByText('#999')).toBeInTheDocument()

    const finalRun = useNextAiColleagueStore.getState().messages[0]?.trizRun
    expect(finalRun?.phase).toBe('committed')

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[TrizSignal] Adopt signal backflow failed:'),
      expect.anything(),
    )
  })

  test('自由对话发起的求解（无 sourceSignalId）：确认落库成功后零 adopt 调用', async () => {
    const previewToken = 'preview-token-free-convo'
    const messageId = 'msg-triz-free-convo'
    const analysisId = 1024

    // 自由对话发起：sourceSignalId 为 null
    const run = makeRun({
      phase: 'preview_ready',
      projectId: TRIZ_PROJECT_ID,
      sourceSignalId: null,
      analysisId,
      previewToken,
      targetKind: 'task',
      selectedSolutionIndex: 1,
      diff: makeInterventionDiff('task'),
    })

    useNextAiColleagueStore.setState({
      messages: [{ id: messageId, sender: 'assistant', timestamp: Date.now(), trizRun: run }],
      pendingTriz: {
        messageId,
        toolName: 'create_task_from_intervention',
        previewToken,
        parameters: { projectId: TRIZ_PROJECT_ID, analysisId, solutionIndex: 1 },
      },
      executionState: 'awaiting_confirmation',
    })

    renderWithClient(<AiColleagueMessageList onQuickAction={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '确认落库' }))

    await screen.findByText(/已确认落库：/)

    // confirm 正常执行
    expect(calls.some((c) => c.url.includes('/ai/tools/confirm'))).toBe(true)
    // 但 adopt 绝不调用
    expect(calls.some((c) => c.url.includes('/adopt'))).toBe(false)
  })
})
