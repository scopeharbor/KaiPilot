/**
 * RTM 需求追踪矩阵镜头定向测试（v3-chart-gallery-tier2-governance-matrices W2 · task 2.4）。
 *
 * 覆盖：
 * 1. Adapter 纯函数：需求到任务与验收准则平铺展开、覆盖率计算、断链中性判定；
 * 2. 镜头组件渲染：三段链路表格平铺、承接任务卡片与验收通过率；
 * 3. 断链需求高亮「待关联任务」中性提示（零惊恐感性词汇）；
 * 4. 空需求项目安全渲染标准空态（ChartLensEmptyState）；
 * 5. RL-01 零写网络断言：全程零写请求（POST/PATCH/PUT/DELETE 恒为 0）；
 * 6. DOM 中性措辞断言：正则全局扫描零「告警/预警/危险」词汇。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { RtmMatrixResult } from '@/lib/api/requirements'
import { buildRtmViewModel } from '@/lib/next/charts/rtm-adapter'
import { RtmMatrixChartLens } from '@/components/next/charts/lenses/RtmMatrixChartLens'
import {
  installFetchRouter,
  jsonResponse,
  resetFetchRouter,
  writeMethods,
} from './helpers/chart-gallery-network'

if (typeof window.PointerEvent === 'undefined') {
  class PointerEventMock extends MouseEvent {}
  window.PointerEvent = PointerEventMock as unknown as typeof PointerEvent
}

if (typeof window.matchMedia === 'undefined') {
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

function makeSampleRtmData(): RtmMatrixResult {
  return {
    projectId: 42,
    totalRequirements: 2,
    coveragePercent: 50,
    matrix: [
      {
        requirementId: 1,
        code: 'REQ-001',
        title: '多租户组织数据隔离',
        category: '安全核心',
        priority: 'urgent',
        status: 'approved',
        criteriaPassRate: 100,
        acceptanceCriteria: [
          { id: 'crit-1', description: '跨组织访问返回 404', status: 'passed' },
          { id: 'crit-2', description: 'SQL 全表扫描阻断', status: 'passed' },
        ],
        linkedTasks: [
          {
            id: 10,
            name: 'RL-05 租户中间件接入',
            status: 'completed',
            assigneeName: '王工',
            progressPercent: 100,
          },
        ],
      },
      {
        requirementId: 2,
        code: 'REQ-002',
        title: '暗色控制台图表换肤',
        category: 'UI 表现层',
        priority: 'medium',
        status: 'in_progress',
        criteriaPassRate: 50,
        acceptanceCriteria: [
          { id: 'crit-3', description: '消费 --nx-* 语义令牌', status: 'passed' },
          { id: 'crit-4', description: '高对比度模式无裁切', status: 'pending' },
        ],
        // 断链需求：无承接任务
        linkedTasks: [],
      },
    ],
  }
}

describe('RTM 适配器纯函数测试 (rtm-adapter.ts)', () => {
  test('三段链路展开与指标聚合计算', () => {
    const data = makeSampleRtmData()
    const model = buildRtmViewModel(data)

    expect(model.isEmpty).toBe(false)
    expect(model.metrics.totalRequirements).toBe(2)
    expect(model.metrics.coveredRequirements).toBe(1)
    expect(model.metrics.brokenRequirements).toBe(1)
    expect(model.metrics.coveragePercent).toBe(50)
    expect(model.metrics.avgCriteriaPassRate).toBe(75) // (100 + 50) / 2

    // 检查行 1（已关联任务）
    expect(model.rows[0]!.code).toBe('REQ-001')
    expect(model.rows[0]!.isBrokenLink).toBe(false)
    expect(model.rows[0]!.linkedTasks).toHaveLength(1)
    expect(model.rows[0]!.linkedTasks[0]!.assigneeName).toBe('王工')

    // 检查行 2（断链需求）
    expect(model.rows[1]!.code).toBe('REQ-002')
    expect(model.rows[1]!.isBrokenLink).toBe(true)
    expect(model.rows[1]!.brokenLinkHint).toBe('待关联任务')
    expect(model.rows[1]!.brokenLinkHint).not.toMatch(/告警|预警|危险/)
  })

  test('空数据信封降级', () => {
    const emptyModel = buildRtmViewModel(null)
    expect(emptyModel.isEmpty).toBe(true)
    expect(emptyModel.metrics.totalRequirements).toBe(0)
    expect(emptyModel.rows).toHaveLength(0)
  })
})

describe('RtmMatrixChartLens 镜头组件渲染与门禁测试', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
  })

  afterEach(() => {
    resetFetchRouter()
    queryClient.clear()
  })

  test('完整数据流：渲染指标卡、三段平铺链路、待关联任务胶囊与验收准则', async () => {
    const sample = makeSampleRtmData()
    const { records } = installFetchRouter((path, method) => {
      if (path === '/projects/42/requirements/rtm-matrix' && method === 'GET') {
        return jsonResponse(200, { data: sample })
      }
      return null
    })

    render(
      <QueryClientProvider client={queryClient}>
        <RtmMatrixChartLens projectId={42} />
      </QueryClientProvider>,
    )

    // 等待视口加载
    await waitFor(() => {
      expect(document.querySelector('[data-chart-viewport-slot]')).not.toBeNull()
    })
    expect(document.querySelector('[data-chart-lens-root="rtm"]')).not.toBeNull()

    // 顶部指标卡
    expect(screen.getByText('需求总数')).toBeInTheDocument()
    expect(screen.getByText('任务承接覆盖率')).toBeInTheDocument()
    expect(screen.getAllByText('待关联任务')).toHaveLength(2) // 顶部指标项与表格断链行各一处
    expect(screen.getByText('平均验收通过率')).toBeInTheDocument()

    // 需求平铺
    await screen.findByText('REQ-001')
    expect(screen.getByText('多租户组织数据隔离')).toBeInTheDocument()
    expect(screen.getByText('REQ-002')).toBeInTheDocument()
    expect(screen.getByText('暗色控制台图表换肤')).toBeInTheDocument()

    // 任务
    expect(screen.getByText('RL-05 租户中间件接入')).toBeInTheDocument()

    // 验收准则
    expect(screen.getByText('跨组织访问返回 404')).toBeInTheDocument()
    expect(screen.getByText('消费 --nx-* 语义令牌')).toBeInTheDocument()

    // RL-01 零写断言
    expect(writeMethods(records)).toHaveLength(0)

    // DOM 中性措辞断言
    expect(screen.queryByText(/告警|预警|危险/)).toBeNull()
  })

  test('空需求项目安全渲染标准空态', async () => {
    installFetchRouter((path, method) => {
      if (path === '/projects/99/requirements/rtm-matrix' && method === 'GET') {
        return jsonResponse(200, {
          data: { projectId: 99, totalRequirements: 0, coveragePercent: 0, matrix: [] },
        })
      }
      return null
    })

    render(
      <QueryClientProvider client={queryClient}>
        <RtmMatrixChartLens projectId={99} />
      </QueryClientProvider>,
    )

    await screen.findByRole('status', { name: 'RTM 需求追踪矩阵为空' })
    expect(screen.getByText('暂无需求追踪数据')).toBeInTheDocument()
    expect(screen.getByText('当前项目尚未录入需求条目，需求追踪矩阵暂无数据。')).toBeInTheDocument()

    // DOM 中性措辞
    expect(screen.queryByText(/告警|预警|危险/)).toBeNull()
  })
})
