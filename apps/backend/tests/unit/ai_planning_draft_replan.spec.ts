import { describe, expect, it } from 'vitest'
import {
  assessDraft,
  deferCapabilities,
  draftCapabilities,
  replanDraft,
  rewriteCharterDate,
} from '#services/ai_planning/draft_replan_service'

const m = <T>(value: T) => ({
  value,
  marker: { confidence: 1, source: 'explicit', reason: '', needsConfirmation: false },
})

function task(id: string, cap: [string, string], days: number, role: string, start: string) {
  return {
    id,
    wbsNodeId: `w-${cap[0]}`,
    name: m(`${cap[1]}：${id}`),
    description: m(''),
    status: 'todo',
    durationDays: m(days),
    startDate: m(start),
    endDate: m(start),
    assigneeHint: m(role),
    assigneeRoleIds: m([role]),
    trace: {
      capabilityId: cap[0],
      capabilityName: cap[1],
      workPackageId: `${cap[0]}-wp`,
      workPackageName: '',
    },
  }
}

const REG: [string, string] = ['cap-1', '报名']
const SHOP: [string, string] = ['cap-2', '兑换商城']
const QA: [string, string] = ['cap-3', '测试与上线']
const PM: [string, string] = ['cap-4', '项目管理与验收']

/** 2 个后端：报名 10 天 → 商城 10 天（都占后端，互相依赖串行）→ 测试 5 天；项目管理贯穿全程。 */
function draft() {
  return {
    charter: {
      title: m('志愿者小程序'),
      scope: m('报名与积分兑换'),
      startDate: m('2026-11-02'),
      endDate: m('2026-11-20'),
    },
    wbs: [
      { id: 'w-cap-1', parentId: null, isLeaf: true, isNote: false, children: [] },
      { id: 'w-cap-2', parentId: null, isLeaf: true, isNote: false, children: [] },
      { id: 'w-cap-3', parentId: null, isLeaf: true, isNote: false, children: [] },
      { id: 'w-cap-4', parentId: null, isLeaf: true, isNote: false, children: [] },
    ],
    tasks: [
      task('t1', REG, 10, '后端', '2026-11-02'),
      task('t2', SHOP, 10, '后端', '2026-11-16'),
      task('t3', QA, 5, '测试', '2026-11-30'),
      { ...task('t4', PM, 25, '项目经理', '2026-11-02'), name: m('项目管理与周例会') },
    ],
    dependencies: [
      { id: 'd1', predecessorId: 't1', successorId: 't2', type: 'FS', lagDays: m(0) },
      { id: 'd2', predecessorId: 't2', successorId: 't3', type: 'FS', lagDays: m(0) },
    ],
    acceptanceCriteria: [
      { id: 'a1', statement: m('能兑换'), linkedTaskId: 't2', linkedSuccessIndex: null },
    ],
    resourceHints: [
      { id: 'r1', role: m('后端'), headcount: m(1), allocationNote: m('') },
      { id: 'r2', role: m('测试'), headcount: m(1), allocationNote: m('') },
      { id: 'r3', role: m('项目经理'), headcount: m(1), allocationNote: m('') },
    ],
    riskHints: [],
    milestoneHints: [
      { id: 'm1', name: m('商城上线'), targetDate: m('2026-11-27'), linkedTaskIds: ['t2'] },
    ],
    ganttPreview: {},
  } as Record<string, unknown>
}

describe('审查页协商调整', () => {
  it('现状：超期，给出推迟 / 放第二期；贯穿性工作不能放第二期', () => {
    const assessment = assessDraft(draft())
    expect(assessment.verdict).toBe('over')
    const kinds = assessment.options.map((option) => option.kind)
    expect(kinds).toContain('extend')
    expect(kinds).toContain('defer')
    const defer = assessment.options.find((option) => option.kind === 'defer')!
    expect(defer.decision.deferredCapabilityIds).toEqual(['cap-2'])
    const qa = assessment.estimates.find((estimate) => estimate.capabilityId === 'cap-3')!
    expect(qa.deferrable).toBe(false)
    expect(assessment.options.filter((option) => option.recommended)).toHaveLength(1)
  })

  it('只晚几天：建议推迟截止日，而不是把整块功能放第二期', () => {
    const late = draft()
    late.charter = { ...(late.charter as object), endDate: m('2026-12-02') }
    const assessment = assessDraft(late)
    expect(assessment.verdict).toBe('over')
    const recommended = assessment.options.filter((option) => option.recommended)
    expect(recommended.map((option) => option.kind)).toEqual(['extend'])
  })

  it('只改截止日：任务不动，超期归零', () => {
    const { draft: next, preview } = replanDraft(draft(), {
      kind: 'extend',
      summary: 'x',
      deadline: '2026-12-04',
    })
    expect(preview.movedTasks).toEqual([])
    expect(preview.after.exceededWorkdays).toBe(0)
    expect((next.charter as { endDate: { value: string } }).endDate.value).toBe('2026-12-04')
  })

  it('放第二期：删任务、接上断开的依赖、清掉挂在它上面的验收与里程碑，完工日提前', () => {
    const { draft: next, preview } = replanDraft(draft(), {
      kind: 'defer',
      summary: 'x',
      deferredCapabilityIds: ['cap-2'],
    })
    const ids = (next.tasks as Array<{ id: string }>).map((t) => t.id)
    expect(ids).not.toContain('t2')
    const deps = next.dependencies as Array<{ predecessorId: string; successorId: string }>
    expect(deps.some((d) => d.predecessorId === 't1' && d.successorId === 't3')).toBe(true)
    expect(next.acceptanceCriteria).toEqual([])
    expect(next.milestoneHints).toEqual([])
    expect((next.wbs as Array<{ id: string }>).map((n) => n.id)).not.toContain('w-cap-2')
    expect(String((next.charter as { scope: { value: string } }).scope.value)).toContain(
      '第二期再做',
    )
    expect(preview.removedTasks).toBe(1)
    expect(preview.after.plannedEndDate! < preview.before.plannedEndDate!).toBe(true)
  })

  it('持续性任务在压缩重排后拉伸到实际工作的最后一天，不撑住完工日', () => {
    const { draft: next, preview } = replanDraft(draft(), {
      kind: 'defer',
      summary: 'x',
      deferredCapabilityIds: ['cap-2'],
    })
    const pm = (next.tasks as Array<{ id: string; endDate: { value: string } }>).find(
      (t) => t.id === 't4',
    )!
    expect(pm.endDate.value).toBe(preview.after.plannedEndDate)
  })

  it('按能力汇总工作量与依赖', () => {
    const { effort, dependsOn } = draftCapabilities(draft())
    expect(effort.get('cap-1')!.personDays).toBe(10)
    expect(effort.has('cap-4')).toBe(false) // 持续性任务不计
    expect(dependsOn.get('cap-2')).toEqual(['cap-1'])
  })

  it('没有任务属于要移的能力时原样返回', () => {
    const original = draft()
    expect(deferCapabilities(original, new Set(['cap-99'])).draft).toBe(original)
  })
})

describe('审查页协商调整：如实说明', () => {
  it('瓶颈在依赖链上时加人不会提前，预览里说清楚', () => {
    const { preview } = replanDraft(draft(), {
      kind: 'add_people',
      summary: 'x',
      team: [
        { role: '后端', headcount: 3 },
        { role: '测试', headcount: 1 },
        { role: '项目经理', headcount: 1 },
      ],
    })
    // 报名 → 商城 → 测试是串行依赖，多一个后端也不能并行
    expect(preview.after.plannedEndDate).toBe(preview.before.plannedEndDate)
    expect(preview.note).toContain('瓶颈在任务依赖链上')
  })

  it('很紧（完工日正好压着截止日）：给出延后留缓冲的方案', () => {
    const base = draft()
    const planned = replanDraft(base, { kind: 'custom', summary: 'x' }).preview.before
      .plannedEndDate!
    const tight = { ...base, charter: { ...(base.charter as object), endDate: m(planned) } }
    const assessment = assessDraft(tight)
    expect(assessment.verdict).toBe('tight')
    const extend = assessment.options.find((option) => option.kind === 'extend')!
    expect(extend.decision.deadline! > planned).toBe(true)
    expect(extend.label).toContain('留出缓冲')
  })
})

describe('审查页协商调整：章程文字跟着截止日改', () => {
  it('把章程文字里的旧截止日换成新日期，两种写法都换，其它日期不动', () => {
    const charter = {
      objectives: m(['在 2026-10-12 至 2026-11-16 工期内上线', '11月16日前完成验收']),
      vision: m('2026 年 11 月 16 日上线，10 月 16 日联调'),
      startDate: m('2026-10-12'),
      endDate: m('2026-11-16'),
    }
    const result = rewriteCharterDate(charter, '2026-11-16', '2026-11-19')
    expect((result.objectives as { value: string[] }).value).toEqual([
      '在 2026-10-12 至 2026-11-19 工期内上线',
      '11月19日前完成验收',
    ])
    expect((result.vision as { value: string }).value).toBe(
      '2026 年 11 月 19 日上线，10 月 16 日联调',
    )
    expect((result.startDate as { value: string }).value).toBe('2026-10-12')
  })
})
