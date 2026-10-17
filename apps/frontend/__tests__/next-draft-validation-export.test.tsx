/**
 * v3-ui-next-chart-export W2（tasks 2.6）—— 草案审查面板「汇出报告卡」接入点二测试。
 *
 * 装配目标：NextDraftValidationReport 头部 Header（RiskBadge 旁）挂载
 * NextDraftValidationExportButton，直接消费服务端权威 `DraftValidationReport`。
 *
 * 分享卡弹窗与模板使用 W1 真实组件（ChartShareCardModal +
 * ValidationReportShareCardTemplate），验证（spec「草案审查面板接入点」）：
 * - 点击「汇出报告卡」呼出 1200×630 反幻觉证据卡（标题「反幻觉自检报告卡」）；
 * - 高风险 + Blocking 违规数据在分享卡中精准回显：综合置信度 41、严重风险徽章、
 *   阻断项 2 / 警告项 1、违规规则编号 [HL-001][HL-006][HL-004]；
 * - validation 为 null 时报告区整体不渲染，按钮物理不可达；
 * - draftId 派生 #DRAFT-XXXXXXXX 草案短码作为卡片实体标识；缺省兜底中文实体名。
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { DraftValidationIssue, DraftValidationReport } from '@aiproj/types'
import { formatDraftShortCode } from '@/components/next/theater/TheaterSettledView'
import { NextDraftValidationReport } from '@/components/next/review/NextDraftValidationReport'

function issueOf(ruleId: string, severity: DraftValidationIssue['severity']): DraftValidationIssue {
  return {
    ruleId,
    severity,
    message: `${ruleId} 违规明细`,
    path: null,
  }
}

function makeValidation(overrides: Partial<DraftValidationReport> = {}): DraftValidationReport {
  return {
    overallRiskLevel: 'low',
    confidenceScore: 94,
    dimensionScores: {
      factualAccuracy: 95,
      logicalConsistency: 90,
      assumptionClarity: 92,
      completeness: 88,
      numericPlausibility: 96,
    },
    blocking: [],
    warning: [],
    info: [],
    ruleResults: [],
    autoFixDiffs: [],
    canConfirm: true,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

const DRAFT_ID = 'df_7e3f1a90'

describe('反幻觉自检报告汇出（tasks 2.6）', () => {
  test('validation 为 null 时报告区整体不渲染，汇出按钮物理不可达', () => {
    const { container } = render(<NextDraftValidationReport validation={null} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('button', { name: '汇出报告卡' })).not.toBeInTheDocument()
  })

  test('低风险零阻断报告：点击「汇出报告卡」呼出真实分享卡（W1 弹窗 + 模板）', async () => {
    const validation = makeValidation()
    render(<NextDraftValidationReport validation={validation} draftId={DRAFT_ID} />)

    fireEvent.click(screen.getByRole('button', { name: '汇出报告卡' }))

    const dialog = await screen.findByRole('dialog', { name: '反幻觉自检报告卡' })
    expect(dialog).toBeInTheDocument()

    // 权威实体在卡片中的精准呈现
    expect(dialog.querySelector('[data-share-card-entity]')?.textContent).toBe(
      `#DRAFT-${formatDraftShortCode(DRAFT_ID)}`,
    )
    expect(dialog.querySelector('[data-share-card-view-badge]')?.textContent).toBe('反幻觉自检报告')
    expect(dialog.querySelector('[data-validation-confidence]')?.textContent).toBe('94')
    expect(dialog.querySelector('[data-validation-risk]')?.textContent).toBe('低风险')
    expect(dialog.querySelector('[data-validation-blocking-count]')?.textContent).toContain('0')
    expect(dialog.querySelector('[data-validation-warning-count]')?.textContent).toContain('0')
  })

  test('高风险 + Blocking 违规：分享卡精准回显阻断项/警告项与「严重风险」徽章', async () => {
    const validation = makeValidation({
      overallRiskLevel: 'critical',
      confidenceScore: 41,
      blocking: [issueOf('HL-001', 'blocking'), issueOf('HL-006', 'blocking')],
      warning: [issueOf('HL-004', 'warning')],
      canConfirm: false,
    })
    render(<NextDraftValidationReport validation={validation} draftId={DRAFT_ID} />)

    fireEvent.click(screen.getByRole('button', { name: '汇出报告卡' }))

    const dialog = await screen.findByRole('dialog', { name: '反幻觉自检报告卡' })
    expect(dialog.querySelector('[data-validation-confidence]')?.textContent).toBe('41')
    const riskBadge = dialog.querySelector('[data-validation-risk]')
    expect(riskBadge?.getAttribute('data-risk-level')).toBe('critical')
    expect(riskBadge?.textContent).toBe('严重风险')
    expect(dialog.querySelector('[data-validation-blocking-count]')?.textContent).toBe('阻断项：2')
    expect(dialog.querySelector('[data-validation-warning-count]')?.textContent).toBe('警告项：1')

    // 违规规则编号嵌入卡片（至多 3 枚：2 阻断 + 1 警告）
    await waitFor(() => {
      const chips = Array.from(dialog.querySelectorAll('[data-validation-rule-chip]')).map(
        (node) => node.textContent,
      )
      expect(chips).toEqual(['[HL-001]', '[HL-006]', '[HL-004]'])
    })

    // 五维能量条（事实准确性等）完整渲染
    expect(dialog.querySelectorAll('[data-dimension-bar]')).toHaveLength(5)
  })

  test('未提供 draftId 时卡片实体标识兜底为「反幻觉自检报告」', async () => {
    const validation = makeValidation()
    render(<NextDraftValidationReport validation={validation} />)

    fireEvent.click(screen.getByRole('button', { name: '汇出报告卡' }))

    const dialog = await screen.findByRole('dialog', { name: '反幻觉自检报告卡' })
    expect(dialog.querySelector('[data-share-card-entity]')?.textContent).toBe('反幻觉自检报告')
  })
})
