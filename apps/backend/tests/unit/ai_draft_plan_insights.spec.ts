import { describe, expect, it } from 'vitest'
import type { ProjectDraftGroundingManifest } from '@aiproj/types'
import {
  autoLinkTraceability,
  computePlanInsights,
  evaluateStageGates,
  evaluateTraceability,
  stageGateTemplate,
} from '#services/ai_draft/plan_insights'
import { normalizeDraftExtensions } from '#services/ai_draft/draft_extensions'

const RAW_INPUT =
  '某城商行计划于 2026 年 10 月 12 日启动「支付清算中台」微服务化重构项目，目标 2027 年 4 月中旬完成生产切换。' +
  '合规要求：通过等保 2.0 三级测评、满足金融信创要求。迁移采用双轨并行、灰度切流；' +
  '年底结算高峰（12 月中旬至 1 月上旬）与春节期间冻结生产变更。团队约 25 人：DBA 2、后端开发 10。'

const marker = { confidence: 0.8, source: 'inferred', reason: '按排期', needsConfirmation: true }
const field = <T>(value: T) => ({ value, marker: { ...marker } })

function node(id: string, name: string, parentId: string | null = null) {
  return {
    id,
    parentId,
    outlineCode: id,
    name: field(name),
    description: field(''),
    isLeaf: parentId !== null,
    isNote: false,
    children: [],
  }
}

function task(
  id: string,
  wbsNodeId: string,
  name: string,
  role: string,
  start: string,
  end: string,
  days: number,
) {
  return {
    id,
    wbsNodeId,
    name: field(name),
    description: field(''),
    status: 'not_started',
    durationDays: field(days),
    startDate: field(start),
    endDate: field(end),
    assigneeHint: field(role),
    assigneeRoleIds: field([role]),
  }
}

const manifest = {
  version: '1.0',
  projectType: 'software',
  hash: 'x',
  truncated: false,
  facts: [
    {
      id: 'deliverable:1',
      category: 'deliverable',
      normalizedValue: '数据迁移方案',
      source: 'parsed',
      required: true,
      hash: 'a',
    },
    {
      id: 'deliverable:2',
      category: 'deliverable',
      normalizedValue: '运维手册',
      source: 'parsed',
      required: true,
      hash: 'b',
    },
  ],
} as unknown as ProjectDraftGroundingManifest

function draft() {
  return {
    charter: {
      startDate: field('2026-10-12'),
      endDate: field('2027-04-15'),
      title: field('支付清算中台'),
      scope: field(''),
    },
    wbs: [
      node('w1', '需求与设计'),
      node('w1-1', '需求分析与评审', 'w1'),
      node('w2', '数据迁移'),
      node('w2-1', '数据迁移方案编写', 'w2'),
      node('w3', '上线与运维'),
      node('w3-1', '生产投产', 'w3'),
      node('w3-2', '运维手册编写', 'w3'),
    ],
    tasks: [
      task('t1', 'w1-1', '需求调研', '后端开发', '2026-10-12', '2026-10-16', 5),
      task('t2', 'w2-1', '编写数据迁移方案', 'DBA', '2026-10-19', '2026-10-30', 10),
      task('t3', 'w3-1', '账户服务生产投产', '运维', '2026-12-14', '2026-12-15', 2),
      task('t4', 'w3-2', '编写运维手册', '运维', '2027-03-01', '2027-03-05', 5),
      task('t5', 'w9', '机房巡检', '运维', '2027-03-08', '2027-03-09', 2),
    ],
    dependencies: [
      { id: 'd1', predecessorId: 't1', successorId: 't2', type: 'FS', lagDays: field(0) },
      { id: 'd2', predecessorId: 't2', successorId: 't3', type: 'FS', lagDays: field(0) },
    ],
    acceptanceCriteria: [
      {
        id: 'ac1',
        statement: field('数据迁移方案通过评审，核对差异为 0'),
        linkedTaskId: null,
        linkedSuccessIndex: null,
      },
    ],
    resourceHints: [
      { id: 'r1', role: field('DBA'), headcount: field(2), allocationNote: field('') },
      { id: 'r2', role: field('后端开发'), headcount: field(10), allocationNote: field('') },
      { id: 'r3', role: field('运维'), headcount: field(2), allocationNote: field('') },
    ],
    riskHints: [],
    milestoneHints: [
      {
        id: 'ms1',
        name: field('数据迁移就绪'),
        targetDate: field('2026-10-30'),
        linkedTaskIds: [],
      },
    ],
  } as Record<string, unknown>
}

describe('stageGateTemplate / evaluateStageGates', () => {
  it('金融 + 等保 + 信创 + 迁移：模板含等保三段、信创适配、数据迁移、投产演练', () => {
    const names = stageGateTemplate(RAW_INPUT).gates.map((gate) => gate.name)
    expect(names).toEqual(
      expect.arrayContaining([
        '等保定级与备案',
        '等保差距分析与整改',
        '等保测评',
        '信创适配验证',
        '数据迁移与核对',
        '投产演练',
        'UAT 用户验收测试',
      ]),
    )
  })

  it('普通软件项目不要求等保、信创', () => {
    const names = stageGateTemplate('给内部运营团队做一个工单系统').gates.map((gate) => gate.name)
    expect(names).not.toContain('等保测评')
    expect(names).toContain('SIT 系统集成测试')
  })

  it('按 WBS / 任务名称判定阶段是否覆盖，列出缺失项', () => {
    const result = evaluateStageGates(draft(), RAW_INPUT)
    expect(result.template).toBe('金融系统重构')
    expect(result.missing).toContain('UAT 用户验收测试')
    expect(result.missing).toContain('投产演练')
    expect(result.gates.find((gate) => gate.key === 'requirements')?.present).toBe(true)
  })
})

describe('computePlanInsights', () => {
  const insights = computePlanInsights({ draft: draft(), rawInput: RAW_INPUT, manifest })

  it('工作日历：2027 估算年份、封网窗口、封网期内的投产任务', () => {
    expect(insights.workCalendar.estimatedYears).toContain(2027)
    expect(insights.workCalendar.changeFreezeWindows.length).toBeGreaterThanOrEqual(2)
    expect(insights.workCalendar.productionTasksInFreeze).toEqual(['t3'])
    expect(insights.workCalendar.days.some((day) => day.name === '春节')).toBe(true)
  })

  it('产能：可用人天 = 人数 × 项目工作日（扣除法定假日），按角色给出利用率', () => {
    const { capacity } = insights
    expect(capacity.workingDays).toBeGreaterThan(100)
    expect(capacity.workingDays).toBeLessThan(130)
    const dba = capacity.byRole.find((row) => row.role === 'DBA')!
    expect(dba.availablePersonDays).toBe(2 * capacity.workingDays)
    expect(dba.requiredPersonDays).toBe(10)
  })

  it('置信区间：P50 ≤ P80 ≤ P90，按期概率在 0..1，结果可复现', () => {
    const confidence = insights.scheduleConfidence
    expect(confidence.samples).toBe(2000)
    expect(confidence.p50EndDate! <= confidence.p80EndDate!).toBe(true)
    expect(confidence.p80EndDate! <= confidence.p90EndDate!).toBe(true)
    expect(confidence.onTimeProbability).toBeGreaterThanOrEqual(0)
    expect(confidence.onTimeProbability).toBeLessThanOrEqual(1)
    const again = computePlanInsights({ draft: draft(), rawInput: RAW_INPUT, manifest })
    expect(again.scheduleConfidence).toEqual(confidence)
  })

  it('三点估算：模型给出的悲观值更大时，P90 相应推后', () => {
    const wide = draft()
    ;(wide.tasks as Array<Record<string, unknown>>)[1].estimate = {
      optimisticDays: 8,
      pessimisticDays: 40,
    }
    const widened = computePlanInsights({ draft: wide, rawInput: RAW_INPUT, manifest })
    expect(widened.scheduleConfidence.explicitEstimateRatio).toBeGreaterThan(0)
    expect(widened.scheduleConfidence.p90EndDate! >= insights.scheduleConfidence.p90EndDate!).toBe(
      true,
    )
  })

  it('产能：多人协作任务的人天按 工期 × headcount 折算，未标注任务不受影响', () => {
    const multi = draft()
    ;(multi.tasks as Array<Record<string, unknown>>)[1].headcount = 3
    const result = computePlanInsights({ draft: multi, rawInput: RAW_INPUT, manifest })
    const dba = result.capacity.byRole.find((row) => row.role === 'DBA')!
    expect(dba.requiredPersonDays).toBe(30)
    const ops = result.capacity.byRole.find((row) => row.role === '运维')!
    expect(ops.requiredPersonDays).toBe(9)
  })

  it('追溯链：数据迁移方案缺里程碑关联前不完整；无归属的任务被列出', () => {
    const migration = insights.traceability.deliverables.find(
      (item) => item.deliverable === '数据迁移方案',
    )!
    expect(migration.wbsNodeIds).toContain('w2')
    expect(migration.taskIds).toContain('t2')
    expect(migration.acceptanceIds).toEqual(['ac1'])
    expect(insights.traceability.untracedTaskIds).toContain('t5')
    expect(insights.traceability.untracedTaskIds).not.toContain('t4')
  })
})

describe('autoLinkTraceability', () => {
  it('只补空关联：验收标准挂到最相关任务，里程碑挂到对应分支最晚完成的任务', () => {
    const linked = autoLinkTraceability(draft())
    expect(linked.changed).toBe(true)
    expect((linked.acceptanceCriteria[0] as { linkedTaskId: string }).linkedTaskId).toBe('t2')
    expect((linked.milestoneHints[0] as { linkedTaskIds: string[] }).linkedTaskIds).toEqual(['t2'])
    const after = computePlanInsights({
      draft: {
        ...draft(),
        acceptanceCriteria: linked.acceptanceCriteria,
        milestoneHints: linked.milestoneHints,
      },
      rawInput: RAW_INPUT,
      manifest,
    })
    expect(
      after.traceability.deliverables.find((item) => item.deliverable === '数据迁移方案')?.complete,
    ).toBe(true)
  })
})

describe('evaluateTraceability 拆解层溯源', () => {
  it('WBS / 任务名不含交付物原文时，按工作包声明的交付物建立完整追溯链', () => {
    const minimal: Record<string, unknown> = {
      charter: { startDate: field('2026-10-12'), endDate: field('2027-04-15') },
      wbs: [node('w1', '迁移实施'), node('w1-1', '方案编写', 'w1')],
      tasks: [
        {
          ...task('t1', 'w1-1', '编写方案', 'DBA', '2026-10-19', '2026-10-30', 10),
          trace: {
            capabilityId: 'cap-1',
            capabilityName: '数据迁移',
            workPackageId: 'wp-1',
            workPackageName: '迁移方案',
          },
        },
      ],
      dependencies: [],
      acceptanceCriteria: [
        {
          id: 'ac1',
          statement: field('数据迁移方案通过评审，核对差异为 0'),
          linkedTaskId: 't1',
          linkedSuccessIndex: null,
        },
      ],
      milestoneHints: [
        {
          id: 'ms1',
          name: field('迁移就绪'),
          targetDate: field('2026-10-30'),
          linkedTaskIds: ['t1'],
        },
      ],
      resourceHints: [],
      riskHints: [],
      decomposition: {
        capabilities: [{ id: 'cap-1', name: '数据迁移', wbsNodeId: 'w1' }],
        workPackages: [
          {
            id: 'wp-1',
            capabilityId: 'cap-1',
            name: '迁移方案',
            deliverable: '数据迁移方案',
            doneDefinition: '评审通过',
            dependsOn: [],
            effortDays: 10,
            wbsNodeId: 'w1-1',
          },
        ],
        candidateReviews: [],
      },
    }
    // 没有拆解层时：WBS/任务文本都不含「数据迁移方案」，链条不完整
    const withoutDecomposition = { ...minimal }
    delete withoutDecomposition.decomposition
    const before = evaluateTraceability(withoutDecomposition, manifest)
    expect(before.deliverables.find((item) => item.deliverable === '数据迁移方案')?.complete).toBe(
      false,
    )

    const after = evaluateTraceability(minimal, manifest)
    const row = after.deliverables.find((item) => item.deliverable === '数据迁移方案')!
    expect(row.wbsNodeIds).toContain('w1-1')
    expect(row.taskIds).toContain('t1')
    expect(row.complete).toBe(true)
    expect(after.untracedTaskIds).toEqual([])
  })

  it('任务溯源到声明了交付物的工作包即视为可追溯，即使交付物不在用户显式清单里', () => {
    const traced = draft()
    traced.decomposition = {
      capabilities: [{ id: 'cap-1', name: '运行保障', wbsNodeId: 'w9' }],
      workPackages: [
        {
          id: 'wp-9',
          capabilityId: 'cap-1',
          name: '机房环境保障',
          deliverable: '机房就绪报告',
          doneDefinition: '报告签收',
          dependsOn: [],
          effortDays: 5,
          wbsNodeId: 'w9',
        },
      ],
      candidateReviews: [],
    }
    // t5「机房巡检」原先在 untracedTaskIds 里；溯源到声明了交付物的工作包后不再列入
    ;(traced.tasks as Array<Record<string, unknown>>)[4].trace = {
      capabilityId: 'cap-1',
      capabilityName: '运行保障',
      workPackageId: 'wp-9',
      workPackageName: '机房环境保障',
    }
    const result = evaluateTraceability(traced, manifest)
    expect(result.untracedTaskIds).not.toContain('t5')
  })
})

describe('normalizeDraftExtensions', () => {
  it('修正三点估算、风险扩展（中文策略名、裸字符串）与治理文档的常见形态偏差', () => {
    const value: Record<string, unknown> = {
      tasks: [
        { durationDays: field(5), estimate: { optimisticDays: '4', pessimisticDays: 9 } },
        { durationDays: field(5), estimate: { optimisticDays: 7, pessimisticDays: 9 } },
      ],
      riskHints: [
        { trigger: '压测 TPS 连续两轮低于 2500', ownerRole: field('架构师'), strategy: '减轻' },
      ],
      governance: {
        raci: [
          {
            activity: field('数据迁移'),
            responsible: 'DBA、后端开发',
            accountable: '架构师',
            consulted: [],
            informed: '运维',
          },
        ],
        qualityGates: [{ name: 'UAT', entryCriteria: ['SIT 严重缺陷清零'], exitCriteria: [] }],
        releaseWindows: [
          {
            name: '一期',
            startDate: '2027-3-6',
            endDate: '2027-03-07',
            scope: '',
            rollbackPlan: '',
          },
        ],
      },
    }
    normalizeDraftExtensions(value)
    const tasks = value.tasks as Array<Record<string, unknown>>
    expect(tasks[0].estimate).toEqual({ optimisticDays: 4, pessimisticDays: 9 })
    expect(tasks[1].estimate).toBeUndefined()
    const risk = (value.riskHints as Array<Record<string, { value: unknown }>>)[0]
    expect(risk.strategy.value).toBe('mitigate')
    expect(risk.trigger.value).toBe('压测 TPS 连续两轮低于 2500')
    const governance = value.governance as {
      raci: Array<{ activity: string; responsible: string[]; informed: string[] }>
      releaseWindows: unknown[]
    }
    expect(governance.raci[0]).toMatchObject({
      activity: '数据迁移',
      responsible: ['DBA', '后端开发'],
      informed: ['运维'],
    })
    expect(governance.releaseWindows).toEqual([])
  })

  it('治理文档完全不合法时整体移除', () => {
    const value: Record<string, unknown> = { governance: '见附件' }
    normalizeDraftExtensions(value)
    expect(value.governance).toBeUndefined()
  })

  it('任务投入人数：数字与数字字符串取整保留、Marked 包装拆开，非法值丢弃按 1 人计', () => {
    const value: Record<string, unknown> = {
      tasks: [
        { headcount: 3 },
        { headcount: '4' },
        { headcount: { value: 2, marker: { confidence: 0.7 } } },
        { headcount: 0 },
        { headcount: 99 },
        { headcount: '很多人' },
      ],
    }
    normalizeDraftExtensions(value)
    const tasks = value.tasks as Array<Record<string, unknown>>
    expect(tasks[0].headcount).toBe(3)
    expect(tasks[1].headcount).toBe(4)
    expect(tasks[2].headcount).toBe(2)
    expect(tasks[3].headcount).toBeUndefined()
    expect(tasks[4].headcount).toBeUndefined()
    expect(tasks[5].headcount).toBeUndefined()
  })
})
