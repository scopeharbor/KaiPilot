/**
 * v3-ui-next-batch4-reports-change-queue W2 · tasks 2.4
 * PMO 组合报表四大核心态势面板渲染与交互测试。
 *
 * 验证：
 * - 四大面板数据绑定与红绿黄灰四色状态指示灯；
 * - 图表 Tooltip 暗黑悬浮提示（role="tooltip"）；
 * - 精确档（precise）纯平降级（RL-15：零 3D/Canvas，发丝线与纯色背景）；
 * - 点击下钻跳转触发。
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { PmoReportsHealthSection } from '@/components/next/pmo/reports/PmoReportsHealthSection'
import { PmoReportsVarianceSection } from '@/components/next/pmo/reports/PmoReportsVarianceSection'
import { PmoReportsWorkloadSection } from '@/components/next/pmo/reports/PmoReportsWorkloadSection'
import { PmoReportsChangeImpactSection } from '@/components/next/pmo/reports/PmoReportsChangeImpactSection'
import type { PortfolioProjectItem, PortfolioDashboardSummary } from '@aiproj/types'

const MOCK_PROJECTS: PortfolioProjectItem[] = [
  {
    projectId: 101,
    projectName: '天权全域监控系统',
    projectStatus: 'in_progress',
    healthStatus: 'healthy',
    progressPercent: 88,
    overdueTaskCount: 0,
    soonDueTaskCount: 2,
    memberCount: 8,
    trafficLightColor: 'green',
    warnings: [],
  },
  {
    projectId: 102,
    projectName: '仓储物流调度中台',
    projectStatus: 'in_progress',
    healthStatus: 'at_risk',
    progressPercent: 54,
    overdueTaskCount: 2,
    soonDueTaskCount: 5,
    memberCount: 12,
    trafficLightColor: 'yellow',
    warnings: [{ code: 'METRIC_STALE', message: '部分任务进度延后' }],
  },
  {
    projectId: 103,
    projectName: '供应链风控决策引擎',
    projectStatus: 'in_progress',
    healthStatus: 'critical',
    progressPercent: 30,
    overdueTaskCount: 6,
    soonDueTaskCount: 4,
    memberCount: 6,
    trafficLightColor: 'red',
    warnings: [
      { code: 'SOURCE_STALE', message: '严重逾期任务激增' },
      { code: 'CACHE_DEGRADED', message: '范围频繁变更' },
    ],
  },
  {
    projectId: 104,
    projectName: '边缘计算物联底座',
    projectStatus: 'suspended',
    healthStatus: 'unknown',
    progressPercent: 15,
    overdueTaskCount: 0,
    soonDueTaskCount: 0,
    memberCount: 3,
    trafficLightColor: 'gray',
    warnings: [],
  },
]

const MOCK_SUMMARY: PortfolioDashboardSummary = {
  meta: {
    calculatedAt: '2026-09-12T10:00:00Z',
    metricVersion: '1.0',
    organizationId: 1,
    actorId: 1,
    visibleProjectCount: 4,
    totalProjectCount: 4,
  },
  kpis: [],
  trafficLight: {
    available: true,
    forbidden: false,
    greenCount: 1,
    yellowCount: 1,
    redCount: 1,
    grayCount: 1,
    warnings: [],
  },
  freshness: [],
  warnings: [],
}

describe('PMO 组合报表四大核心面板 (PmoReports Panels)', () => {
  describe('1. 交付健康分布面板 (PmoReportsHealthSection)', () => {
    test('正确绑定项目数据，并呈现红绿黄灰四色状态指示灯', () => {
      render(
        <PmoReportsHealthSection
          projects={MOCK_PROJECTS}
          summary={MOCK_SUMMARY}
          tier="immersive"
        />,
      )

      expect(screen.getByText('组合交付与健康透视')).toBeInTheDocument()
      expect(screen.getByText(/全域 4 个受纳项目/)).toBeInTheDocument()

      // 四色指示灯汇总卡片
      expect(document.querySelector('[data-health-card="green"]')).toBeInTheDocument()
      expect(document.querySelector('[data-health-card="yellow"]')).toBeInTheDocument()
      expect(document.querySelector('[data-health-card="red"]')).toBeInTheDocument()
      expect(document.querySelector('[data-health-card="gray"]')).toBeInTheDocument()
      expect(screen.getByText('未评/暂停')).toBeInTheDocument()

      // 四色指示点
      expect(document.querySelector('[data-status-dot="green"]')).toBeInTheDocument()
      expect(document.querySelector('[data-status-dot="yellow"]')).toBeInTheDocument()
      expect(document.querySelector('[data-status-dot="red"]')).toBeInTheDocument()
      expect(document.querySelector('[data-status-dot="gray"]')).toBeInTheDocument()
    })

    test('鼠标悬浮项目卡片时展示暗黑悬浮 Tooltip 提示', () => {
      render(
        <PmoReportsHealthSection
          projects={MOCK_PROJECTS}
          summary={MOCK_SUMMARY}
          tier="immersive"
        />,
      )

      const projectCard = document.querySelector('[data-project-health-item="101"]')
      expect(projectCard).toBeInTheDocument()

      fireEvent.mouseEnter(projectCard!)
      const tooltip = screen.getByRole('tooltip')
      expect(tooltip).toBeInTheDocument()
      expect(tooltip).toHaveTextContent('天权全域监控系统')
      expect(tooltip).toHaveTextContent('综合进度：88%')

      fireEvent.mouseLeave(projectCard!)
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })

    test('精确档 (precise) 纯平降级，移除光晕并应用纯色背景与发丝线', () => {
      const { container } = render(
        <PmoReportsHealthSection projects={MOCK_PROJECTS} summary={MOCK_SUMMARY} tier="precise" />,
      )

      const section = container.querySelector('[data-pmo-reports-health-section]')
      expect(section).toHaveAttribute('data-immersion', 'precise')
      expect(section).toHaveClass('shadow-none')
      expect(section).toHaveClass('border-[var(--nx-border-hairline)]')
    })
  })

  describe('2. 工期偏差分析面板 (PmoReportsVarianceSection)', () => {
    test('展示工期偏差直方图与四色状态指示灯，点击项目行触发下钻回调', () => {
      const onProjectClick = vi.fn()
      render(
        <PmoReportsVarianceSection
          projects={MOCK_PROJECTS}
          onProjectClick={onProjectClick}
          tier="immersive"
        />,
      )

      expect(screen.getByText('工期偏差与里程碑达成')).toBeInTheDocument()
      expect(document.querySelector('[data-variance-status-dot="green"]')).toBeInTheDocument()
      expect(document.querySelector('[data-variance-status-dot="yellow"]')).toBeInTheDocument()
      expect(document.querySelector('[data-variance-status-dot="red"]')).toBeInTheDocument()

      // 点击供应链风控决策引擎行
      const criticalRow = document.querySelector('[data-variance-project-row="103"]')
      expect(criticalRow).toBeInTheDocument()
      fireEvent.click(criticalRow!)
      expect(onProjectClick).toHaveBeenCalledWith(103)
    })

    test('悬浮工期偏差直方图行展示暗黑悬浮 Tooltip 提示', () => {
      render(<PmoReportsVarianceSection projects={MOCK_PROJECTS} tier="immersive" />)

      const row = document.querySelector('[data-variance-project-row="103"]')
      fireEvent.mouseEnter(row!)
      const tooltip = screen.getByRole('tooltip')
      expect(tooltip).toBeInTheDocument()
      expect(tooltip).toHaveTextContent('供应链风控决策引擎 · 工期偏差透视')
      expect(tooltip).toHaveTextContent('逾期任务数：6 项')

      fireEvent.mouseLeave(row!)
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })
  })

  describe('3. 跨项目工时负荷面板 (PmoReportsWorkloadSection)', () => {
    test('展示人力负荷对比矩阵与四色状态指示灯', () => {
      render(<PmoReportsWorkloadSection projects={MOCK_PROJECTS} tier="immersive" />)

      expect(screen.getByText('跨项目资源负荷分布')).toBeInTheDocument()
      expect(screen.getByText('总人力池：')).toBeInTheDocument()
      expect(document.querySelector('[data-workload-status-dot="green"]')).toBeInTheDocument()
      expect(document.querySelector('[data-workload-status-dot="red"]')).toBeInTheDocument()

      const card = document.querySelector('[data-workload-project-card="102"]')
      fireEvent.mouseEnter(card!)
      const tooltip = screen.getByRole('tooltip')
      expect(tooltip).toBeInTheDocument()
      expect(tooltip).toHaveTextContent('仓储物流调度中台 · 工时负荷详情')
      expect(tooltip).toHaveTextContent('成员配置：12 人')
    })
  })

  describe('4. 变更冲击波动大盘 (PmoReportsChangeImpactSection)', () => {
    test('展示各项目变更活动与排程冲击指标，并具备暗黑悬浮 Tooltip', () => {
      render(<PmoReportsChangeImpactSection projects={MOCK_PROJECTS} tier="immersive" />)

      expect(screen.getByText('变更冲击与波动度大盘')).toBeInTheDocument()
      expect(screen.getByText('累计受管变更：')).toBeInTheDocument()
      expect(document.querySelector('[data-change-status-dot="gray"]')).toBeInTheDocument()
      expect(document.querySelector('[data-change-status-dot="red"]')).toBeInTheDocument()

      const card = document.querySelector('[data-change-impact-card="103"]')
      fireEvent.mouseEnter(card!)
      const tooltip = screen.getByRole('tooltip')
      expect(tooltip).toBeInTheDocument()
      expect(tooltip).toHaveTextContent('供应链风控决策引擎 · 变更冲击分析')
    })
  })
})
