/**
 * AI 同事消息时间线测试（v3-ui-next-ai-colleague W2 · tasks 2.4）。
 *
 * 覆盖：空态 HUD 徽标/愿景/4 快捷引导卡片（label 渲染 + 点击以 fill 作为输入发送）、
 * 多轮消息时间线自底向上正序渲染、用户/AI 语义容器分离、执行中发丝线行、
 * W3 卡片族分发（摘要卡规则直达微标、写预览卡确认/取消/409 重新演练接线、
 * 404 中性回显 RL-05、导航成功自动 router.push、未注册工具兜底键值对卡）、
 * aria-live 读屏语义。
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AiColleagueMessageList } from '@/components/next/ai/AiColleagueMessageList'
import { COLLEAGUE_QUICK_ENTRIES } from '@/lib/next/ai-colleague-intent'
import { getColleagueStoreMock } from './_next-ai-colleague-mock'
import type { ColleagueMessage, ColleagueToolExecution } from '@/stores/next-ai-colleague-store'

const pushMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}))

vi.mock('@/stores/next-ai-colleague-store', async () => {
  const { getColleagueStoreMock } = await import('./_next-ai-colleague-mock')
  return { useNextAiColleagueStore: getColleagueStoreMock().hook }
})

beforeEach(() => {
  getColleagueStoreMock().reset()
  pushMock.mockReset()
})

function setMessages(messages: ColleagueMessage[]) {
  act(() => {
    getColleagueStoreMock().hook.setState({ messages })
  })
}

function userMessage(id: string, content: string): ColleagueMessage {
  return { id, sender: 'user', content, timestamp: 1 }
}

function assistantExec(
  id: string,
  execution: Omit<ColleagueToolExecution, 'intentSource'> & {
    intentSource?: ColleagueToolExecution['intentSource']
  },
): ColleagueMessage {
  return {
    id,
    sender: 'assistant',
    timestamp: 1,
    toolExecution: { intentSource: 'rule_preset', ...execution },
  }
}

describe('components/next/ai/AiColleagueMessageList（空态与快捷引导）', () => {
  test('初始空态渲染 HUD 徽标、能力愿景与 4 个预置快捷引导卡片', () => {
    render(<AiColleagueMessageList onQuickAction={vi.fn()} />)

    expect(screen.getByText('开项 AI 同事')).toBeInTheDocument()
    expect(screen.getByText(/一句话直达工作镜头、结构化洞察项目数据/)).toBeInTheDocument()

    expect(COLLEAGUE_QUICK_ENTRIES).toHaveLength(5)
    for (const entry of COLLEAGUE_QUICK_ENTRIES) {
      expect(screen.getByRole('button', { name: new RegExp(entry.label) })).toBeInTheDocument()
    }
  })

  test('点击快捷引导卡片，以预置 fill 值作为输入发送', () => {
    const onQuickAction = vi.fn()
    render(<AiColleagueMessageList onQuickAction={onQuickAction} />)

    fireEvent.click(screen.getByRole('button', { name: /查看当前项目摘要/ }))
    expect(onQuickAction).toHaveBeenCalledWith('查看当前项目摘要')

    fireEvent.click(screen.getByRole('button', { name: /前往甘特图镜头/ }))
    expect(onQuickAction).toHaveBeenCalledWith('去甘特图')

    fireEvent.click(screen.getByRole('button', { name: /任务排程延期演练/ }))
    expect(onQuickAction).toHaveBeenCalledWith('延期任务 12 至 2026-09-15')
    expect(onQuickAction).toHaveBeenCalledTimes(3)
  })

  test('存在消息后空态引导不再渲染', () => {
    render(<AiColleagueMessageList onQuickAction={vi.fn()} />)
    setMessages([userMessage('u1', '查看当前项目摘要')])

    expect(screen.queryByTestId('ai-colleague-empty')).not.toBeInTheDocument()
    expect(document.querySelectorAll('[data-quick-action]')).toHaveLength(0)
  })
})

describe('components/next/ai/AiColleagueMessageList（时间线与语义容器）', () => {
  test('多轮消息按时间正序渲染，用户/AI 语义容器分离且用户消息居右', () => {
    render(<AiColleagueMessageList onQuickAction={vi.fn()} />)

    setMessages([
      userMessage('u1', '查看项目摘要'),
      assistantExec('a1', {
        toolName: 'get_project_summary',
        status: 'success',
        data: {
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
        },
      }),
      userMessage('u2', '列出进行中的任务'),
    ])

    const senders = Array.from(document.querySelectorAll('[data-msg-sender]'))
    expect(senders.map((el) => el.getAttribute('data-msg-sender'))).toEqual([
      'user',
      'assistant',
      'user',
    ])

    const userBubbles = Array.from(document.querySelectorAll('[data-msg-sender="user"]'))
    expect(userBubbles[0]?.textContent ?? '').toContain('查看项目摘要')
    expect(userBubbles[0]?.textContent ?? '').toContain('你')
    expect(userBubbles[1]?.textContent ?? '').toContain('列出进行中的任务')

    // 用户消息（右侧天青小标）与 AI 卡片（左侧 HUD 发丝线容器）语义分离：
    // 摘要卡不属于任何用户气泡。
    expect(userBubbles.some((el) => el.querySelector('[data-card]'))).toBe(false)
  })

  test('时间线容器声明 aria-live="polite" 与 aria-relevant="additions"', () => {
    render(<AiColleagueMessageList onQuickAction={vi.fn()} />)
    const timeline = screen.getByTestId('ai-colleague-timeline')
    expect(timeline).toHaveAttribute('aria-live', 'polite')
    expect(timeline).toHaveAttribute('aria-relevant', 'additions')
  })

  test('执行中状态渲染发丝线呼吸行并标注工具名', () => {
    render(<AiColleagueMessageList onQuickAction={vi.fn()} />)
    setMessages([assistantExec('a1', { toolName: 'get_project_summary', status: 'executing' })])

    expect(document.querySelector('[data-tool-executing]')).toHaveAttribute(
      'data-tool-name',
      'get_project_summary',
    )
    expect(screen.getByText(/正在执行工具 get_project_summary/)).toBeInTheDocument()
  })
})

describe('components/next/ai/AiColleagueMessageList（W3 卡片族分发）', () => {
  test('项目摘要成功结果渲染 ProjectSummaryCard 并诚实标注「⚡ 快捷规则匹配」', () => {
    render(<AiColleagueMessageList onQuickAction={vi.fn()} />)
    setMessages([
      assistantExec('a1', {
        toolName: 'get_project_summary',
        status: 'success',
        data: {
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
        },
      }),
    ])

    const card = document.querySelector('[data-card="project-summary"]')
    expect(card).not.toBeNull()
    expect(screen.getByText('开项核心引擎')).toBeInTheDocument()
    expect(screen.getByText('快捷规则匹配 · get_project_summary')).toBeInTheDocument()
    expect(screen.getByText('68%')).toBeInTheDocument()
  })

  test('写操作 PREVIEW_REQUIRED 渲染 ActionPreviewCard，确认/放弃接线到 Store action', () => {
    render(<AiColleagueMessageList onQuickAction={vi.fn()} />)
    setMessages([
      assistantExec('a1', {
        toolName: 'update_task_schedule',
        status: 'preview_required',
        previewToken: 'tok-1',
        diff: {
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
          warnings: ['存在节假日排期重叠'],
        },
      }),
    ])

    const card = document.querySelector('[data-card="action-preview"]')
    expect(card).not.toBeNull()
    expect(card).toHaveAttribute('data-status', 'preview')
    expect(screen.getByText('写操作待确认 · 人工审查')).toBeInTheDocument()
    expect(screen.getByText('#12 · 核心引擎重构')).toBeInTheDocument()
    expect(screen.getByText('2026-09-10')).toBeInTheDocument()
    expect(screen.getByText('2026-09-15')).toBeInTheDocument()
    expect(screen.getByText('存在节假日排期重叠')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认应用' }))
    expect(getColleagueStoreMock().hook.getState().confirmPendingAction).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '放弃取消' }))
    expect(getColleagueStoreMock().hook.getState().cancelPendingAction).toHaveBeenCalledTimes(1)
  })

  test('confirm 在途（status=executing 且持预览令牌）渲染 committing 锁定态', () => {
    render(<AiColleagueMessageList onQuickAction={vi.fn()} />)
    setMessages([
      assistantExec('a1', {
        toolName: 'update_task_schedule',
        status: 'executing',
        previewToken: 'tok-1',
        diff: { changes: [] },
      }),
    ])

    expect(document.querySelector('[data-card="action-preview"]')).toHaveAttribute(
      'data-status',
      'committing',
    )
    const confirmButton = document.querySelector('[data-preview-confirm]') as HTMLButtonElement
    const cancelButton = document.querySelector('[data-preview-cancel]') as HTMLButtonElement
    expect(confirmButton).toBeDisabled()
    expect(cancelButton).toBeDisabled()
    expect(screen.getByText('提交中…')).toBeInTheDocument()
  })

  test('409 版本冲突渲染冲突告警槽，重新演练接线到 redrillPendingAction', () => {
    render(<AiColleagueMessageList onQuickAction={vi.fn()} />)
    setMessages([
      assistantExec('a1', {
        toolName: 'update_task_schedule',
        status: 'error',
        error: {
          code: 'SCHEDULE_STALE',
          message: '排程数据已被他人并发修改或预览已过期（版本冲突 409）',
          status: 409,
        },
        diff: {
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
        },
      }),
    ])

    const card = document.querySelector('[data-card="action-preview"]')
    expect(card).toHaveAttribute('data-status', 'conflict')
    expect(
      screen.getByText('排程数据已被他人并发修改或预览已过期（版本冲突 409）'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /重新演练/ }))
    expect(getColleagueStoreMock().hook.getState().redrillPendingAction).toHaveBeenCalledTimes(1)
  })

  test('404 错误渲染中性 AiErrorCard，绝不泄露原始错误消息（RL-05）', () => {
    render(<AiColleagueMessageList onQuickAction={vi.fn()} />)
    setMessages([
      assistantExec('a1', {
        toolName: 'get_project_summary',
        status: 'error',
        error: { code: 'RESOURCE_NOT_FOUND', message: 'org-77 项目详情泄露串', status: 404 },
      }),
    ])

    const card = document.querySelector('[data-card="error"]')
    expect(card).not.toBeNull()
    expect(card).toHaveAttribute('data-error', 'not_found')
    expect(screen.getByText('未找到指定的项目资源')).toBeInTheDocument()
    expect(screen.queryByText(/org-77 项目详情泄露串/)).not.toBeInTheDocument()
  })

  test('navigate_to_space 成功自动 router.push 直达并渲染 NavigationResultCard（按消息去重）', () => {
    render(<AiColleagueMessageList onQuickAction={vi.fn()} />)
    setMessages([
      assistantExec('a1', {
        toolName: 'navigate_to_space',
        status: 'success',
        data: {
          path: '/next/projects/42?lens=gantt',
          lens: 'gantt',
          projectId: 42,
          depth: 'workbench',
          targetId: null,
        },
      }),
    ])

    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith('/next/projects/42?lens=gantt')

    const card = document.querySelector('[data-card="navigate"]')
    expect(card).not.toBeNull()
    expect(screen.getByText(/已为你导航至项目 42 的甘特图镜头/)).toBeInTheDocument()

    // 同一消息再次驱动渲染不重复跳转
    setMessages([
      assistantExec('a1', {
        toolName: 'navigate_to_space',
        status: 'success',
        data: {
          path: '/next/projects/42?lens=gantt',
          lens: 'gantt',
          projectId: 42,
          depth: 'workbench',
          targetId: null,
        },
      }),
    ])
    expect(pushMock).toHaveBeenCalledTimes(1)
  })

  test('未注册只读工具成功输出走通用兜底键值对卡片，不抛错', () => {
    render(<AiColleagueMessageList onQuickAction={vi.fn()} />)
    setMessages([
      assistantExec('a1', {
        toolName: 'some_unknown_tool',
        status: 'success',
        data: { a: 1, b: 'x' },
      }),
    ])

    expect(document.querySelector('[data-card="fallback-data"]')).not.toBeNull()
    expect(screen.getByText('结构化只读数据')).toBeInTheDocument()
    expect(screen.getByText('快捷规则匹配 · some_unknown_tool')).toBeInTheDocument()
  })

  test('确认按钮携带本卡 previewToken（修补1b：防串场身份标识）', () => {
    render(<AiColleagueMessageList onQuickAction={vi.fn()} />)
    setMessages([
      userMessage('u0', '延期任务 12 至 2026-09-15'),
      assistantExec('a1', {
        toolName: 'update_task_schedule',
        status: 'preview_required',
        previewToken: 'tok-1',
        diff: { changes: [] },
      }),
    ])

    fireEvent.click(screen.getByRole('button', { name: '确认应用' }))
    expect(getColleagueStoreMock().hook.getState().confirmPendingAction).toHaveBeenCalledWith(
      'tok-1',
    )
  })

  test('被新操作取代的旧预览卡：作废提示 + 确认入口消失（修补1d）', () => {
    render(<AiColleagueMessageList onQuickAction={vi.fn()} />)
    setMessages([
      userMessage('u0', '延期任务 12 至 2026-09-15'),
      assistantExec('a1', {
        toolName: 'update_task_schedule',
        status: 'cancelled',
        previewToken: 'tok-1',
        cancelNote: '该预览已被新操作取代，已自动作废',
        diff: { changes: [] },
      }),
      assistantExec('a2', {
        toolName: 'update_task_schedule',
        status: 'preview_required',
        previewToken: 'tok-2',
        diff: { changes: [] },
      }),
    ])

    expect(screen.getByText('该预览已被新操作取代，已自动作废')).toBeInTheDocument()
    const cards = document.querySelectorAll('[data-card="action-preview"]')
    expect(cards).toHaveLength(2)
    // 旧卡决策锁定：无确认/取消入口
    expect(cards[0]?.querySelector('[data-preview-confirm]')).toBeNull()
    expect(cards[0]?.querySelector('[data-preview-cancel]')).toBeNull()
    // 新卡保持可确认
    expect(screen.getByRole('button', { name: '确认应用' })).toBeInTheDocument()
  })

  test('任务条目点击：关闭面板并导航至任务聚焦 URL（修补3）', () => {
    render(<AiColleagueMessageList onQuickAction={vi.fn()} />)
    act(() => {
      getColleagueStoreMock().hook.setState({ isOpen: true })
    })
    setMessages([
      userMessage('u0', '任务列表'),
      assistantExec('a1', {
        toolName: 'list_project_tasks',
        status: 'success',
        parameters: { projectId: 42 },
        data: {
          items: [{ id: 7, name: '看板列校准', status: 'in_progress', priority: 'high' }],
          meta: { total: 1, page: 1, perPage: 5, totalPages: 1 },
        },
      }),
    ])

    fireEvent.click(document.querySelector('[data-task-item]') as HTMLElement)
    expect(pushMock).toHaveBeenCalledWith('/next/projects/42?focusTask=7')
    // 点击任务条目同步收起面板
    expect(getColleagueStoreMock().hook.getState().isOpen).toBe(false)
  })

  test('执行阶段超时/网络错误：AiErrorCard 重试 = 重发同一条用户消息（修补4b）', () => {
    const onQuickAction = vi.fn()
    render(<AiColleagueMessageList onQuickAction={onQuickAction} />)
    setMessages([
      userMessage('u0', '项目概况'),
      assistantExec('a1', {
        toolName: 'get_project_summary',
        status: 'error',
        error: { code: 'REQUEST_TIMEOUT', message: '请求超时，请检查网络后重试', status: 408 },
      }),
    ])

    expect(screen.getByText('网络连接超时')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新尝试' }))
    expect(onQuickAction).toHaveBeenCalledWith('项目概况')
  })

  test('确认阶段失败（持令牌）：错误卡重试 = 同令牌重试 confirm（修补4b）', () => {
    render(<AiColleagueMessageList onQuickAction={vi.fn()} />)
    setMessages([
      userMessage('u0', '延期任务 12 至 2026-09-15'),
      assistantExec('a1', {
        toolName: 'update_task_schedule',
        status: 'error',
        previewToken: 'tok-1',
        error: { code: 'NETWORK_ERROR', message: '网络连接异常，请检查网络后重试' },
      }),
    ])

    // 无 HTTP 状态 → AiErrorCard 未知类目回显原始消息（网络失败文案透传）
    expect(screen.getByText('操作未能完成')).toBeInTheDocument()
    expect(screen.getByText('网络连接异常，请检查网络后重试')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(getColleagueStoreMock().hook.getState().confirmPendingAction).toHaveBeenCalledWith(
      'tok-1',
    )
  })
})
