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

describe('参照类对比（v3-llm-wiki-planning-dossier）', () => {
  const rc = { label: '软件类项目任务工期参照类', samples: 20, p50Days: 3, p80Days: 5 }

  test('列出超 P80 的任务并说明依据与「仅提示」', () => {
    render(
      <DraftPlanInsightsPanel
        insights={{
          ...insights,
          referenceClass: {
            ...rc,
            longTasks: [
              { id: 'task-1', name: '需求分析', durationDays: 12 },
              { id: 'task-9', name: '', durationDays: 8 },
            ],
          },
        }}
        tasks={[]}
      />,
    )
    const section = screen.getByTestId('draft-reference-class')
    expect(within(section).getByText(/依据组织维基「软件类项目任务工期参照类」/)).toBeTruthy()
    expect(within(section).getByText(/20 个样本/)).toBeTruthy()
    expect(within(section).getByText(/2 个任务的工期超过 P80.*仅提示，不影响转正/)).toBeTruthy()
    expect(within(section).getByText('需求分析 · 12 天')).toBeTruthy()
    expect(within(section).getByText('task-9 · 8 天')).toBeTruthy()
  })

  test('没有超 P80 的任务时给出肯定提示；没有参照类时不显示', () => {
    const { unmount } = render(
      <DraftPlanInsightsPanel
        insights={{ ...insights, referenceClass: { ...rc, longTasks: [] } }}
        tasks={[]}
      />,
    )
    expect(screen.getByText('没有任务的工期超过 P80。')).toBeTruthy()
    unmount()
    render(<DraftPlanInsightsPanel insights={insights} tasks={[]} />)
    expect(screen.queryByTestId('draft-reference-class')).toBeNull()
  })
})

describe('流程实况（v3-llm-wiki-process-reality）', () => {
  test('列出提示句与审批类短工期任务，并说明仅提示', () => {
    render(
      <DraftPlanInsightsPanel
        insights={{
          ...insights,
          processReality: {
            notes: [
              '本组织约 25% 的任务完成后又被重新打开或退回（「任务流转：声明与实际」，30 个样本）：评审、验收类任务建议预留返工缓冲。',
              '本组织变更审批从提交到结论实际要 P80 5 天（「变更审批：声明与实际」，6 个样本）：2 个审批类任务的工期短于这个值，确认是否留够等待时间。',
            ],
            approvalTasks: [
              { id: 'task-3', name: '法务审批', durationDays: 1 },
              { id: 'task-4', name: '', durationDays: 2 },
            ],
          },
        }}
        tasks={[]}
      />,
    )
    const section = screen.getByTestId('draft-process-reality')
    expect(within(section).getByText(/仅提示，不影响转正/)).toBeTruthy()
    expect(within(section).getByText(/约 25% 的任务完成后又被重新打开/)).toBeTruthy()
    expect(within(section).getByText(/P80 5 天/)).toBeTruthy()
    expect(within(section).getByText('法务审批 · 1 天')).toBeTruthy()
    expect(within(section).getByText('task-4 · 2 天')).toBeTruthy()
  })

  test('没有流程实况时不显示', () => {
    render(<DraftPlanInsightsPanel insights={insights} tasks={[]} />)
    expect(screen.queryByTestId('draft-process-reality')).toBeNull()
  })
})

describe('历史教训（v3-llm-wiki-retrospective-lessons）', () => {
  test('有教训时列出并注明章节；没有时不显示', () => {
    const { unmount } = render(
      <DraftPlanInsightsPanel
        insights={{
          ...insights,
          lessons: [
            {
              statement: '证书类任务开工前先确认办理周期（来自「支付改造」复盘）。',
              section: '软件类',
            },
            { statement: '第三方依赖要指定负责人。', section: null },
          ],
        }}
        tasks={[]}
      />,
    )
    const section = screen.getByTestId('draft-lessons')
    expect(within(section).getByText(/仅提示，不影响转正/)).toBeTruthy()
    expect(within(section).getByText('［软件类］')).toBeTruthy()
    expect(within(section).getByText(/第三方依赖要指定负责人/)).toBeTruthy()
    unmount()
    render(<DraftPlanInsightsPanel insights={insights} tasks={[]} />)
    expect(screen.queryByTestId('draft-lessons')).toBeNull()
  })
})
