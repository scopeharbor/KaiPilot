/**
 * v3-ui-next-batch4-reports-change-queue W5 · tasks 5.1 / 5.2
 * 旧路由同化重定向与参数透传测试（next-batch4-route-assimilation.test.tsx）
 *
 * 覆盖：
 * 1. 访问 /next/reports 默认平滑重定向至图表馆组织报表分馆 (/next/charts?tab=reports-wing)；
 * 2. 访问 /next/reports?view=pmo 重定向至 PMO 组合报表镜头 (/next/pmo/reports)；
 * 3. 访问 /next/reports?projectId=42 智能定向至单项目空间 (/next/projects/42/reports)；
 * 4. 访问 /next/change-requests 默认平滑重定向至 PMO 变更审批队列 (/next/pmo/change-queue)；
 * 5. 访问 /next/change-requests?projectId=42 智能定向至单项目变更空间 (/next/projects/42/change-requests)；
 * 6. 兜底链接与暗黑仪器感导流提示渲染。
 */

import * as React from 'react'
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import ReportsPage from '@/app/(next)/next/reports/page'
import ChangeRequestsPage from '@/app/(next)/next/change-requests/page'

const replaceMock = vi.fn()
const pushMock = vi.fn()
let currentSearchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
    back: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => currentSearchParams,
  usePathname: () => '/next/reports',
}))

describe('批 4 旧路由同化重定向与参数透传测试 (W5 · tasks 5.1/5.2)', () => {
  beforeEach(() => {
    replaceMock.mockReset()
    pushMock.mockReset()
    currentSearchParams = new URLSearchParams()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // 1. 全局报表路由同化 (/next/reports)
  // -------------------------------------------------------------------------
  describe('/next/reports 路由同化', () => {
    test('默认访问：自动重定向至图表馆组织报表分馆 /next/charts?tab=reports-wing', () => {
      render(<ReportsPage />)

      expect(replaceMock).toHaveBeenCalledWith('/next/charts?tab=reports-wing')
      const domNode = document.querySelector('[data-reports-assimilation-page]')
      expect(domNode).not.toBeNull()
      expect(domNode?.getAttribute('data-target-url')).toBe('/next/charts?tab=reports-wing')

      const link = document.querySelector('[data-assimilation-fallback-link]')
      expect(link).not.toBeNull()
      expect(link?.getAttribute('href')).toBe('/next/charts?tab=reports-wing')
    })

    test('携带 ?view=pmo 参数：平滑重定向至 PMO 组合报表镜头 /next/pmo/reports', () => {
      currentSearchParams = new URLSearchParams('view=pmo')
      render(<ReportsPage />)

      expect(replaceMock).toHaveBeenCalledWith('/next/pmo/reports')
      const domNode = document.querySelector('[data-reports-assimilation-page]')
      expect(domNode?.getAttribute('data-target-url')).toBe('/next/pmo/reports')

      const link = document.querySelector('[data-assimilation-fallback-link]')
      expect(link?.getAttribute('href')).toBe('/next/pmo/reports')
    })

    test('携带 ?projectId=42 参数：智能定向至单项目空间 /next/projects/42/reports', () => {
      currentSearchParams = new URLSearchParams('projectId=42')
      render(<ReportsPage />)

      expect(replaceMock).toHaveBeenCalledWith('/next/projects/42/reports')
      const domNode = document.querySelector('[data-reports-assimilation-page]')
      expect(domNode?.getAttribute('data-target-url')).toBe('/next/projects/42/reports')

      const link = document.querySelector('[data-assimilation-fallback-link]')
      expect(link?.getAttribute('href')).toBe('/next/projects/42/reports')
    })

    test('携带 ?projectId=42&view=periodic 参数：保留其余深链查询参数', () => {
      currentSearchParams = new URLSearchParams(
        'projectId=42&tab=periodic&template=weekly-ai-summary',
      )
      render(<ReportsPage />)

      expect(replaceMock).toHaveBeenCalledWith(
        '/next/projects/42/reports?tab=periodic&template=weekly-ai-summary',
      )
    })
  })

  // -------------------------------------------------------------------------
  // 2. 全局变更路由同化 (/next/change-requests)
  // -------------------------------------------------------------------------
  describe('/next/change-requests 路由同化', () => {
    test('默认访问：自动重定向至 PMO 全局变更审批队列 /next/pmo/change-queue', () => {
      render(<ChangeRequestsPage />)

      expect(replaceMock).toHaveBeenCalledWith('/next/pmo/change-queue')
      const domNode = document.querySelector('[data-change-requests-assimilation-page]')
      expect(domNode).not.toBeNull()
      expect(domNode?.getAttribute('data-target-url')).toBe('/next/pmo/change-queue')

      const link = document.querySelector('[data-assimilation-fallback-link]')
      expect(link).not.toBeNull()
      expect(link?.getAttribute('href')).toBe('/next/pmo/change-queue')
    })

    test('携带 ?projectId=99 参数：智能定向至单项目空间 /next/projects/99/change-requests', () => {
      currentSearchParams = new URLSearchParams('projectId=99')
      render(<ChangeRequestsPage />)

      expect(replaceMock).toHaveBeenCalledWith('/next/projects/99/change-requests')
      const domNode = document.querySelector('[data-change-requests-assimilation-page]')
      expect(domNode?.getAttribute('data-target-url')).toBe('/next/projects/99/change-requests')

      const link = document.querySelector('[data-assimilation-fallback-link]')
      expect(link?.getAttribute('href')).toBe('/next/projects/99/change-requests')
    })

    test('携带其余过滤参数透传至 PMO 变更队列', () => {
      currentSearchParams = new URLSearchParams('status=pending&priority=high')
      render(<ChangeRequestsPage />)

      expect(replaceMock).toHaveBeenCalledWith(
        '/next/pmo/change-queue?status=pending&priority=high',
      )
    })
  })
})
