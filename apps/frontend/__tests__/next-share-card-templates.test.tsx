import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type {
  DraftOverallRiskLevel,
  DraftValidationIssue,
  DraftValidationReport,
} from '@aiproj/types'
import type { Task } from '@/lib/api/tasks'
import { KanbanShareCardTemplate } from '@/components/next/export/KanbanShareCardTemplate'
import { ShareCardCanvas } from '@/components/next/export/ShareCardCanvas'
import { ValidationReportShareCardTemplate } from '@/components/next/export/ValidationReportShareCardTemplate'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    projectId: 1,
    name: '测试任务',
    description: null,
    status: 'not_started',
    priority: 'medium',
    taskType: 'task',
    startDate: null,
    endDate: null,
    actualStartDate: null,
    actualEndDate: null,
    durationDays: null,
    estimatedHours: null,
    actualHours: null,
    progressPercent: 0,
    assigneeId: null,
    reviewerId: null,
    parentTaskId: null,
    wbsNodeId: null,
    milestoneId: null,
    costEstimateCents: null,
    costActualCents: null,
    customFields: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

describe('ShareCardCanvas（1200×630 通用画布外壳）', () => {
  it('固定 1200×630 尺寸、Midnight 底色与内联令牌自包含', () => {
    const { container } = render(
      <ShareCardCanvas entityName="智能车载系统研发" viewType="看板工作面">
        <div>数据区</div>
      </ShareCardCanvas>,
    )
    const card = container.querySelector('[data-share-card]') as HTMLElement
    expect(card).not.toBeNull()
    expect(card.style.width).toBe('1200px')
    expect(card.style.height).toBe('630px')
    expect(card.style.backgroundColor).toBe('rgb(2, 6, 23)') // #020617
    // 自包含令牌：导出克隆文档不依赖 [data-next-track] 作用域。
    expect(card.style.getPropertyValue('--nx-chart-1')).toBe('#38bdf8')
    expect(card.style.getPropertyValue('--nx-text-primary')).toBe('#f1f5f9')
  })

  it('Header 渲染实体名与视图徽章，Footer 渲染时间戳 / 租户防线 / 防伪水印', () => {
    render(
      <ShareCardCanvas
        entityName="智能车载系统研发"
        viewType="看板工作面"
        timestamp={new Date(2026, 8, 9, 15, 30, 0)}
      >
        <div>数据区</div>
      </ShareCardCanvas>,
    )
    expect(screen.getByText('智能车载系统研发')).toBeInTheDocument()
    expect(screen.getByText('看板工作面')).toBeInTheDocument()
    expect(screen.getByText('租户物理隔离 · 内部凭证')).toBeInTheDocument()
    expect(screen.getByText('开项 KaiPilot · Evidence Console')).toBeInTheDocument()
    expect(screen.getByText('导出时间：2026-09-09 15:30:00')).toBeInTheDocument()
    expect(screen.getByText('数据区')).toBeInTheDocument()
  })

  it('缺省时间戳为当前时刻且格式 YYYY-MM-DD HH:mm:ss', () => {
    const { container } = render(
      <ShareCardCanvas entityName="开项" viewType="分享卡">
        <div />
      </ShareCardCanvas>,
    )
    const timestamp = container.querySelector('[data-share-card-timestamp]')
    expect(timestamp?.textContent).toMatch(/导出时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)
  })
})

describe('KanbanShareCardTemplate（看板四列微缩 + 指标 HUD）', () => {
  function renderBoard() {
    const pendingTasks = [
      makeTask({ id: 1, name: '架构重构' }),
      makeTask({ id: 2, name: '单元测试' }),
    ]
    const inProgressTasks = [makeTask({ id: 3, name: '接口对接', status: 'in_progress' })]
    const completedTasks = [
      makeTask({ id: 4, name: '原型评审', status: 'completed' }),
      makeTask({ id: 5, name: '数据库迁移', status: 'completed' }),
    ]
    const otherTasks = [makeTask({ id: 6, name: '需求挂起', status: 'blocked' })]

    return render(
      <ShareCardCanvas entityName="智能车载系统研发" viewType="看板工作面">
        <KanbanShareCardTemplate
          boardData={{ pendingTasks, inProgressTasks, completedTasks, otherTasks }}
        />
      </ShareCardCanvas>,
    )
  }

  it('渲染四列标签与等宽计数', () => {
    const { container } = renderBoard()
    const columns = container.querySelectorAll('[data-kanban-column]')
    expect(columns).toHaveLength(4)
    expect(columns[0]).toHaveAttribute('data-kanban-column-key', 'pending')
    expect(columns[1]).toHaveAttribute('data-kanban-column-key', 'inProgress')
    expect(columns[2]).toHaveAttribute('data-kanban-column-key', 'completed')
    expect(columns[3]).toHaveAttribute('data-kanban-column-key', 'other')

    // 列标签（进行中/已完成 同时出现在 HUD 度量带，故用 getAllByText）。
    expect(screen.getAllByText('待处理')).toHaveLength(1)
    expect(screen.getAllByText('进行中').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('已完成').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('其他')).toHaveLength(1)

    const counts = container.querySelectorAll('[data-kanban-column-count]')
    expect([...counts].map((el) => el.textContent)).toEqual(['2', '1', '2', '1'])
  })

  it('渲染列内任务微缩名与超量折叠提示', () => {
    const { container } = render(
      <ShareCardCanvas entityName="开项" viewType="看板工作面">
        <KanbanShareCardTemplate
          boardData={{
            pendingTasks: [
              makeTask({ id: 1, name: '任务 A' }),
              makeTask({ id: 2, name: '任务 B' }),
              makeTask({ id: 3, name: '任务 C' }),
              makeTask({ id: 4, name: '任务 D' }),
            ],
          }}
        />
      </ShareCardCanvas>,
    )
    expect(container.querySelectorAll('[data-kanban-task]')).toHaveLength(3)
    expect(screen.getByText('任务 A')).toBeInTheDocument()
    expect(screen.queryByText('任务 D')).not.toBeInTheDocument()
    expect(container.querySelector('[data-kanban-column-more]')?.textContent).toBe('+1 项')
  })

  it('HUD 度量带正确派生 5 项指标（design §5 示例口径）', () => {
    const { container } = renderBoard()
    const metrics = container.querySelectorAll('[data-kanban-metric]')
    expect(metrics).toHaveLength(5)

    const valueOf = (key: string) =>
      container.querySelector(`[data-kanban-metric="${key}"] [data-kanban-metric-value]`)
        ?.textContent
    expect(valueOf('totalTasks')).toBe('6')
    expect(valueOf('inProgressTasks')).toBe('1')
    expect(valueOf('completedTasks')).toBe('2')
    expect(valueOf('overdueTasks')).toBe('0')
    expect(valueOf('progressRate')).toBe('33%') // 2/6 ≈ 33.33 → 33
  })
})

describe('ValidationReportShareCardTemplate（反幻觉自检报告卡）', () => {
  function makeIssue(
    ruleId: string,
    severity: DraftValidationIssue['severity'],
  ): DraftValidationIssue {
    return { ruleId, severity, message: `${ruleId} 违规`, path: null }
  }

  function makeValidation(overrides: Partial<DraftValidationReport> = {}): DraftValidationReport {
    return {
      overallRiskLevel: 'low',
      confidenceScore: 94,
      dimensionScores: {
        factualAccuracy: 95,
        logicalConsistency: 88,
        assumptionClarity: 90,
        completeness: 76,
        numericPlausibility: 84,
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

  it('渲染综合置信度大字、低风险徽章与五维能量条', () => {
    const { container } = render(
      <ShareCardCanvas entityName="#DRAFT-7A8B9C0D" viewType="反幻觉自检报告">
        <ValidationReportShareCardTemplate validation={makeValidation()} />
      </ShareCardCanvas>,
    )
    expect(container.querySelector('[data-validation-confidence]')?.textContent).toBe('94')
    const riskBadge = container.querySelector('[data-validation-risk]')
    expect(riskBadge?.textContent).toContain('低风险')
    expect(riskBadge).toHaveAttribute('data-risk-level', 'low')

    const bars = container.querySelectorAll('[data-dimension-bar]')
    expect(bars).toHaveLength(5)
    const scores = container.querySelectorAll('[data-dimension-score]')
    expect([...scores].map((el) => el.textContent)).toEqual(['95', '88', '90', '76', '84'])
    const scoreBars = container.querySelectorAll('[data-dimension-score-bar]')
    expect((scoreBars[0] as HTMLElement).style.width).toBe('95%')
    expect(container.querySelector('[data-dimension-weight]')?.textContent).toBe('权重 0.30')
  })

  it('critical + 2 阻断 / 1 警告：严重风险红标、计数与规则编号嵌入卡片', () => {
    const validation = makeValidation({
      overallRiskLevel: 'critical' as DraftOverallRiskLevel,
      blocking: [makeIssue('HL-001', 'blocking'), makeIssue('VE-010', 'blocking')],
      warning: [makeIssue('HL-004', 'warning')],
    })
    const { container } = render(
      <ShareCardCanvas entityName="#DRAFT-7A8B9C0D" viewType="反幻觉自检报告">
        <ValidationReportShareCardTemplate validation={validation} />
      </ShareCardCanvas>,
    )
    const riskBadge = container.querySelector('[data-validation-risk]')
    expect(riskBadge?.textContent).toContain('严重风险')
    expect(riskBadge).toHaveAttribute('data-risk-level', 'critical')
    expect(container.querySelector('[data-validation-blocking-count]')?.textContent).toContain('2')
    expect(container.querySelector('[data-validation-warning-count]')?.textContent).toContain('1')

    const chips = container.querySelectorAll('[data-validation-rule-chip]')
    expect([...chips].map((el) => el.textContent)).toEqual(['[HL-001]', '[VE-010]', '[HL-004]'])
  })

  it('零违规：计数为 0 且不渲染规则编号', () => {
    const { container } = render(
      <ShareCardCanvas entityName="#DRAFT-7A8B9C0D" viewType="反幻觉自检报告">
        <ValidationReportShareCardTemplate validation={makeValidation()} />
      </ShareCardCanvas>,
    )
    expect(container.querySelector('[data-validation-blocking-count]')?.textContent).toContain('0')
    expect(container.querySelectorAll('[data-validation-rule-chip]')).toHaveLength(0)
  })
})
