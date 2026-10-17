import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { ProjectDraftPlanInsights, ProjectDraftTask } from '@aiproj/types'
import {
  DraftGovernanceSection,
  DraftPlanInsightsPanel,
  riskStrategyLabel,
} from '@/components/ai-copilot/DraftPlanInsightsPanel'

const insights: ProjectDraftPlanInsights = {
  version: '1.0',
  workCalendar: {
    officialYears: [2026],
    estimatedYears: [2027],
    days: [
      { date: '2027-02-05', name: '春节', work: false, estimated: true },
      { date: '2027-02-06', name: '春节', work: false, estimated: true },
    ],
    changeFreezeWindows: [{ start: '2026-12-11', end: '2027-01-10', label: '封网：年底结算' }],
    productionTasksInFreeze: ['task-9'],
    releaseWindowsInFreeze: [],
  },
  capacity: {
    startDate: '2026-10-12',
    endDate: '2027-04-15',
    workingDays: 120,
    availablePersonDays: 3000,
    requiredPersonDays: 3300,
    utilization: 1.1,
    byRole: [
      {
        role: 'DBA',
        headcount: 2,
        availablePersonDays: 240,
        requiredPersonDays: 300,
        utilization: 1.25,
      },
      {
        role: '后端开发',
        headcount: 10,
        availablePersonDays: 1200,
        requiredPersonDays: 900,
        utilization: 0.75,
      },
    ],
  },
  scheduleConfidence: {
    method: 'pert_monte_carlo',
    samples: 2000,
    deterministicEndDate: '2027-04-09',
    p50EndDate: '2027-04-20',
    p80EndDate: '2027-05-06',
    p90EndDate: '2027-05-18',
    deadline: '2027-04-15',
    onTimeProbability: 0.31,
    explicitEstimateRatio: 0.6,
  },
  stageGates: {
    template: '金融系统重构',
    gates: [
      { key: 'sit', name: 'SIT 系统集成测试', present: true, matchedNodeIds: ['wbs-3'] },
      { key: 'rehearsal', name: '投产演练', present: false, matchedNodeIds: [] },
    ],
    missing: ['投产演练'],
  },
  traceability: {
    deliverables: [
      {
        deliverable: '运维手册',
        wbsNodeIds: ['wbs-9'],
        taskIds: ['task-9'],
        acceptanceIds: [],
        milestoneIds: ['ms-1'],
        complete: false,
      },
    ],
    untracedTaskIds: [],
    coverage: 0,
  },
}

const tasks = [
  { id: 'task-9', name: { value: '账户服务生产投产' } },
] as unknown as ProjectDraftTask[]

describe('计划体检面板', () => {
  test('摘要：按期概率、P80、人天利用率、阶段门、追溯链', () => {
    render(<DraftPlanInsightsPanel insights={insights} tasks={tasks} />)
    const panel = screen.getByTestId('draft-plan-insights')
    expect(within(panel).getByText('31%')).toBeInTheDocument()
    expect(within(panel).getAllByText('2027-05-06').length).toBeGreaterThan(0)
    expect(within(panel).getByText('110%')).toBeInTheDocument()
    expect(within(panel).getByText('1/2')).toBeInTheDocument()
  })

  test('封网期内的投产任务、估算年份、超载角色与缺失阶段门都明确标出', () => {
    render(<DraftPlanInsightsPanel insights={insights} tasks={tasks} />)
    expect(screen.getByText(/封网期内仍有投产类任务/)).toHaveTextContent('账户服务生产投产')
    expect(screen.getByText(/2027 年放假安排尚未公布/)).toBeInTheDocument()
    expect(screen.getByText('125%')).toHaveClass('text-destructive')
    expect(screen.getByText('投产演练').closest('li')).toHaveTextContent('缺失')
    expect(screen.getByText('运维手册').closest('tr')).toHaveTextContent('缺')
  })
})

describe('治理文档', () => {
  test('RACI、质量门准入准出、投产窗口', () => {
    render(
      <DraftGovernanceSection
        governance={{
          raci: [
            {
              activity: '数据迁移',
              responsible: ['DBA', '后端开发'],
              accountable: '架构师',
              consulted: ['安全'],
              informed: ['运维'],
            },
          ],
          qualityGates: [
            {
              name: 'UAT',
              entryCriteria: ['SIT 严重缺陷清零'],
              exitCriteria: ['业务用例通过率 ≥ 98%'],
            },
          ],
          releaseWindows: [
            {
              name: '一期投产',
              startDate: '2027-03-06',
              endDate: '2027-03-07',
              scope: '账户服务、支付路由',
              rollbackPlan: '切回单体，30 分钟内完成',
            },
          ],
        }}
      />,
    )
    expect(screen.getByText('DBA、后端开发')).toBeInTheDocument()
    expect(screen.getByText('业务用例通过率 ≥ 98%')).toBeInTheDocument()
    expect(screen.getByText(/回滚：切回单体/)).toBeInTheDocument()
  })

  test('风险应对策略中文标签', () => {
    expect(riskStrategyLabel('mitigate')).toBe('减轻')
    expect(riskStrategyLabel(undefined)).toBeNull()
  })
})
