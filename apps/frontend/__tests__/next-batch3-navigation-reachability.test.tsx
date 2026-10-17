import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { filterSpaceCoordinates } from '@/lib/next/space-coordinates'
import { parseColleagueIntent, type ColleagueContext } from '@/lib/next/ai-colleague-intent'
import { SpaceMapOverlay } from '@/components/next/navigation/SpaceMapOverlay'
import { NextTopbarNotificationTrigger } from '@/components/next/layout/NextTopbarNotificationTrigger'
import { RolePersonalWorkBucket } from '@/components/next/home/RolePersonalWorkBucket'
import { useAuthStore } from '@/stores/auth-store'
import type { Task } from '@/lib/api/tasks'

const mocks = vi.hoisted(() => ({
  routerPush: vi.fn(),
  routerReplace: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mocks.routerPush,
    replace: mocks.routerReplace,
    back: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
})

function renderWithQuery(ui: React.ReactElement) {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('全域汇聚三通道可达集成测试 (v3-ui-next-batch3-global-convergence tasks 5.3 / 5.4)', () => {
  const dummyContext: ColleagueContext = {
    contextType: 'role_home',
    currentProjectId: null,
    pathname: '/next',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ hasHydrated: true })
  })

  describe('通道一：空间地图（Ctrl+M / 坐标检索 / 镜头切换）', () => {
    it('白名单点亮 4 项全域汇聚坐标且均可通过 filterSpaceCoordinates 检索', () => {
      const searchCoords = filterSpaceCoordinates('全域搜索')
      expect(searchCoords.some((c) => c.id === 'global-search')).toBe(true)

      const notifCoords = filterSpaceCoordinates('通知中心')
      expect(notifCoords.some((c) => c.id === 'notifications')).toBe(true)

      const timelineCoords = filterSpaceCoordinates('全域时间主轴')
      expect(timelineCoords.some((c) => c.id === 'global-timeline')).toBe(true)

      const tasksCoords = filterSpaceCoordinates('全域任务')
      expect(tasksCoords.some((c) => c.id === 'cross-project-tasks')).toBe(true)
    })

    it('空间地图 Tab 栏集成「全域任务」镜头切换，支持点击与 Ctrl+L 循环切入', () => {
      renderWithQuery(
        <SpaceMapOverlay open={true} onClose={vi.fn()} onSelectCoordinate={vi.fn()} />,
      )

      const tasksTab = screen.getByRole('tab', { name: '全域任务' })
      expect(tasksTab).toBeInTheDocument()
      expect(tasksTab).toHaveTextContent('全域任务')

      // 点击 Tab 切换镜头
      fireEvent.click(tasksTab)
      expect(screen.getByTestId('cross-project-tasks-hud')).toBeInTheDocument()

      // 按 Ctrl+L 循环切换镜头回到 spaces
      fireEvent.keyDown(window, { key: 'l', ctrlKey: true })
      expect(screen.queryByTestId('cross-project-tasks-hud')).not.toBeInTheDocument()
    })
  })

  describe('通道二：AI 同事指令直达 (Natural Language Rules)', () => {
    it('输入「去全域任务」命中 rule_nav_cross_project_tasks 导航至 tasks 镜头', () => {
      const result = parseColleagueIntent('去全域任务', dummyContext)
      expect(result.toolName).toBe('navigate_to_space')
      expect(result.matchedRuleId).toBe('rule_nav_cross_project_tasks')
      expect(result.parameters).toEqual(
        expect.objectContaining({
          lens: 'tasks',
        }),
      )
    })

    it('输入「打开全域时间主轴」命中 rule_nav_global_timeline 导航至 calendar 主轴', () => {
      const result = parseColleagueIntent('打开全域时间主轴', dummyContext)
      expect(result.toolName).toBe('navigate_to_space')
      expect(result.matchedRuleId).toBe('rule_nav_global_timeline')
      expect(result.parameters).toEqual(
        expect.objectContaining({
          lens: 'calendar',
        }),
      )
    })

    it('输入「查看通知中心」命中 rule_nav_notifications 导航至通知', () => {
      const result = parseColleagueIntent('查看通知中心', dummyContext)
      expect(result.toolName).toBe('navigate_to_space')
      expect(result.matchedRuleId).toBe('rule_nav_notifications')
      expect(result.parameters).toEqual(
        expect.objectContaining({
          lens: 'notifications',
        }),
      )
    })

    it('输入「找一下关于登录的设计文档」命中 rule_global_search_entities 跨实体检索', () => {
      const result = parseColleagueIntent('找一下关于登录的设计文档', dummyContext)
      expect(result.toolName).toBe('search_global_entities')
      expect(result.matchedRuleId).toBe('rule_global_search_entities')
      expect(result.parameters).toEqual(
        expect.objectContaining({
          keyword: '登录',
          entityTypes: ['file'],
        }),
      )
    })

    it('输入「今日简报」命中晨报式主动简报规则', () => {
      const result = parseColleagueIntent('今日简报', dummyContext)
      expect(result.toolName).toBe('get_morning_briefing')
      expect(result.matchedRuleId).toBe('rule_morning_briefing')
    })
  })

  describe('通道三：顶栏常驻操作点与首页工作桶快捷入口', () => {
    it('顶栏通知触发器组件正常呈现并响应点击', () => {
      const onOpen = vi.fn()
      renderWithQuery(<NextTopbarNotificationTrigger onClick={onOpen} />)

      const trigger = screen.getByRole('button', { name: /通知/i })
      expect(trigger).toBeInTheDocument()
      fireEvent.click(trigger)
      expect(onOpen).toHaveBeenCalledTimes(1)
    })

    it('角色首页工作桶微件提供「打开 HUD」快捷通道', () => {
      const onOpenHud = vi.fn()
      const mockTask: Task = {
        id: 1,
        projectId: 1,
        name: '测试任务',
        description: null,
        status: 'in_progress',
        priority: 'high',
        taskType: 'task',
        startDate: null,
        endDate: new Date().toISOString(),
        actualStartDate: null,
        actualEndDate: null,
        durationDays: 1,
        estimatedHours: 4,
        actualHours: null,
        progressPercent: 50,
        assigneeId: 1,
        reviewerId: null,
        parentTaskId: null,
        wbsNodeId: null,
        milestoneId: null,
        costEstimateCents: null,
        costActualCents: null,
        customFields: null,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      }

      renderWithQuery(
        <RolePersonalWorkBucket
          bucket="member"
          currentUserId={1}
          tasks={[mockTask]}
          onOpenHud={onOpenHud}
        />,
      )

      const hudBtn = screen.getByRole('button', { name: /HUD/i })
      expect(hudBtn).toBeInTheDocument()
      fireEvent.click(hudBtn)
      expect(onOpenHud).toHaveBeenCalledTimes(1)
    })
  })
})
