import { test } from '@japa/runner'
import {
  DRAFT_HALLUCINATION_RULE_IDS,
  DRAFT_VALIDATION_ENGINE_RULE_IDS,
  DRAFT_VALIDATION_RULE_AUTO_FIXABLE,
  DRAFT_VALIDATION_RULE_DIMENSION,
  DRAFT_VALIDATION_RULE_PHASE,
  DRAFT_VALIDATION_RULE_SEVERITY,
  DRAFT_VALIDATION_DIMENSIONS,
} from '@aiproj/types'
import type { DraftValidationRuleId, ProjectDraft, ProjectDraftMeta } from '@aiproj/types'
import { fixtureDraft } from '#services/ai_draft/fixtures'
import { DraftValidationService } from '#services/ai_draft/validation_service'
import {
  applyGenerationQualityGate,
  StructuralDraftValidationGateway,
} from '#services/ai_draft/validation_gateway'
import { parseTeamRoster, planDraftResources } from '#services/ai_draft/resource_plan'

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/** 零问题基线：product 夹具最干净，仅需把验收条目挂到任务以消除 VE-005。 */
function cleanDraft(): ProjectDraft {
  const draft = clone(fixtureDraft('product'))
  for (const criterion of draft.acceptanceCriteria) criterion.linkedTaskId = draft.tasks[0].id
  return draft
}

function has(ids: Iterable<{ ruleId: string }>, ruleId: DraftValidationRuleId): boolean {
  return [...ids].some((issue) => issue.ruleId === ruleId)
}

function qualityMeta(overrides: Partial<ProjectDraftMeta> = {}): ProjectDraftMeta {
  return {
    schemaVersion: '1.0',
    projectType: 'product',
    structuredStrategy: 'prompt',
    consistency: 'strict',
    fallbackUsed: false,
    provider: 'verified-test',
    model: 'verified-test-model',
    usingRealAdapter: true,
    appliedFixes: [],
    moduleCounts: {
      wbsNodes: 0,
      tasks: 0,
      dependencies: 0,
      acceptanceCriteria: 0,
      resourceHints: 0,
      riskHints: 0,
      milestoneHints: 0,
    },
    confirmability: { status: 'confirmable', reasons: [] },
    ...overrides,
  }
}

test.group('AI 反幻觉 · 规则元数据', () => {
  test('严重级别/维度/阶段/自动修正映射与 22 条规则 ID 对齐不漂移', ({ assert }) => {
    const ids = [...DRAFT_HALLUCINATION_RULE_IDS, ...DRAFT_VALIDATION_ENGINE_RULE_IDS]
    assert.lengthOf(ids, 22)

    for (const id of ids) {
      assert.exists(DRAFT_VALIDATION_RULE_SEVERITY[id])
      assert.exists(DRAFT_VALIDATION_RULE_DIMENSION[id])
      assert.exists(DRAFT_VALIDATION_RULE_PHASE[id])
      assert.isBoolean(DRAFT_VALIDATION_RULE_AUTO_FIXABLE[id])
    }

    // 阶段归属：HL 属 self_checking、VE 属 validating。
    for (const id of DRAFT_HALLUCINATION_RULE_IDS)
      assert.equal(DRAFT_VALIDATION_RULE_PHASE[id], 'self_checking')
    for (const id of DRAFT_VALIDATION_ENGINE_RULE_IDS)
      assert.equal(DRAFT_VALIDATION_RULE_PHASE[id], 'validating')

    // 严重级别锁定 sec09 §9.4.1 / §9.5.1（抽样关键档位）。
    for (const id of ['HL-001', 'HL-002', 'HL-003', 'HL-006', 'HL-007', 'HL-008'] as const) {
      assert.equal(DRAFT_VALIDATION_RULE_SEVERITY[id], 'blocking')
    }
    for (const id of ['VE-001', 'VE-002', 'VE-010'] as const) {
      assert.equal(DRAFT_VALIDATION_RULE_SEVERITY[id], 'blocking')
    }
    assert.equal(DRAFT_VALIDATION_RULE_SEVERITY['HL-005'], 'info')
    assert.equal(DRAFT_VALIDATION_RULE_AUTO_FIXABLE['HL-002'], true)
    assert.includeMembers(
      [...DRAFT_VALIDATION_DIMENSIONS],
      ['factualAccuracy', 'numericPlausibility'],
    )
  })
})

test.group('AI 反幻觉 · 报告组装与网关', () => {
  const service = new DraftValidationService()
  const gateway = new StructuralDraftValidationGateway()

  test('产出确定性报告：分桶、维度得分、canConfirm 一致', ({ assert }) => {
    const report = gateway.validate({ draft: fixtureDraft('software') })

    assert.isAtLeast(report.confidenceScore, 0)
    assert.isAtMost(report.confidenceScore, 100)
    for (const dimension of DRAFT_VALIDATION_DIMENSIONS)
      assert.property(report.dimensionScores, dimension)
    assert.equal(report.canConfirm, report.blocking.length === 0)
    assert.equal(
      report.ruleResults.length,
      report.blocking.length + report.warning.length + report.info.length,
    )
  })

  test('零问题草案得满分 100、低风险、可确认', ({ assert }) => {
    const report = service.validate(cleanDraft(), { phase: 'all' })
    assert.lengthOf(report.blocking, 0)
    assert.lengthOf(report.warning, 0)
    assert.lengthOf(report.info, 0)
    assert.equal(report.confidenceScore, 100)
    assert.equal(report.overallRiskLevel, 'low')
    assert.isTrue(report.canConfirm)
  })

  test('相同输入复现相同得分与维度分', ({ assert }) => {
    const draft = fixtureDraft('event')
    const a = service.validate(draft, { phase: 'all' })
    const b = service.validate(draft, { phase: 'all' })
    assert.equal(a.confidenceScore, b.confidenceScore)
    assert.deepEqual(a.dimensionScores, b.dimensionScores)
  })

  test('任一 blocking 强制风险 ≥ high 且不可确认', ({ assert }) => {
    const draft = cleanDraft()
    draft.tasks[0].durationDays.value = 0.2 // HL-002 blocking
    const report = service.validate(draft, { phase: 'self_checking' })
    assert.isAbove(report.blocking.length, 0)
    assert.include(['high', 'critical'], report.overallRiskLevel)
    assert.isFalse(report.canConfirm)
  })

  test('生成来源门使用 0–100 置信度并阻断 fallback', ({ assert }) => {
    const structural = service.validate(cleanDraft(), { phase: 'all' })
    const fallback = applyGenerationQualityGate(structural, {
      meta: qualityMeta({
        fallbackUsed: true,
        confirmability: { status: 'review_blocked', reasons: ['PROVIDER_NOT_VERIFIED'] },
      }),
    })
    const verified = applyGenerationQualityGate(structural, { meta: qualityMeta() })

    assert.equal(fallback.confidenceScore, 85)
    assert.isFalse(fallback.canConfirm)
    assert.isTrue(fallback.blocking.some((issue) => issue.path === 'meta.provenance.fallbackUsed'))
    assert.equal(verified.confidenceScore, 99)
    assert.isTrue(verified.canConfirm)
  })

  test('阶段产物少于五项、失败或工具超过两项时 fail closed', ({ assert }) => {
    const structural = service.validate(cleanDraft(), { phase: 'all' })
    const report = applyGenerationQualityGate(structural, {
      meta: qualityMeta({
        stages: [
          {
            stage: 'charter_scope',
            status: 'completed',
            contextScope: ['domain'],
            allowedTools: ['one', 'two', 'three'],
            artifactHash: 'hash',
            attemptCount: 1,
            errorCodes: [],
          },
        ],
      }),
    })
    assert.isFalse(report.canConfirm)
    assert.isTrue(report.blocking.some((issue) => issue.path === 'meta.stages'))
  })

  test('阶段产物不完整与工具超限使用独立错误文案（不再共用误导性句子）', ({ assert }) => {
    const structural = service.validate(cleanDraft(), { phase: 'all' })
    const incomplete = applyGenerationQualityGate(structural, {
      meta: qualityMeta({ stages: [] }),
    })
    const overLimit = applyGenerationQualityGate(structural, {
      meta: qualityMeta({
        stages: [
          {
            stage: 'charter_scope',
            status: 'completed',
            contextScope: [],
            allowedTools: ['tool-a', 'tool-b', 'tool-c'],
            artifactHash: 'hash',
            attemptCount: 1,
            errorCodes: [],
          },
        ],
      }),
    })
    assert.isTrue(incomplete.blocking.some((issue) => issue.message.includes('阶段产物不完整')))
    assert.isFalse(incomplete.blocking.some((issue) => issue.message.includes('工具暴露超出上限')))
    assert.isTrue(
      overLimit.blocking.some((issue) => issue.message.includes('阶段工具暴露超出上限')),
    )
  })
})

test.group('AI 反幻觉 · HL 规则命中/未命中', () => {
  const service = new DraftValidationService()
  const hl = (draft: ProjectDraft) =>
    service.validate(draft, { phase: 'self_checking' }).ruleResults

  test('HL-001 工期总量偏差 >20% 命中，一致时不命中', ({ assert }) => {
    const draft = cleanDraft()
    const sum = draft.tasks.reduce((acc, t) => acc + t.durationDays.value, 0)
    draft.ganttPreview.totalDurationDays.value = sum * 3
    assert.isTrue(has(hl(draft), 'HL-001'))
    assert.isFalse(has(hl(cleanDraft()), 'HL-001'))
  })

  test('HL-001 并行任务工期总和远超日历跨度时，只要甘特总工期与排期跨度一致就不命中', ({
    assert,
  }) => {
    // 回归：旧实现把任务工期相加再比甘特总工期，任何有并行的大型项目都被误阻断导入。
    const draft = cleanDraft()
    for (const task of draft.tasks) {
      task.startDate.value = '2026-10-12'
      task.endDate.value = '2026-10-23'
      task.durationDays.value = 10
    }
    // 10 个工作日 / 12 个日历天；工期总和 = 10 × 任务数，远大于跨度。
    draft.ganttPreview.totalDurationDays.value = 10
    assert.isFalse(has(hl(draft), 'HL-001'))
    draft.ganttPreview.totalDurationDays.value = 12
    assert.isFalse(has(hl(draft), 'HL-001'))
    // 与排期跨度偏差 >20% 仍命中。
    draft.ganttPreview.totalDurationDays.value = 30
    assert.isTrue(has(hl(draft), 'HL-001'))
  })

  test('HL-002 工期越界命中且标记 autoFixable，区间内不命中', ({ assert }) => {
    const draft = cleanDraft()
    draft.tasks[0].durationDays.value = 0.2
    const issues = hl(draft)
    const hit = issues.find((i) => i.ruleId === 'HL-002')
    assert.exists(hit)
    assert.equal(hit?.severity, 'blocking')
    assert.equal(hit?.autoFixable, true)
    assert.isFalse(has(hl(cleanDraft()), 'HL-002'))
  })

  test('HL-003 里程碑缺目标日期命中逻辑一致性，齐全不命中', ({ assert }) => {
    const draft = cleanDraft()
    draft.milestoneHints[0].targetDate.value = ''
    assert.isTrue(has(hl(draft), 'HL-003'))
    assert.isFalse(has(hl(cleanDraft()), 'HL-003'))
  })

  test('HL-004 高影响推断字段缺 needsConfirmation 命中，覆盖后不命中', ({ assert }) => {
    const draft = cleanDraft()
    draft.tasks[0].durationDays.marker.source = 'inferred'
    draft.tasks[0].durationDays.marker.needsConfirmation = false
    assert.isTrue(has(hl(draft), 'HL-004'))
    assert.isFalse(has(hl(cleanDraft()), 'HL-004'))
  })

  test('HL-005 工期估算缺依据说明命中（info），有依据不命中', ({ assert }) => {
    const draft = cleanDraft()
    draft.tasks[0].durationDays.marker.reason = ''
    const hit = hl(draft).find((i) => i.ruleId === 'HL-005')
    assert.exists(hit)
    assert.equal(hit?.severity, 'info')
    assert.isFalse(has(hl(cleanDraft()), 'HL-005'))
  })

  test('HL-006 任务落非工作日命中，工作日不命中', ({ assert }) => {
    const draft = cleanDraft()
    draft.tasks[0].startDate.value = '2026-08-01' // 周六
    assert.isTrue(has(hl(draft), 'HL-006'))
    assert.isFalse(has(hl(cleanDraft()), 'HL-006'))
  })

  test('HL-007 依赖成环命中（blocking），DAG 不命中', ({ assert }) => {
    const draft = cleanDraft()
    draft.dependencies.push({
      id: 'd-cycle',
      predecessorId: draft.tasks[draft.tasks.length - 1].id,
      successorId: draft.tasks[0].id,
      type: 'FS',
      lagDays: {
        value: 0,
        marker: { source: 'inferred', reason: 't', confidence: 0.7, needsConfirmation: true },
      },
    })
    const hit = hl(draft).find((i) => i.ruleId === 'HL-007')
    assert.exists(hit)
    assert.equal(hit?.severity, 'blocking')
    assert.isFalse(has(hl(cleanDraft()), 'HL-007'))
  })

  test('HL-008 单日资源负载超容量命中（blocking），容量足不命中', ({ assert }) => {
    const draft = cleanDraft()
    draft.resourceHints = [
      {
        id: 'r-1',
        role: { value: '开发', marker: draft.resourceHints[0].role.marker },
        headcount: { value: 2, marker: draft.resourceHints[0].headcount.marker },
        allocationNote: draft.resourceHints[0].allocationNote,
      },
    ]
    draft.tasks[0].assigneeHint.value = '甲、乙、丙' // 3 人 > 2 容量
    assert.isTrue(has(hl(draft), 'HL-008'))
    assert.isFalse(has(hl(cleanDraft()), 'HL-008'))
  })

  test('HL-009 术语同义混用命中（warning），统一不命中', ({ assert }) => {
    const draft = cleanDraft()
    draft.charter.title.value = 'milestone 里程碑 节点 混用'
    const hit = hl(draft).find((i) => i.ruleId === 'HL-009')
    assert.exists(hit)
    assert.equal(hit?.severity, 'warning')
    assert.isFalse(has(hl(cleanDraft()), 'HL-009'))
  })

  test('HL-010 超 3 个无对应成功标准的交付物命中（warning），受控不命中', ({ assert }) => {
    const draft = cleanDraft()
    draft.acceptanceCriteria = Array.from({ length: 4 }, (_, i) => ({
      id: `extra-${i}`,
      statement: draft.acceptanceCriteria[0].statement,
      linkedTaskId: draft.tasks[0].id,
      linkedSuccessIndex: null,
    }))
    assert.isTrue(has(hl(draft), 'HL-010'))
    assert.isFalse(has(hl(cleanDraft()), 'HL-010'))
  })
})

test.group('AI 反幻觉 · VE 规则命中/未命中', () => {
  const service = new DraftValidationService()
  const ve = (draft: ProjectDraft) => service.validate(draft, { phase: 'validating' }).ruleResults

  test('VE-001 同资源同日冲突命中（blocking），错峰不命中', ({ assert }) => {
    const draft = cleanDraft()
    draft.tasks[0].assigneeHint.value = '甲'
    draft.tasks[1].assigneeHint.value = '甲'
    draft.tasks[0].startDate.value = '2026-08-03'
    draft.tasks[0].endDate.value = '2026-08-03'
    draft.tasks[1].startDate.value = '2026-08-03'
    draft.tasks[1].endDate.value = '2026-08-03'
    assert.isTrue(has(ve(draft), 'VE-001'))
    assert.isFalse(has(ve(cleanDraft()), 'VE-001'))
  })

  test('VE-002 依赖成环命中（blocking），DAG 不命中', ({ assert }) => {
    const draft = cleanDraft()
    draft.dependencies.push({
      id: 'd-cycle',
      predecessorId: draft.tasks[draft.tasks.length - 1].id,
      successorId: draft.tasks[0].id,
      type: 'FS',
      lagDays: {
        value: 0,
        marker: { source: 'inferred', reason: 't', confidence: 0.7, needsConfirmation: true },
      },
    })
    assert.isTrue(has(ve(draft), 'VE-002'))
    assert.isFalse(has(ve(cleanDraft()), 'VE-002'))
  })

  test('VE-003 资源超载命中（warning），容量足不命中', ({ assert }) => {
    const draft = cleanDraft()
    draft.resourceHints = [
      {
        id: 'r-1',
        role: draft.resourceHints[0].role,
        headcount: { value: 2, marker: draft.resourceHints[0].headcount.marker },
        allocationNote: draft.resourceHints[0].allocationNote,
      },
    ]
    draft.tasks[0].assigneeHint.value = '甲、乙、丙'
    const hit = ve(draft).find((i) => i.ruleId === 'VE-003')
    assert.exists(hit)
    assert.equal(hit?.severity, 'warning')
    assert.isFalse(has(ve(cleanDraft()), 'VE-003'))
  })

  test('VE-004 关键任务缺负责人命中（warning），有负责人不命中', ({ assert }) => {
    const draft = cleanDraft()
    draft.tasks[0].assigneeHint.value = ''
    assert.isTrue(has(ve(draft), 'VE-004'))
    assert.isFalse(has(ve(cleanDraft()), 'VE-004'))
  })

  test('VE-005 验收条目无对应任务命中（info），已挂接不命中', ({ assert }) => {
    const draft = cleanDraft()
    draft.acceptanceCriteria[0].linkedTaskId = null
    assert.isTrue(has(ve(draft), 'VE-005'))
    assert.isFalse(has(ve(cleanDraft()), 'VE-005'))
  })

  test('VE-006 结束早于开始命中（warning），顺序正确不命中', ({ assert }) => {
    const draft = cleanDraft()
    draft.tasks[0].startDate.value = '2026-08-05'
    draft.tasks[0].endDate.value = '2026-08-03'
    assert.isTrue(has(ve(draft), 'VE-006'))
    assert.isFalse(has(ve(cleanDraft()), 'VE-006'))
  })

  test('VE-007 里程碑缺目标日期命中（warning），有日期不命中', ({ assert }) => {
    const draft = cleanDraft()
    draft.milestoneHints[0].targetDate.value = ''
    assert.isTrue(has(ve(draft), 'VE-007'))
    assert.isFalse(has(ve(cleanDraft()), 'VE-007'))
  })

  test('VE-008 单项工期越界命中（info），区间内不命中', ({ assert }) => {
    const draft = cleanDraft()
    draft.tasks[0].durationDays.value = 45
    assert.isTrue(has(ve(draft), 'VE-008'))
    assert.isFalse(has(ve(cleanDraft()), 'VE-008'))
  })

  test('VE-009 草案过小无法算关键路径命中（info），规模足不命中', ({ assert }) => {
    const draft = cleanDraft()
    draft.tasks = [draft.tasks[0]]
    draft.dependencies = []
    assert.isTrue(has(ve(draft), 'VE-009'))
    assert.isFalse(has(ve(cleanDraft()), 'VE-009'))
  })

  test('VE-010 必填字段缺失命中（blocking），完整不命中', ({ assert }) => {
    const draft = cleanDraft()
    draft.charter.title.value = ''
    const hit = ve(draft).find((i) => i.ruleId === 'VE-010')
    assert.exists(hit)
    assert.equal(hit?.severity, 'blocking')
    assert.isFalse(has(ve(cleanDraft()), 'VE-010'))
  })

  test('VE-011 WBS 叶节点无对应任务命中（info），全映射不命中', ({ assert }) => {
    const draft = cleanDraft()
    draft.wbs[0].children.push({
      id: 'w-orphan',
      parentId: draft.wbs[0].id,
      outlineCode: '9.9',
      name: draft.wbs[0].name,
      description: draft.wbs[0].description,
      isLeaf: true,
      isNote: false,
      children: [],
    })
    assert.isTrue(has(ve(draft), 'VE-011'))
    assert.isFalse(has(ve(cleanDraft()), 'VE-011'))
  })

  test('VE-012 甘特引用不存在任务命中（info），同步不命中', ({ assert }) => {
    const draft = cleanDraft()
    draft.ganttPreview.criticalPathTaskIds.push('ghost-task')
    assert.isTrue(has(ve(draft), 'VE-012'))
    assert.isFalse(has(ve(cleanDraft()), 'VE-012'))
  })
})

test.group('AI 反幻觉 · 阶段编排', () => {
  const service = new DraftValidationService()

  test('self_checking 只跑 HL，validating 只跑 VE', ({ assert }) => {
    const draft = cleanDraft()
    draft.tasks[0].durationDays.marker.reason = '' // HL-005
    draft.tasks[0].assigneeHint.value = '' // VE-004

    const self = service.validate(draft, { phase: 'self_checking' }).ruleResults
    assert.isTrue(self.every((i) => i.ruleId.startsWith('HL-')))
    assert.isTrue(has(self, 'HL-005'))

    const validating = service.validate(draft, { phase: 'validating' }).ruleResults
    assert.isTrue(validating.every((i) => i.ruleId.startsWith('VE-')))
    assert.isTrue(has(validating, 'VE-004'))
  })

  test('validating 阶段先按 selection 过滤子集再判定', ({ assert }) => {
    const draft = cleanDraft()
    const keep = draft.tasks[0].id
    // 只选第一个任务：其余任务与依赖必须被过滤，VE-011（未选叶）不应因未选任务而误伤已选子集
    const report = service.validate(draft, {
      phase: 'validating',
      selection: {
        taskIds: [keep],
        wbsNodeIds: [draft.tasks[0].wbsNodeId],
        acceptanceIds: [],
        milestoneIds: [],
        riskHintIds: [],
        unselectedStrategy: 'discard',
      },
    })
    // 过滤后依赖两端都在选中任务内才保留；此处只有一个任务，依赖被清空，不应报 VE-002。
    assert.isFalse(has(report.ruleResults, 'VE-002'))
  })
})

test.group('AI 反幻觉 · 自动修正与重检', () => {
  const service = new DraftValidationService()

  test('HL-002/VE-008 工期越界夹到 [0.5,30] 并产出差异，不自动确认', ({ assert }) => {
    const draft = cleanDraft()
    draft.tasks[0].durationDays.value = 45

    const result = service.autoFix(draft, { phase: 'self_checking' })
    assert.isAbove(result.diffs.length, 0)
    const diff = result.diffs.find((d) => d.path === 'tasks[0].durationDays')
    assert.exists(diff)
    assert.equal(diff?.before, 45)
    assert.equal(diff?.after, 30)
    assert.equal(result.draft.tasks[0].durationDays.value, 30)
    assert.isFalse(result.report.canConfirm)
  })

  test('HL-004 自动补 needsConfirmation=true', ({ assert }) => {
    const draft = cleanDraft()
    draft.tasks[0].durationDays.marker.needsConfirmation = false
    const result = service.autoFix(draft, { phase: 'self_checking' })
    const diff = result.diffs.find((d) => d.path.endsWith('needsConfirmation'))
    assert.exists(diff)
    assert.equal(diff?.after, true)
  })

  test('HL-006 非工作日日期回吸到工作日', ({ assert }) => {
    const draft = cleanDraft()
    draft.tasks[0].startDate.value = '2026-08-01' // 周六
    const result = service.autoFix(draft, { phase: 'self_checking' })
    const diff = result.diffs.find((d) => d.path === 'tasks[0].startDate')
    assert.exists(diff)
    assert.equal(diff?.before, '2026-08-01')
    assert.equal(diff?.after, '2026-08-03') // 顺延到周一
  })

  test('自动修正只作用于深拷贝副本，不污染原草案', ({ assert }) => {
    const draft = cleanDraft()
    draft.tasks[0].durationDays.value = 45
    service.autoFix(draft, { phase: 'self_checking' })
    assert.equal(draft.tasks[0].durationDays.value, 45)
  })
})

test.group('AI 反幻觉 · 规则异常隔离', () => {
  test('单条规则抛异常被标记 failed，其余规则仍产出结果', ({ assert }) => {
    const service = new DraftValidationService()
    service.registry.register('HL-006', () => {
      throw new Error('boom')
    })
    const draft = cleanDraft()
    draft.tasks[0].durationDays.value = 0.2 // 保证另有 HL-002 命中

    const report = service.validate(draft, { phase: 'self_checking' })
    const failed = report.ruleResults.find((i) => i.ruleId === 'HL-006')
    assert.exists(failed)
    assert.equal(failed?.failed, true)
    assert.isTrue(has(report.ruleResults, 'HL-002'))
  })
})

test.group('AI 反幻觉 · 资源冲突角色化（VE-001 语义修正）', () => {
  const service = new DraftValidationService()
  const ve = (draft: ProjectDraft) => service.validate(draft, { phase: 'validating' }).ruleResults

  test('同一明确单人负责人同日重叠仍 VE-001 阻断（blocking 不降级）', ({ assert }) => {
    const draft = cleanDraft()
    draft.tasks[0].assigneeHint.value = '产品经理'
    draft.tasks[1].assigneeHint.value = '产品经理'
    draft.tasks[0].startDate.value = '2026-08-03'
    draft.tasks[0].endDate.value = '2026-08-03'
    draft.tasks[1].startDate.value = '2026-08-03'
    draft.tasks[1].endDate.value = '2026-08-03'
    assert.isTrue(has(ve(draft), 'VE-001'))
  })

  test('团队角色组合共享成员不再整串误报 VE-001（拆分角色 ID 判定）', ({ assert }) => {
    const draft = cleanDraft()
    draft.tasks[0].assigneeHint.value = '应用开发团队与运营团队'
    draft.tasks[1].assigneeHint.value = '应用开发团队'
    draft.tasks[0].startDate.value = '2026-08-03'
    draft.tasks[0].endDate.value = '2026-08-03'
    draft.tasks[1].startDate.value = '2026-08-03'
    draft.tasks[1].endDate.value = '2026-08-03'
    assert.isFalse(has(ve(draft), 'VE-001'))
  })

  test('structured assigneeRoleIds 直接作为稳定资源 ID 参与 VE-001', ({ assert }) => {
    const draft = cleanDraft()
    const marker = draft.tasks[0].assigneeHint.marker
    draft.tasks[0].assigneeRoleIds = { value: ['ops'], marker }
    draft.tasks[0].assigneeHint.value = '运营值班'
    draft.tasks[1].assigneeRoleIds = { value: ['ops'], marker }
    draft.tasks[1].assigneeHint.value = '运营负责人（口语化描述）'
    draft.tasks[0].startDate.value = '2026-08-03'
    draft.tasks[0].endDate.value = '2026-08-03'
    draft.tasks[1].startDate.value = '2026-08-03'
    draft.tasks[1].endDate.value = '2026-08-03'
    assert.isTrue(has(ve(draft), 'VE-001'))
  })

  test('角色 ID 经负责人描述匹配到多人资源（backend-dev ↔ 后端开发组 ↔ 后端开发×10）不按单人阻断', ({
    assert,
  }) => {
    const draft = cleanDraft()
    const marker = draft.tasks[0].assigneeHint.marker
    draft.resourceHints = [
      {
        id: 'r-backend',
        role: { value: '后端开发', marker: draft.resourceHints[0].role.marker },
        headcount: { value: 10, marker: draft.resourceHints[0].headcount.marker },
        allocationNote: draft.resourceHints[0].allocationNote,
      },
    ]
    for (const task of draft.tasks.slice(0, 2)) {
      task.assigneeRoleIds = { value: ['backend-dev'], marker }
      task.assigneeHint.value = '后端开发组'
      task.startDate.value = '2026-08-03'
      task.endDate.value = '2026-08-03'
    }
    assert.isFalse(has(ve(draft), 'VE-001'))
  })

  test('负责人描述为空时不误配任何资源容量，单人角色同日重叠仍阻断', ({ assert }) => {
    const draft = cleanDraft()
    const marker = draft.tasks[0].assigneeHint.marker
    for (const task of draft.tasks.slice(0, 2)) {
      task.assigneeRoleIds = { value: ['solo-architect'], marker }
      task.assigneeHint.value = ''
      task.startDate.value = '2026-08-03'
      task.endDate.value = '2026-08-03'
    }
    assert.isTrue(has(ve(draft), 'VE-001'))
  })

  test('团队角色且有容量依据时超载走 VE-003（warning）而非 VE-001', ({ assert }) => {
    const draft = cleanDraft()
    draft.resourceHints = [
      {
        id: 'r-team',
        role: {
          value: '应用开发团队',
          marker: draft.resourceHints[0].role.marker,
        },
        headcount: { value: 1, marker: draft.resourceHints[0].headcount.marker },
        allocationNote: draft.resourceHints[0].allocationNote,
      },
    ]
    draft.tasks[0].assigneeHint.value = '应用开发团队'
    draft.tasks[1].assigneeHint.value = '应用开发团队'
    draft.tasks[0].startDate.value = '2026-08-03'
    draft.tasks[0].endDate.value = '2026-08-03'
    draft.tasks[1].startDate.value = '2026-08-03'
    draft.tasks[1].endDate.value = '2026-08-03'
    assert.isFalse(has(ve(draft), 'VE-001'))
    assert.isTrue(has(ve(draft), 'VE-003'))
  })
})

test.group('AI 反幻觉 · 资源平衡后处理与容量裁决', () => {
  const service = new DraftValidationService()
  const capacityIssues = (draft: ProjectDraft) =>
    service
      .validate(draft)
      .ruleResults.filter((item) => ['HL-008', 'VE-001', 'VE-003'].includes(item.ruleId))

  function sameDay(draft: ProjectDraft, count: number, role: string) {
    for (const task of draft.tasks.slice(0, count)) {
      task.assigneeHint.value = role
      delete task.assigneeRoleIds
      task.startDate.value = '2026-08-03'
      task.endDate.value = '2026-08-05'
    }
    draft.dependencies = []
  }

  test('资源建议有人数的非团体角色按人数裁决（后端开发 ×10 并行 3 项不超载）', ({ assert }) => {
    const draft = cleanDraft()
    sameDay(draft, 3, '后端开发')
    draft.resourceHints = [
      {
        ...clone(draft.resourceHints[0]),
        id: 'res-be',
        role: { ...draft.resourceHints[0].role, value: '后端开发' },
        headcount: { ...draft.resourceHints[0].headcount, value: 10 },
      },
    ]
    assert.deepEqual(capacityIssues(draft), [])
  })

  test('DBA 三项同日：平衡前超载，按名册 DBA 2 人平衡后容量规则全部通过', ({ assert }) => {
    const draft = cleanDraft()
    sameDay(draft, 3, 'DBA')
    draft.resourceHints = [
      {
        ...clone(draft.resourceHints[0]),
        id: 'res-dba',
        role: { ...draft.resourceHints[0].role, value: 'DBA' },
        headcount: { ...draft.resourceHints[0].headcount, value: 1 },
      },
    ]
    assert.isAbove(capacityIssues(draft).length, 0)

    const roster = parseTeamRoster('架构师 2、后端开发 10、DBA 2')
    const plan = planDraftResources(draft as unknown as Record<string, unknown>, roster)
    const planned = {
      ...draft,
      tasks: plan.tasks,
      resourceHints: plan.resourceHints,
      riskHints: plan.riskHints,
      milestoneHints: plan.milestoneHints,
      ganttPreview: plan.ganttPreview,
    } as ProjectDraft
    assert.isTrue(plan.report.shiftedTasks > 0)
    assert.deepEqual(capacityIssues(planned), [])
  })
})
