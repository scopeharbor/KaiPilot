import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import {
  ObjectiveExecutionMatrix,
  sortObjectiveRows,
} from '@/components/next/role-view/ObjectiveExecutionMatrix'
import { AttentionCalloutQueue } from '@/components/next/role-view/AttentionCalloutQueue'
import type { CockpitObjectiveRow, CockpitAttentionItem } from '@aiproj/types'

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
    [key: string]: unknown
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const mockObjectiveRows: CockpitObjectiveRow[] = [
  {
    objectiveId: 1,
    objectiveTitle: '目标 Alpha（健康）',
    scope: 'team',
    status: 'active',
    progress: 85,
    confidence: 'high',
    keyResultCount: 3,
    behindKeyResultCount: 0,
    mappedProjects: [
      {
        kind: 'direct_project_contribution',
        projectId: 101,
        weight: 1,
        contributionPercent: 100,
        sourceVersion: 'v1',
        target: { kind: 'pmo_portfolio', href: '/projects/101', authorized: true },
        authorized: true,
      },
    ],
    coveragePercent: 100,
    executionHealth: 'on_track',
    priorityBand: 'low',
    investmentAlignment: 'aligned',
    resourceRiskPressure: null,
    attentionReasons: [],
    warnings: [],
    target: { kind: 'okr_objective', href: '/okrs/1', authorized: true },
  },
  {
    objectiveId: 2,
    objectiveTitle: '目标 Beta（高风险）',
    scope: 'organization',
    status: 'active',
    progress: 25,
    confidence: 'low',
    keyResultCount: 4,
    behindKeyResultCount: 2,
    mappedProjects: [],
    coveragePercent: 30,
    executionHealth: 'at_risk',
    priorityBand: 'high',
    investmentAlignment: 'mismatch',
    resourceRiskPressure: 3,
    attentionReasons: ['STRATEGY_PROGRESS_AT_RISK', 'EXECUTION_COVERAGE_GAP'],
    warnings: [],
    target: { kind: 'okr_objective', href: '/okrs/2', authorized: true },
  },
  {
    objectiveId: 3,
    objectiveTitle: '目标 Gamma（已完成）',
    scope: 'project',
    status: 'completed',
    progress: 100,
    confidence: 'high',
    keyResultCount: 2,
    behindKeyResultCount: 0,
    mappedProjects: [
      {
        kind: 'direct_project_contribution',
        projectId: 102,
        weight: 1,
        contributionPercent: 100,
        sourceVersion: 'v1',
        target: { kind: 'pmo_portfolio', href: '/projects/102', authorized: true },
        authorized: true,
      },
    ],
    coveragePercent: 100,
    executionHealth: 'on_track',
    priorityBand: 'medium',
    investmentAlignment: 'aligned',
    resourceRiskPressure: null,
    attentionReasons: [],
    warnings: [],
    target: { kind: 'okr_objective', href: '/okrs/3', authorized: true },
  },
]

const mockAttentionItems: CockpitAttentionItem[] = [
  {
    id: 'attn-1',
    severity: 'critical',
    reasonCode: 'STRATEGY_PROGRESS_AT_RISK',
    ruleVersion: '1.2',
    basis: '目标 Beta 周期进度滞后 45%，关键 KR 未就绪',
    message: '海外支付网关接入严重滞后，阻碍 Q3 跨境业务营收',
    objectiveId: 2,
    projectIds: [101],
    sourceFreshness: [],
    warnings: [],
    target: { kind: 'pmo_portfolio', href: '/projects/101', authorized: true },
  },
  {
    id: 'attn-2',
    severity: 'warning',
    reasonCode: 'EXECUTION_COVERAGE_GAP',
    ruleVersion: '1.0',
    basis: '未关联任何有效交付工程项目',
    message: '用户体验一致性升级目标缺乏映射执行项目',
    objectiveId: 4,
    projectIds: [],
    sourceFreshness: [],
    warnings: [],
    target: { kind: 'okr_objective', href: '/okrs/4', authorized: true },
  },
]

describe('ObjectiveExecutionMatrix 与 AttentionCalloutQueue（目标矩阵与注意力队列，任务 1.5 / 1.6）', () => {
  describe('ObjectiveExecutionMatrix 目标矩阵排序与微标', () => {
    it('按风险降序与进度升序正确排列目标列表', () => {
      // 风险降序：目标 Beta 包含 2 个 attentionReasons 且进度低，排在最前
      const sortedByRisk = sortObjectiveRows(mockObjectiveRows, 'risk', 'desc')
      expect(sortedByRisk[0]?.objectiveId).toBe(2)

      // 进度升序：目标 Beta (25%) -> 目标 Alpha (85%) -> 目标 Gamma (100%)
      const sortedByProgressAsc = sortObjectiveRows(mockObjectiveRows, 'progress', 'asc')
      expect(sortedByProgressAsc[0]?.objectiveId).toBe(2)
      expect(sortedByProgressAsc[1]?.objectiveId).toBe(1)
      expect(sortedByProgressAsc[2]?.objectiveId).toBe(3)
    })

    it('多状态彩色微标正确回显', () => {
      render(<ObjectiveExecutionMatrix rows={mockObjectiveRows} />)

      // 验证目标 Beta（风险）
      const betaRow = screen.getByTestId('objective-row-2')
      expect(betaRow).toHaveTextContent('风险')

      // 验证目标 Gamma（已达成）
      const gammaRow = screen.getByTestId('objective-row-3')
      expect(gammaRow).toHaveTextContent('已达成')

      // 验证目标 Alpha（执行中）
      const alphaRow = screen.getByTestId('objective-row-1')
      expect(alphaRow).toHaveTextContent('执行中')
    })

    it('点击矩阵排序按钮切换排序', () => {
      const handleSort = vi.fn()
      render(
        <ObjectiveExecutionMatrix
          rows={mockObjectiveRows}
          sortKey="risk"
          sortOrder="desc"
          onSortChange={handleSort}
        />,
      )

      const progressBtn = screen.getByTestId('sort-btn-progress')
      fireEvent.click(progressBtn)
      expect(handleSort).toHaveBeenCalledWith('progress', 'desc')
    })

    it('点击目标行旁 AI 归因摘要操作点触发回调', () => {
      const handleOpenAi = vi.fn()
      render(
        <ObjectiveExecutionMatrix rows={mockObjectiveRows} onOpenAiAttribution={handleOpenAi} />,
      )

      const aiBtn = screen.getByTestId('ai-attribution-btn-2')
      expect(aiBtn).toBeInTheDocument()
      fireEvent.click(aiBtn)
      expect(handleOpenAi).toHaveBeenCalledTimes(1)
      expect(handleOpenAi).toHaveBeenCalledWith(
        expect.objectContaining({
          objectiveId: 2,
          title: '目标 Beta（高风险）',
        }),
      )
    })

    it('空数据态展示优雅空提示', () => {
      render(<ObjectiveExecutionMatrix rows={[]} />)
      expect(screen.getByTestId('matrix-empty')).toHaveTextContent('无可见战略目标')
    })
  })

  describe('AttentionCalloutQueue 注意力队列', () => {
    it('注意力卡片警示文案与偏离归因标记正确呈现', () => {
      render(<AttentionCalloutQueue attentionItems={mockAttentionItems} />)

      expect(screen.getByText('战略注意力队列')).toBeInTheDocument()
      expect(screen.getByText('共 2 项')).toBeInTheDocument()

      const item1 = screen.getByTestId('attention-item-attn-1')
      expect(item1).toHaveTextContent('紧急阻断')
      expect(item1).toHaveTextContent('STRATEGY_PROGRESS_AT_RISK')
      expect(item1).toHaveTextContent('海外支付网关接入严重滞后')
      expect(item1).toHaveTextContent('目标 Beta 周期进度滞后 45%')

      const item2 = screen.getByTestId('attention-item-attn-2')
      expect(item2).toHaveTextContent('中度偏离')
      expect(item2).toHaveTextContent('EXECUTION_COVERAGE_GAP')
    })

    it('点击注意力卡片上的 AI 归因摘要操作点触发回调', () => {
      const handleOpenAi = vi.fn()
      render(
        <AttentionCalloutQueue
          attentionItems={mockAttentionItems}
          onOpenAiAttribution={handleOpenAi}
        />,
      )

      const attnAiBtn = screen.getByTestId('ai-attribution-attn-attn-1')
      expect(attnAiBtn).toBeInTheDocument()
      fireEvent.click(attnAiBtn)
      expect(handleOpenAi).toHaveBeenCalledTimes(1)
      expect(handleOpenAi).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'attn-1',
          title: '海外支付网关接入严重滞后，阻碍 Q3 跨境业务营收',
        }),
      )
    })

    it('无关注项时展示受控绿色空态', () => {
      render(<AttentionCalloutQueue attentionItems={[]} />)
      expect(screen.getByTestId('attention-empty')).toHaveTextContent(
        '当前无关注项，战略执行状态良好受控。',
      )
    })
  })
})
