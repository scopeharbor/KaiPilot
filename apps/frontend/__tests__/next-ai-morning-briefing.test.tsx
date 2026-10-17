import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  matchMorningBriefingIntent,
  resolveMorningBriefingIntent,
  generateMorningBriefing,
  MORNING_BRIEFING_RULE_ID,
  MORNING_BRIEFING_TOOL_NAME,
} from '@/lib/next/ai-morning-briefing'
import { AiMorningBriefingCard } from '@/components/next/ai/cards/AiMorningBriefingCard'
import { useNotificationDrawerStore } from '@/components/next/notifications/use-notification-drawer'
import type { Notification } from '@/lib/api/notifications'

const { routerPush } = vi.hoisted(() => ({
  routerPush: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 1,
    organizationId: 1,
    recipientId: 1,
    type: 'task_assigned',
    title: '重要告警任务',
    body: '请紧急排查构建机资源短缺',
    severity: 'critical',
    projectId: 10,
    target: { type: 'task', id: 99 },
    actionUrl: null,
    readAt: null,
    hiddenAt: null,
    metadata: null,
    createdAt: '2026-09-12T08:30:00.000Z',
    ...overrides,
  }
}

describe('AiMorningBriefing (W2 · tasks 2.7/2.8)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.restoreAllMocks()
    routerPush.mockClear()
    useNotificationDrawerStore.setState({ isOpen: false, activeTab: 'all' })

    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('测试自然语言输入命中晨报意图 rule_morning_briefing', () => {
    const inputs = [
      '今日简报',
      '今日晨报',
      '看一下晨报',
      '有什么新通知',
      '今日态势',
      '态势简报',
      '每日简报',
    ]

    for (const text of inputs) {
      expect(matchMorningBriefingIntent(text)).toBe(true)
      const resolved = resolveMorningBriefingIntent(text)
      expect(resolved).not.toBeNull()
      expect(resolved?.toolName).toBe(MORNING_BRIEFING_TOOL_NAME)
      expect(resolved?.matchedRuleId).toBe(MORNING_BRIEFING_RULE_ID)
      expect(resolved?.confidence).toBe(1)
    }

    // 负向样本
    expect(matchMorningBriefingIntent('查看项目甘特图')).toBe(false)
    expect(matchMorningBriefingIntent('延期任务 12 至 2026-09-15')).toBe(false)
    expect(resolveMorningBriefingIntent('无关问题')).toBeNull()
  })

  test('测试客户端规则聚合高优通知与今日待办', () => {
    const now = new Date('2026-09-12T09:00:00.000Z')

    const mockNotifications: Notification[] = [
      makeNotification({ id: 1, severity: 'critical', title: '致命服务告警', readAt: null }),
      makeNotification({ id: 2, severity: 'warning', title: '存储空间预警', readAt: null }),
      makeNotification({
        id: 3,
        severity: 'info',
        title: '日常通知已读',
        readAt: '2026-09-12T08:00:00Z',
      }),
      makeNotification({
        id: 4,
        severity: 'warning',
        title: '已读预警通知',
        readAt: '2026-09-12T08:10:00Z',
      }),
    ]

    const mockTasks = [
      {
        id: 101,
        title: '今日截止任务 A',
        dueDate: '2026-09-12T18:00:00.000Z',
        status: 'in_progress',
      },
      {
        id: 102,
        title: '已逾期任务 B',
        dueDate: '2026-09-10T18:00:00.000Z',
        status: 'in_progress',
      },
      { id: 103, title: '未来任务 C', dueDate: '2026-09-20T18:00:00.000Z', status: 'not_started' },
      {
        id: 104,
        title: '已完成今日任务',
        dueDate: '2026-09-12T12:00:00.000Z',
        status: 'completed',
      },
    ]

    const briefing = generateMorningBriefing(mockNotifications, mockTasks, now)

    expect(briefing.urgentNotifications).toHaveLength(2)
    expect(briefing.urgentNotifications[0]?.title).toBe('致命服务告警')
    expect(briefing.urgentNotifications[1]?.title).toBe('存储空间预警')

    expect(briefing.todayTasksSummary.dueTodayCount).toBe(1)
    expect(briefing.todayTasksSummary.overdueCount).toBe(1)
    expect(briefing.todayTasksSummary.totalFocusCount).toBe(2)
  })

  test('测试卡片渲染高优通知聚合与排程展示', () => {
    const notifications = [
      makeNotification({ id: 1, severity: 'critical', title: '生产发布受阻', readAt: null }),
    ]
    const tasks = [
      { id: 10, title: '核心交付物走查', dueDate: new Date().toISOString(), status: 'in_progress' },
    ]

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <AiMorningBriefingCard notifications={notifications} tasks={tasks} />
      </QueryClientProvider>,
    )

    // 验证发丝微标
    expect(screen.getByText('态势简报 · Morning Briefing')).toBeInTheDocument()

    // 验证高优通知
    expect(screen.getByText('紧急通知关注')).toBeInTheDocument()
    expect(screen.getByText('生产发布受阻')).toBeInTheDocument()

    // 验证排程指标
    expect(screen.getByText('今日排程焦点')).toBeInTheDocument()
    const dueTodayEl = document.querySelector('[data-metric-due-today]')
    expect(dueTodayEl?.textContent).toBe('1')
  })

  test('测试只读直达链接交互与写操作严格为 0（RL-01）', () => {
    const onOpenDrawerMock = vi.fn()
    const onNavigateTasksMock = vi.fn()

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <AiMorningBriefingCard
          onOpenNotificationDrawer={onOpenDrawerMock}
          onNavigateTodayTasks={onNavigateTasksMock}
        />
      </QueryClientProvider>,
    )

    const openDrawerBtn = screen.getByRole('button', { name: /查看通知抽屉/ })
    const viewTasksBtn = screen.getByRole('button', { name: /处理今日任务/ })

    fireEvent.click(openDrawerBtn)
    expect(onOpenDrawerMock).toHaveBeenCalledTimes(1)

    fireEvent.click(viewTasksBtn)
    expect(onNavigateTasksMock).toHaveBeenCalledTimes(1)

    // RL-01 严苛断言：写操作 HTTP 请求（POST / PATCH / PUT / DELETE）次数严格为 0
    const writeCalls = fetchMock.mock.calls.filter((call) => {
      const init = call[1] as RequestInit | undefined
      const method = (init?.method ?? 'GET').toUpperCase()
      return ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)
    })
    expect(writeCalls).toHaveLength(0)
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })
})
