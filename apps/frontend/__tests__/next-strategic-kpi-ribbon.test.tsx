import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StrategicScrollHeader } from '@/components/next/role-view/StrategicScrollHeader'
import { StrategicKpiRibbon } from '@/components/next/role-view/StrategicKpiRibbon'
import type { CockpitMetric } from '@aiproj/types'

describe('StrategicScrollHeader 与 StrategicKpiRibbon（战略导言与 KPI 丝带，任务 1.3 / 1.4）', () => {
  const fetchCalls: Array<{ method: string; url: string }> = []

  beforeEach(() => {
    fetchCalls.length = 0
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      fetchCalls.push({ method, url })
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('StrategicScrollHeader 周期导言栏', () => {
    it('正确绑定周期元数据、时间戳与健康状态徽标', () => {
      render(
        <StrategicScrollHeader
          cycleTitle="2026 Q3 全局战略对齐"
          calculatedAt="2026-09-11T12:00:00.000Z"
          overallStatus="healthy"
          organizationName="开项互联集团"
        />,
      )

      expect(screen.getByText('战略执行驾驶舱')).toBeInTheDocument()
      expect(screen.getByTestId('cycle-title')).toHaveTextContent('2026 Q3 全局战略对齐')
      expect(screen.getByText(/\/ 开项互联集团/)).toBeInTheDocument()
      expect(screen.getByTestId('calculated-at')).toHaveTextContent('2026-09-11')
      expect(screen.getByTestId('overall-status-badge')).toHaveTextContent('战略健康')
    })

    it('无周期时优雅展示回退占位文案', () => {
      render(<StrategicScrollHeader cycleTitle={null} calculatedAt={null} overallStatus="empty" />)

      expect(screen.getByTestId('cycle-title')).toHaveTextContent('未选择周期')
      expect(screen.getByTestId('calculated-at')).toHaveTextContent('—')
      expect(screen.getByTestId('overall-status-badge')).toHaveTextContent('空范围')
    })

    it('点击重置筛选按钮正确触发回调', () => {
      const handleReset = vi.fn()
      render(<StrategicScrollHeader cycleTitle="2026 战略" onResetFilters={handleReset} />)

      const resetBtn = screen.getByTestId('reset-filters-btn')
      expect(resetBtn).toBeInTheDocument()
      fireEvent.click(resetBtn)
      expect(handleReset).toHaveBeenCalledTimes(1)
    })
  })

  describe('StrategicKpiRibbon 战略核心 KPI 丝带', () => {
    it('正确格式化显式传入的 5 大核心战略量度（百分比与数值）', () => {
      render(
        <StrategicKpiRibbon
          totalObjectives={18}
          completionRate={65}
          averageProgress={72}
          highRiskCount={3}
          mappingCoverageRate={89}
        />,
      )

      // 目标总数
      expect(screen.getByTestId('kpi-total-objectives')).toHaveTextContent('18')
      expect(screen.getByTestId('kpi-total-objectives')).toHaveTextContent('项')

      // 完成率
      expect(screen.getByTestId('kpi-completion-rate')).toHaveTextContent('65%')

      // 平均进度与进度条
      expect(screen.getByTestId('kpi-average-progress')).toHaveTextContent('72%')
      const progressFill = screen.getByTestId('progress-bar-fill')
      expect(progressFill).toHaveStyle({ width: '72%' })

      // 高风险目标
      expect(screen.getByTestId('kpi-high-risk')).toHaveTextContent('3')
      expect(screen.getByTestId('kpi-high-risk')).toHaveTextContent('项')

      // 映射覆盖率
      expect(screen.getByTestId('kpi-mapping-coverage')).toHaveTextContent('89%')
    })

    it('支持从原始 CockpitMetric 数组中智能萃取指标', () => {
      const rawKpis: CockpitMetric[] = [
        {
          key: 'cockpit_total_objectives',
          value: 12,
          unit: 'count',
          source: 'okr_objective',
          status: 'available',
        },
        {
          key: 'cockpit_completed_objectives',
          value: 6,
          unit: 'count',
          source: 'computed',
          status: 'available',
        },
        {
          key: 'cockpit_strategy_progress_avg',
          value: 58,
          unit: 'avg',
          source: 'computed',
          status: 'available',
        },
        {
          key: 'cockpit_at_risk_objectives',
          value: 2,
          unit: 'count',
          source: 'okr_objective',
          status: 'available',
        },
        {
          key: 'cockpit_mapping_coverage_percent',
          value: 80,
          unit: 'percent',
          source: 'okr_mapping',
          status: 'available',
        },
      ]

      render(<StrategicKpiRibbon kpis={rawKpis} />)

      expect(screen.getByTestId('kpi-total-objectives')).toHaveTextContent('12')
      expect(screen.getByTestId('kpi-completion-rate')).toHaveTextContent('50%')
      expect(screen.getByTestId('kpi-average-progress')).toHaveTextContent('58%')
      expect(screen.getByTestId('kpi-high-risk')).toHaveTextContent('2')
      expect(screen.getByTestId('kpi-mapping-coverage')).toHaveTextContent('80%')
    })

    it('恪守 RL-01：组件装配与渲染期间严格为零网络写操作', () => {
      render(
        <div>
          <StrategicScrollHeader cycleTitle="2026 Q3" onResetFilters={() => {}} />
          <StrategicKpiRibbon totalObjectives={10} averageProgress={40} />
        </div>,
      )

      // 断言零写操作
      const writeRequests = fetchCalls.filter((c) =>
        ['POST', 'PATCH', 'PUT', 'DELETE'].includes(c.method),
      )
      expect(writeRequests).toHaveLength(0)
    })
  })
})
