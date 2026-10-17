/**
 * BI 风险热力图组件渲染测试（v3-bi-risk-heatmap 前端展示）。
 *
 * 覆盖：
 *   - 列维度为 risk_level 时，网格表头按等级枚举映射为中文标签（严重/高/中/低/数据不足）
 *   - 非 risk_level 列维度（如 risk_status）保持原始枚举值
 *   - Top 风险单元：只渲染 critical/high cell，且列名同样映射中文
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BiRiskHeatmapGrid } from '@/components/bi-risk-heatmap/BiRiskHeatmapGrid'
import { BiRiskHeatmapTopList } from '@/components/bi-risk-heatmap/BiRiskHeatmapTopList'
import type {
  BiRiskHeatmapCell,
  BiRiskHeatmapDimensionKey,
  BiRiskHeatmapMetricKey,
} from '@aiproj/types'

function mkCell(overrides: Partial<BiRiskHeatmapCell>): BiRiskHeatmapCell {
  return {
    rowKey: 'demo-project',
    rowLabel: '演示项目',
    columnKey: 'critical',
    columnLabel: 'critical',
    score: 0.5,
    riskLevel: 'high',
    count: 3,
    delta: null,
    confidence: 0.8,
    contributors: [],
    redactionState: 'none',
    warnings: [],
    evidenceRefs: [],
    sampleCount: 3,
    drilldownTargets: [],
    ...overrides,
  }
}

const METRIC_KEY = 'risk_exposure_score' as BiRiskHeatmapMetricKey

function renderGrid(cells: BiRiskHeatmapCell[], columnDimension: BiRiskHeatmapDimensionKey) {
  return render(
    <BiRiskHeatmapGrid
      cells={cells}
      metricKey={METRIC_KEY}
      metricLabels={{}}
      dimensionLabels={{}}
      rowDimension="project"
      columnDimension={columnDimension}
      onCellClick={() => {}}
    />,
  )
}

describe('BiRiskHeatmapGrid 列标签', () => {
  it('risk_level 列维度将等级枚举映射为中文表头', () => {
    const cells = [
      mkCell({
        rowKey: 'p1',
        rowLabel: '演示项目',
        columnKey: 'critical',
        columnLabel: 'critical',
        riskLevel: 'high',
        score: 0.5,
      }),
      mkCell({
        rowKey: 'p1',
        rowLabel: '演示项目',
        columnKey: 'medium',
        columnLabel: 'medium',
        riskLevel: 'medium',
        score: 0.25,
      }),
    ]
    renderGrid(cells, 'risk_level')
    expect(screen.getByRole('columnheader', { name: '严重' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '中' })).toBeInTheDocument()
    // 原始英文枚举不应再出现在表头
    expect(screen.queryByRole('columnheader', { name: 'critical' })).not.toBeInTheDocument()
  })

  it('非 risk_level 列维度保持原始枚举值', () => {
    const cells = [
      mkCell({
        rowKey: 'p1',
        rowLabel: '演示项目',
        columnKey: 'identified',
        columnLabel: 'identified',
      }),
    ]
    renderGrid(cells, 'risk_status')
    expect(screen.getByRole('columnheader', { name: 'identified' })).toBeInTheDocument()
  })
})

describe('BiRiskHeatmapTopList', () => {
  it('存在 critical/high cell 时渲染 Top 风险单元，列名映射中文', () => {
    const cells = [
      mkCell({
        rowKey: 'p1',
        rowLabel: '演示项目',
        columnKey: 'critical',
        columnLabel: 'critical',
        riskLevel: 'high',
        score: 0.5,
      }),
      mkCell({
        rowKey: 'p2',
        rowLabel: '官网改版',
        columnKey: 'high',
        columnLabel: 'high',
        riskLevel: 'critical',
        score: 0.81,
      }),
    ]
    render(
      <BiRiskHeatmapTopList
        cells={cells}
        metricLabels={{}}
        dimensionLabels={{}}
        columnDimension="risk_level"
        onSelectCell={() => {}}
      />,
    )
    expect(screen.getByText('Top 风险单元')).toBeInTheDocument()
    expect(screen.getByText('演示项目 × 严重')).toBeInTheDocument()
    expect(screen.getByText('官网改版 × 高')).toBeInTheDocument()
  })

  it('全部 cell 低于 high 时不渲染（空态）', () => {
    const cells = [mkCell({ columnKey: 'low', columnLabel: 'low', riskLevel: 'low', score: 0.05 })]
    render(
      <BiRiskHeatmapTopList
        cells={cells}
        metricLabels={{}}
        dimensionLabels={{}}
        columnDimension="risk_level"
        onSelectCell={() => {}}
      />,
    )
    expect(screen.queryByText('Top 风险单元')).not.toBeInTheDocument()
  })
})
