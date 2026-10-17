import { describe, expect, it } from 'vitest'
import {
  canonicalRole,
  parseTeamRoster,
  planDraftResources,
  type TeamRosterEntry,
} from '#services/ai_draft/resource_plan'

const REAL_INPUT =
  '某城商行计划于 2026 年 10 月 12 日启动「支付清算中台」微服务化重构项目，周期约 6 个月。' +
  '团队约 25 人：架构师 2、后端开发 10、前端 2、测试 5、DBA 2、安全 2、运维 2，预算 800 万元以内。' +
  '关键交易链路 TPS ≥ 3000、可用性 99.99%。'

const ROSTER: TeamRosterEntry[] = parseTeamRoster(REAL_INPUT)

const marker = { confidence: 0.8, source: 'inferred', reason: '按排期', needsConfirmation: true }
const field = <T>(value: T) => ({ value, marker: { ...marker } })

function task(id: string, role: string, start: string, end: string, days: number) {
  return {
    id,
    wbsNodeId: 'wbs-1',
    name: field(`任务 ${id}`),
    description: field(`任务 ${id} 的交付物与完成标准`),
    status: 'todo',
    durationDays: field(days),
    startDate: field(start),
    endDate: field(end),
    assigneeHint: field(role),
  }
}

function dep(from: string, to: string) {
  return {
    id: `dep-${from}-${to}`,
    predecessorId: from,
    successorId: to,
    type: 'FS',
    lagDays: field(0),
  }
}

function hint(role: string, headcount: number) {
  return {
    id: `res-${role}`,
    role: field(role),
    headcount: field(headcount),
    allocationNote: field('全程投入'),
  }
}

/** 同一周里 3 个 DBA 任务 + 1 个依赖其一的后续任务；模型把 DBA 写成 1 人。 */
function overloadedDraft(
  endDate = '2027-04-15',
  base: Record<string, unknown> = { charter: {}, wbs: [], riskHints: [] },
): Record<string, unknown> {
  const charter = structuredClone(base.charter) as Record<string, unknown>
  charter.startDate = field('2026-10-12')
  charter.endDate = field(endDate)
  const baseTasks = base.tasks as Array<{ wbsNodeId: string }> | undefined
  const wbsNodeId = baseTasks?.[0]?.wbsNodeId ?? 'wbs-1'
  const tasks = [
    task('task-1', 'DBA', '2026-10-12', '2026-10-16', 5),
    task('task-2', 'DBA组', '2026-10-12', '2026-10-16', 5),
    task('task-3', '数据库管理员', '2026-10-12', '2026-10-16', 5),
    task('task-4', '后端开发组', '2026-10-19', '2026-10-23', 5),
    task('task-5', 'pm', '2026-10-12', '2026-10-16', 5),
    task('task-6', '项目管理组', '2026-10-12', '2026-10-16', 5),
  ].map((item) => ({ ...item, wbsNodeId }))
  return {
    ...base,
    charter,
    tasks,
    dependencies: [dep('task-3', 'task-4')],
    resourceHints: [hint('DBA', 1), hint('后端开发', 10), hint('Java后端', 4)],
    milestoneHints: [
      {
        id: 'ms-1',
        name: field('数据库就绪'),
        targetDate: field('2026-10-16'),
        linkedTaskIds: ['task-3'],
      },
    ],
  }
}

function dailyLoad(tasks: unknown[], role: string): number {
  const load = new Map<string, number>()
  for (const item of tasks as Array<{
    assigneeRoleIds?: { value: string[] }
    startDate: { value: string }
    endDate: { value: string }
  }>) {
    if (!item.assigneeRoleIds?.value.includes(role)) continue
    for (
      let day = Date.parse(`${item.startDate.value}T00:00:00Z`);
      day <= Date.parse(`${item.endDate.value}T00:00:00Z`);
      day += 86_400_000
    ) {
      load.set(String(day), (load.get(String(day)) ?? 0) + 1)
    }
  }
  return Math.max(0, ...load.values())
}

describe('parseTeamRoster', () => {
  it('从真实输入解析 7 个角色与人数，不把总人数、预算、指标当成角色', () => {
    expect(ROSTER).toEqual([
      { role: '架构师', headcount: 2 },
      { role: '后端开发', headcount: 10 },
      { role: '前端', headcount: 2 },
      { role: '测试', headcount: 5 },
      { role: 'DBA', headcount: 2 },
      { role: '安全', headcount: 2 },
      { role: '运维', headcount: 2 },
    ])
  })

  it('支持「3 名测试」「项目经理 1 人」写法；只有一个疑似角色时不视为名册', () => {
    expect(parseTeamRoster('项目经理 1 人，3 名测试')).toEqual([
      { role: '项目经理', headcount: 1 },
      { role: '测试', headcount: 3 },
    ])
    expect(parseTeamRoster('预算 800 万，团队约 25 人')).toEqual([])
  })
})

describe('canonicalRole', () => {
  it('id、英文、带「组」后缀的写法归并到名册角色；名册外按角色族归并', () => {
    expect(canonicalRole('backend-dev', ROSTER)).toBe('后端开发')
    expect(canonicalRole('后端开发组', ROSTER)).toBe('后端开发')
    expect(canonicalRole('DBA组', ROSTER)).toBe('DBA')
    expect(canonicalRole('数据库管理员', ROSTER)).toBe('DBA')
    expect(canonicalRole('qa', ROSTER)).toBe('测试')
    expect(canonicalRole('前端开发', ROSTER)).toBe('前端')
    expect(canonicalRole('pm', ROSTER)).toBe('项目经理')
    expect(canonicalRole('项目管理组', ROSTER)).toBe('项目经理')
    expect(canonicalRole('业务部门', ROSTER)).toBe('业务部门')
  })
})

describe('planDraftResources', () => {
  it('资源建议对齐名册人数、合并同角色重复建议、补齐名册缺失角色', () => {
    const plan = planDraftResources(overloadedDraft(), ROSTER)
    const hints = plan.resourceHints as Array<{
      role: { value: string }
      headcount: { value: number; marker: { source: string } }
    }>
    const byRole = new Map(hints.map((item) => [item.role.value, item]))
    expect(byRole.get('DBA')?.headcount.value).toBe(2)
    expect(byRole.get('DBA')?.headcount.marker.source).toBe('explicit')
    expect(byRole.get('后端开发')?.headcount.value).toBe(10)
    expect(hints.filter((item) => item.role.value === '后端开发')).toHaveLength(1)
    for (const entry of ROSTER) expect(byRole.has(entry.role)).toBe(true)
  })

  it('名册外的项目经理按 1 人并标记待确认，两个项目管理任务被错开', () => {
    const plan = planDraftResources(overloadedDraft(), ROSTER)
    const pm = (
      plan.resourceHints as Array<{
        role: { value: string }
        headcount: { value: number; marker: { needsConfirmation: boolean } }
      }>
    ).find((item) => item.role.value === '项目经理')
    expect(pm?.headcount.value).toBe(1)
    expect(pm?.headcount.marker.needsConfirmation).toBe(true)
    expect(dailyLoad(plan.tasks, '项目经理')).toBe(1)
  })

  it('DBA 同日并发压到 2 人以内，后续任务仍满足依赖，里程碑随关联任务顺延', () => {
    const plan = planDraftResources(overloadedDraft(), ROSTER)
    expect(plan.report.leveled).toBe(true)
    expect(plan.report.shiftedTasks).toBeGreaterThan(0)
    expect(dailyLoad(plan.tasks, 'DBA')).toBeLessThanOrEqual(2)

    const byId = new Map(
      (
        plan.tasks as Array<{
          id: string
          startDate: { value: string }
          endDate: { value: string }
        }>
      ).map((item) => [item.id, item]),
    )
    expect(byId.get('task-4')!.startDate.value > byId.get('task-3')!.endDate.value).toBe(true)
    const shifted = [...byId.values()].find(
      (item) => item.startDate.value !== '2026-10-12' && item.id !== 'task-4',
    )
    expect(shifted).toBeDefined()

    const milestone = (plan.milestoneHints as Array<{ targetDate: { value: string } }>)[0]
    expect(milestone.targetDate.value >= byId.get('task-3')!.endDate.value).toBe(true)
  })

  it('平衡后晚于截止日时不掩盖：写入高风险并给出补员建议', () => {
    const plan = planDraftResources(overloadedDraft('2026-10-16'), ROSTER)
    expect(plan.report.deadlineExceededWorkdays).toBeGreaterThan(0)
    const risk = (
      plan.riskHints as Array<{
        id: string
        level: { value: string }
        mitigation: { value: string }
      }>
    ).find((item) => item.id === 'risk-resource-leveling')
    expect(risk?.level.value).toBe('high')
    expect(risk?.mitigation.value).toContain('DBA增加 1 人')
  })

  it('依赖有环时不平衡、不改日期', () => {
    const draft = overloadedDraft()
    draft.dependencies = [dep('task-3', 'task-4'), dep('task-4', 'task-3')]
    const plan = planDraftResources(draft, ROSTER)
    expect(plan.report.skippedReason).toBe('dependency_cycle')
    expect(plan.report.shiftedTasks).toBe(0)
  })

  it('无名册时仍按模型资源建议平衡，不虚构人数', () => {
    const plan = planDraftResources(overloadedDraft(), [])
    const dba = (
      plan.resourceHints as Array<{ role: { value: string }; headcount: { value: number } }>
    ).find((item) => item.role.value === 'DBA')
    expect(dba?.headcount.value).toBe(1)
    expect(dailyLoad(plan.tasks, 'DBA')).toBe(1)
  })

  it('多人协作任务按投入人数占用角色容量：2 人任务占满 DBA 名额后不与其它 DBA 任务重叠', () => {
    const draft = overloadedDraft()
    ;(draft.tasks as Array<Record<string, unknown>>)[0].headcount = 2
    const plan = planDraftResources(draft, ROSTER)
    const byId = new Map(
      (
        plan.tasks as Array<{
          id: string
          startDate: { value: string }
          endDate: { value: string }
        }>
      ).map((item) => [item.id, item]),
    )
    const first = byId.get('task-1')!
    // task-1 投入 2 人 = DBA 全部名额：任何 1 人的 DBA 任务都不能与它同期（2+1 > 2）
    for (const id of ['task-2', 'task-3']) {
      const other = byId.get(id)!
      const noOverlap =
        other.startDate.value > first.endDate.value || first.startDate.value > other.endDate.value
      expect(noOverlap).toBe(true)
    }
  })

  it('投入人数超过角色现有人数时按满员占用，任务仍能正常排期', () => {
    const draft = overloadedDraft()
    // task-4 后端开发投入 15 人 > 名册 10 人：按 10 人满员占用，不被推到地平线外
    ;(draft.tasks as Array<Record<string, unknown>>)[3].headcount = 15
    const plan = planDraftResources(draft, ROSTER)
    const t4 = (plan.tasks as Array<{ id: string; startDate: { value: string } }>).find(
      (item) => item.id === 'task-4',
    )!
    expect(t4.startDate.value).toBe('2026-10-19')
  })
})
