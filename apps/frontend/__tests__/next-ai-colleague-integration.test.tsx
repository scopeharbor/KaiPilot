/**
 * AI 同事三大能力端到端集成测试（v3-ui-next-ai-colleague W4 · tasks 4.3）。
 *
 * 使用真实 Store（next-ai-colleague-store + ai-colleague-intent），仅 mock
 * 网络边界（@/lib/api/ai-tools 的 execute/confirm）与 next/navigation 路由；
 * 经 NextTopbar 总装层驱动，验证四条闭环：
 *   1. 导航闭环：提问「去甘特图」→ 命中 navigate_to_space → router.push → NavigationResultCard；
 *   2. 查询闭环：「项目概况」→ ProjectSummaryCard；「任务列表」→ TaskListCard；
 *   3. 写操作闭环：「延期任务 12 至 2026-09-15」→ PREVIEW_REQUIRED → ActionPreviewCard
 *      → 用户确认 → /confirm 提交 → 已成功应用 + taskKeys 缓存失效；
 *   4. 409 冲突恢复闭环：确认遭遇 SCHEDULE_STALE → 冲突告警卡 → 重新演练 → 新预览；
 * 另覆盖诚实微标（⚡ 快捷规则匹配）与未识别意图回退 + 快捷入口平铺。
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextTopbar } from '@/components/next/layout/NextTopbar'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import { taskKeys } from '@/lib/api/tasks'
import type { AiToolExecuteEnvelope, AiToolConfirmEnvelope } from '@/lib/api/ai-tools'

const { navMocks, routerPush, executeMock, confirmMock } = vi.hoisted(() => ({
  navMocks: { pathname: '/next/projects/42' },
  routerPush: vi.fn(),
  executeMock: vi.fn(),
  confirmMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => navMocks.pathname,
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

const copilotStreamMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/copilot', () => ({
  copilotApi: { submitTurnStream: copilotStreamMock },
}))

vi.mock('@/lib/api/ai-tools', () => ({
  aiToolsApi: {
    list: vi.fn(),
    execute: executeMock,
    confirm: confirmMock,
    // 自由提问先经操作理解：判定「不是操作」再转模型问答
    plan: vi.fn(async () => ({
      isAction: false,
      actions: [],
      reply: null,
      clarification: null,
      rejected: [],
      model: null,
    })),
    suggestReplies: vi.fn(async () => []),
  },
  isScheduleStaleError: (error: unknown) =>
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'SCHEDULE_STALE',
}))

// ---------------------------------------------------------------- fixtures

const SUMMARY_DATA = {
  id: 42,
  name: '开项核心引擎',
  code: 'CORE-42',
  status: 'active',
  priority: 'high',
  startDate: '2026-08-01',
  endDate: '2026-12-31',
  taskCount: 37,
  completedTaskCount: 25,
  progressPercent: 68,
  memberCount: 6,
}

const TASKS_DATA = {
  items: [
    {
      id: 1,
      name: '看板列校准',
      status: 'in_progress',
      priority: 'high',
      endDate: '2026-09-20',
    },
  ],
  meta: { total: 24, page: 1, perPage: 5, totalPages: 5 },
}

const NAV_DATA = {
  path: '/next/projects/42?lens=gantt',
  lens: 'gantt',
  projectId: 42,
  depth: 'workbench',
  targetId: null,
}

const SCHEDULE_DIFF = {
  changes: [
    {
      taskId: 12,
      taskName: '核心引擎重构',
      before: { startDate: '2026-09-10', endDate: '2026-09-20', durationDays: 10 },
      after: { startDate: '2026-09-15', endDate: '2026-09-25', durationDays: 10 },
      reason: 'direct_move',
      dependencyIds: [],
    },
  ],
  warnings: [],
}

// ---------------------------------------------------------------- mocks

let previewSeq = 0

function resetNetworkMocks() {
  previewSeq = 0
  routerPush.mockReset()
  executeMock.mockReset()
  confirmMock.mockReset()
  executeMock.mockImplementation(
    async (
      toolName: string,
      parameters: Record<string, unknown>,
    ): Promise<AiToolExecuteEnvelope> => {
      switch (toolName) {
        case 'navigate_to_space':
          return { data: NAV_DATA, meta: { toolName, status: 'SUCCESS', durationMs: 8 } }
        case 'get_project_summary':
          return {
            data: SUMMARY_DATA,
            meta: { toolName, status: 'SUCCESS', durationMs: 9 },
          }
        case 'list_project_tasks':
          return { data: TASKS_DATA, meta: { toolName, status: 'SUCCESS', durationMs: 10 } }
        case 'update_task_schedule': {
          previewSeq += 1
          return {
            data: { taskId: parameters.taskId },
            meta: {
              toolName,
              status: 'PREVIEW_REQUIRED',
              durationMs: 8,
              previewToken: `tok-${previewSeq}`,
              diff: SCHEDULE_DIFF,
            },
          }
        }
        default:
          throw new Error(`unexpected tool ${toolName}`)
      }
    },
  )
  confirmMock.mockImplementation(
    async (input: { toolName: string; previewToken: string }): Promise<AiToolConfirmEnvelope> => ({
      data: { taskId: 12 },
      meta: { toolName: input.toolName, committed: true, durationMs: 5 },
    }),
  )
}

// ---------------------------------------------------------------- harness

function renderAssembly() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <NextTopbar />
    </QueryClientProvider>,
  )
  return { queryClient, view }
}

async function settleStoreUpdates() {
  // 让 Store 异步编排（intent → execute → 状态落定）在 act 窗口内完成，
  // 消除「React state update not wrapped in act」警告（修补6）
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** 触发一次面板按钮交互并等待 Store 异步状态全部落定。 */
async function clickAndSettle(click: () => void) {
  await act(async () => {
    click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function openPanelAndSend(text: string) {
  await settleStoreUpdates()
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /AI 唤起/ }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  const textarea = screen.getByRole('textbox', { name: '向 AI 同事发送指令' })
  await act(async () => {
    fireEvent.change(textarea, { target: { value: text } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  navMocks.pathname = '/next/projects/42'
  localStorage.clear()
  useNextTrackStore.getState().reset()
  useNextAiColleagueStore.setState({
    isOpen: false,
    messages: [],
    executionState: 'idle',
    pendingAction: null,
  })
  useProjectSpaceEntityStore.setState({ projectId: 42, entityTitle: '开项核心引擎' })
  document.documentElement.removeAttribute('data-immersion')
  resetNetworkMocks()
})

// ---------------------------------------------------------------- 闭环 1：导航

describe('AI 同事集成 · 导航闭环（navigate_to_space）', () => {
  test('提问「去甘特图」→ 命中规则 → router.push 直达 → NavigationResultCard', async () => {
    renderAssembly()
    await openPanelAndSend('去甘特图')

    await waitFor(() =>
      expect(executeMock).toHaveBeenCalledWith('navigate_to_space', {
        lens: 'gantt',
        depth: 'workbench',
        projectId: 42,
      }),
    )

    await screen.findByText('已为你导航至项目 42 的甘特图镜头')
    expect(document.querySelector('[data-card="navigate"]')).not.toBeNull()
    expect(routerPush).toHaveBeenCalledWith('/next/projects/42?lens=gantt')
    // 诚实微标：规则直连披露
    expect(screen.getByText('快捷规则匹配 · navigate_to_space')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------- 闭环 2：查询

describe('AI 同事集成 · 查询闭环（结构化卡片）', () => {
  test('提问「项目概况」→ 注入当前 projectId → ProjectSummaryCard', async () => {
    renderAssembly()
    await openPanelAndSend('项目概况')

    await waitFor(() =>
      expect(executeMock).toHaveBeenCalledWith('get_project_summary', { projectId: 42 }),
    )

    await screen.findByText('开项核心引擎')
    expect(document.querySelector('[data-card="project-summary"]')).not.toBeNull()
    expect(screen.getByText('快捷规则匹配 · get_project_summary')).toBeInTheDocument()
    expect(screen.getByText('68%')).toBeInTheDocument()
  })

  test('提问「任务列表」→ TaskListCard 条目化呈现与截断元数据', async () => {
    renderAssembly()
    await openPanelAndSend('任务列表')

    await waitFor(() =>
      expect(executeMock).toHaveBeenCalledWith('list_project_tasks', { projectId: 42 }),
    )

    await screen.findByText('看板列校准')
    expect(document.querySelector('[data-card="task-list"]')).not.toBeNull()
    expect(screen.getByText('展示前 1 项，共 24 项')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------- 闭环 3：写操作确认

describe('AI 同事集成 · 写操作两阶段确认闭环（RL-01）', () => {
  test('延期指令 → PREVIEW_REQUIRED → ActionPreviewCard → 确认 → confirm 提交 + 缓存失效', async () => {
    const { queryClient } = renderAssembly()
    // 预置任务缓存，供确认后失效断言
    queryClient.setQueryData(taskKeys.lists(42), [{ id: 1 }])
    queryClient.setQueryData(taskKeys.all, [{ id: 1 }])

    await openPanelAndSend('延期任务 12 至 2026-09-15')

    await waitFor(() =>
      expect(executeMock).toHaveBeenCalledWith('update_task_schedule', {
        taskId: 12,
        startDate: '2026-09-15',
        operation: 'move',
        projectId: 42,
      }),
    )

    // 阶段一：预览拦截，绝不落库
    await screen.findByText('写操作待确认 · 人工审查')
    expect(document.querySelector('[data-card="action-preview"]')).toHaveAttribute(
      'data-status',
      'preview',
    )
    expect(confirmMock).not.toHaveBeenCalled()
    expect(screen.getByText('#12 · 核心引擎重构')).toBeInTheDocument()
    expect(screen.getByText('2026-09-10')).toBeInTheDocument()
    expect(screen.getByText('2026-09-15')).toBeInTheDocument()

    // 阶段二：用户显式确认
    await clickAndSettle(() => fireEvent.click(screen.getByRole('button', { name: '确认应用' })))
    await screen.findByText('已成功应用')

    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(confirmMock).toHaveBeenCalledWith({
      toolName: 'update_task_schedule',
      previewToken: 'tok-1',
      parameters: { taskId: 12, startDate: '2026-09-15', operation: 'move', projectId: 42 },
    })
    expect(useNextAiColleagueStore.getState().executionState).toBe('idle')
    expect(useNextAiColleagueStore.getState().pendingAction).toBeNull()

    // 确认成功 → 任务缓存就地失效（W4 装配层）
    await waitFor(() => {
      expect(queryClient.getQueryState(taskKeys.lists(42))?.isInvalidated).toBe(true)
    })
    await waitFor(() => {
      expect(queryClient.getQueryState(taskKeys.all)?.isInvalidated).toBe(true)
    })
  })

  test('放弃取消：零 confirm 请求，卡片置为已放弃', async () => {
    renderAssembly()
    await openPanelAndSend('延期任务 12 至 2026-09-15')

    await screen.findByText('写操作待确认 · 人工审查')
    await clickAndSettle(() => fireEvent.click(screen.getByRole('button', { name: '放弃取消' })))

    await screen.findByText('已由用户放弃操作 · 未发起任何写请求')
    expect(confirmMock).not.toHaveBeenCalled()
    expect(useNextAiColleagueStore.getState().pendingAction).toBeNull()
  })
})

// ---------------------------------------------------------------- 闭环 4：409 恢复

describe('AI 同事集成 · 409 版本冲突恢复闭环（SCHEDULE_STALE）', () => {
  test('确认遭遇冲突 → 冲突告警卡 + 提交锁定 → 重新演练换取新预览', async () => {
    renderAssembly()
    await openPanelAndSend('延期任务 12 至 2026-09-15')
    await screen.findByText('写操作待确认 · 人工审查')

    // confirm 阶段返回 409 SCHEDULE_STALE
    confirmMock.mockImplementationOnce(() =>
      Promise.reject(
        Object.assign(new Error('排程数据已被他人并发修改或预览已过期（版本冲突 409）'), {
          code: 'SCHEDULE_STALE',
          status: 409,
        }),
      ),
    )
    await clickAndSettle(() => fireEvent.click(screen.getByRole('button', { name: '确认应用' })))

    await screen.findByText('排程数据已被他人并发修改或预览已过期（版本冲突 409）')
    expect(confirmMock).toHaveBeenCalledTimes(1)
    // 严禁假成功：无「已成功应用」，提交入口转为重新演练
    expect(screen.queryByText('已成功应用')).not.toBeInTheDocument()
    const card = document.querySelector('[data-card="action-preview"]')
    expect(card).toHaveAttribute('data-status', 'conflict')

    // 自愈：重新演练 → 重新 execute 生成新 previewToken 与新 Diff
    await clickAndSettle(() => fireEvent.click(screen.getByRole('button', { name: /重新演练/ })))
    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(2))
    expect(executeMock).toHaveBeenLastCalledWith('update_task_schedule', {
      taskId: 12,
      startDate: '2026-09-15',
      operation: 'move',
      projectId: 42,
    })

    // 换得新预览：回到 preview 待确认态，且未自动重发 confirm
    await screen.findByText('写操作待确认 · 人工审查')
    expect(document.querySelector('[data-card="action-preview"]')).toHaveAttribute(
      'data-status',
      'preview',
    )
    expect(confirmMock).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------- 诚实回退

describe('AI 同事集成 · 自由提问由模型回答', () => {
  test('未命中快捷规则：交给模型流式回答；新对话后空态快捷入口仍可直接发起', async () => {
    copilotStreamMock.mockImplementationOnce(
      async (_request: unknown, handlers: { onEvent: (e: unknown) => void }) => {
        handlers.onEvent({
          type: 'turn-meta',
          sequence: 1,
          sessionId: 'cps_1',
          destinations: ['general_qa'],
          intentSummary: '',
          scope: 'project',
        })
        handlers.onEvent({
          type: 'answer-delta',
          sequence: 2,
          delta: '**好的**，讲一个项目经理的笑话。',
        })
        handlers.onEvent({
          type: 'answer-done',
          sequence: 3,
          assistantMessageId: 'm1',
          contentSummary: '',
        })
      },
    )
    renderAssembly()
    await openPanelAndSend('给我讲个笑话吧')

    await screen.findByText(/讲一个项目经理的笑话/)
    expect(document.querySelector('[data-live-answer="done"]')).not.toBeNull()
    expect(screen.getByText('好的').tagName).toBe('STRONG') // Markdown 渲染
    // 零工具调用：自由提问绝不猜测执行写/查工具
    expect(executeMock).not.toHaveBeenCalled()

    // 新对话：清空后回到空态，快捷入口平铺（data-quick-action × 5）
    await clickAndSettle(() =>
      fireEvent.click(document.querySelector('[data-ai-colleague-new-conversation]')!),
    )
    expect(document.querySelectorAll('[data-quick-action]')).toHaveLength(5)

    // 点击快捷入口直接作为输入发送并完成查询闭环
    await clickAndSettle(() =>
      fireEvent.click(screen.getByRole('button', { name: /查看当前项目摘要/ })),
    )
    await screen.findByText('开项核心引擎')
    expect(executeMock).toHaveBeenCalledWith('get_project_summary', { projectId: 42 })
  })
})
