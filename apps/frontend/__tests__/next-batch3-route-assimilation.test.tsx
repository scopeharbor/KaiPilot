import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import SearchAssimilationPage from '@/app/(next)/next/search/page'
import NotificationsAssimilationPage from '@/app/(next)/next/notifications/page'
import CalendarAssimilationPage from '@/app/(next)/next/calendar/page'
import TasksAssimilationPage from '@/app/(next)/next/tasks/page'
import RecommendationsAssimilationPage from '@/app/(next)/next/recommendations/page'
import OkrAlignmentAssimilationPage from '@/app/(next)/next/okr-alignment/page'
import { useNotificationDrawerStore } from '@/components/next/notifications/use-notification-drawer'

const mocks = vi.hoisted(() => ({
  routerReplace: vi.fn(),
  routerPush: vi.fn(),
  searchParams: new URLSearchParams(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mocks.routerReplace,
    push: mocks.routerPush,
  }),
  useSearchParams: () => mocks.searchParams,
}))

describe('批 3 全量 6 页路由同化集成测试 (v3-ui-next-batch3-global-convergence tasks 5.1 / 5.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.searchParams = new URLSearchParams()
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.clear()
    }
  })

  describe('1. /next/search 全域搜索同化', () => {
    it('接收搜索关键词 ?q= 并平滑重定向至 /next，保存预填关键词至 sessionStorage', () => {
      mocks.searchParams = new URLSearchParams('q=性能优化')
      render(<SearchAssimilationPage />)

      expect(mocks.routerReplace).toHaveBeenCalledWith('/next')
      expect(window.sessionStorage.getItem('space-map-prefill')).toBe('性能优化')
      expect(screen.getByTestId('search-assimilation-page')).toBeInTheDocument()
    })

    it('无关键词访问时零报错平滑重定向至 /next', () => {
      mocks.searchParams = new URLSearchParams()
      render(<SearchAssimilationPage />)

      expect(mocks.routerReplace).toHaveBeenCalledWith('/next')
      expect(screen.getByRole('status')).toBeInTheDocument()
    })
  })

  describe('2. /next/notifications 通知中心同化', () => {
    it('接收分类参数 ?tab=mentions 唤起通知抽屉并重定向至 /next', () => {
      mocks.searchParams = new URLSearchParams('tab=mentions')
      render(<NotificationsAssimilationPage />)

      expect(mocks.routerReplace).toHaveBeenCalledWith('/next')
      const drawerState = useNotificationDrawerStore.getState()
      expect(drawerState.isOpen).toBe(true)
      expect(drawerState.activeTab).toBe('mentions')
    })

    it('默认参数访问时唤起全部通知抽屉并重定向至 /next', () => {
      mocks.searchParams = new URLSearchParams()
      render(<NotificationsAssimilationPage />)

      expect(mocks.routerReplace).toHaveBeenCalledWith('/next')
      const drawerState = useNotificationDrawerStore.getState()
      expect(drawerState.isOpen).toBe(true)
      expect(drawerState.activeTab).toBe('all')
    })
  })

  describe('3. /next/calendar 全域时间主轴同化', () => {
    it('平滑导流至全域时间主轴 /next?tier=global-timeline', () => {
      mocks.searchParams = new URLSearchParams()
      render(<CalendarAssimilationPage />)

      expect(mocks.routerReplace).toHaveBeenCalledWith('/next?tier=global-timeline')
      expect(screen.getByText(/日历视图已升级为「全域时间主轴」/)).toBeInTheDocument()
    })

    it('保留透传深链查询参数（如 project 过滤）并附加 tier=global-timeline', () => {
      mocks.searchParams = new URLSearchParams('projectId=101&view=month')
      render(<CalendarAssimilationPage />)

      expect(mocks.routerReplace).toHaveBeenCalledWith(
        expect.stringContaining('tier=global-timeline'),
      )
      expect(mocks.routerReplace).toHaveBeenCalledWith(expect.stringContaining('projectId=101'))
    })
  })

  describe('4. /next/tasks 全域任务 HUD 同化', () => {
    it('自动重定向至角色首页并激活跨项目任务 HUD 镜头 (?focus=tasks-hud)', () => {
      render(<TasksAssimilationPage />)

      expect(mocks.routerReplace).toHaveBeenCalledWith('/next?focus=tasks-hud')
      expect(screen.getByText(/正在唤起跨项目任务 HUD 镜头/)).toBeInTheDocument()
    })
  })

  describe('5. /next/recommendations 建议卡槽同化', () => {
    it('平滑重定向至角色首页建议卡槽 (/next)', () => {
      render(<RecommendationsAssimilationPage />)

      expect(mocks.routerReplace).toHaveBeenCalledWith('/next')
      expect(screen.getByText(/正在导航至建议卡槽/)).toBeInTheDocument()
    })
  })

  describe('6. /next/okr-alignment OKR 对齐页废退同化', () => {
    it('永久重定向至新轨组织级 OKR 工作台 (/next/organization/okrs)', () => {
      render(<OkrAlignmentAssimilationPage />)

      expect(mocks.routerReplace).toHaveBeenCalledWith('/next/organization/okrs')
      expect(screen.getByText(/正在重定向至组织级 OKR 工作台/)).toBeInTheDocument()
    })
  })

  describe('7. 零死链与零 404 兜底验证', () => {
    it('所有 6 个同化页面均正常挂载，呈现仪器感导流骨架，无崩溃无白屏', () => {
      const pages = [
        <SearchAssimilationPage key="search" />,
        <NotificationsAssimilationPage key="notifications" />,
        <CalendarAssimilationPage key="calendar" />,
        <TasksAssimilationPage key="tasks" />,
        <RecommendationsAssimilationPage key="rec" />,
        <OkrAlignmentAssimilationPage key="okr" />,
      ]

      for (const page of pages) {
        const { unmount } = render(page)
        unmount()
      }
    })
  })
})
