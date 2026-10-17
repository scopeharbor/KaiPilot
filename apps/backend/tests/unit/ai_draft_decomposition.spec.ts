import { describe, expect, it } from 'vitest'
import type { ProjectDraft, ProjectPlanUnderstanding } from '@aiproj/types'
import {
  buildWbsFromDecomposition,
  ensureStageGateWorkPackages,
} from '#services/ai_draft/work_packages'
import {
  calibrateTaskEffort,
  humanizeTaskReferences,
  pruneChainExtendingDependencies,
} from '#services/ai_draft/quality_loop'
import { planTaskAssignees } from '#services/ai_draft/member_assignment'
import { parseTeamRoster } from '#services/ai_draft/resource_plan'
import {
  parseDeadlineAnswer,
  parseStartDateAnswer,
  rawInputHasDuration,
} from '#services/ai_intent/core_information_needs'

const understanding: ProjectPlanUnderstanding = {
  version: '1.0',
  problemStatement: '员工无法在手机上预订会议室',
  successPicture: '员工可自助预订与签到',
  currentState: '线下登记',
  stakeholders: [],
  businessFlows: [],
  capabilities: [
    {
      id: 'cap-1',
      name: '会议室预订',
      purpose: '在线预订',
      deliverables: ['预订功能'],
      dependsOn: [],
    },
    {
      id: 'cap-2',
      name: '质量保障与测试',
      purpose: '可验收',
      deliverables: ['测试报告'],
      dependsOn: ['cap-1'],
    },
  ],
  constraints: [],
  assumptions: [],
  openQuestions: [],
  confirmedByUser: true,
}

const marked = <T>(value: T) => ({
  value,
  marker: {
    confidence: 0.8,
    source: 'inferred' as const,
    reason: '测试',
    needsConfirmation: false,
  },
})

describe('拆解层：能力 → 工作包 → WBS', () => {
  it('一级为能力、二级为工作包叶节点，且可按叶节点反查工作包', () => {
    const workPackages = [
      {
        id: 'cap-1-wp1',
        capabilityId: 'cap-1',
        name: '预订接口开发',
        deliverable: '预订接口',
        doneDefinition: '接口测试通过',
        dependsOn: [],
        effortDays: 8,
      },
      {
        id: 'cap-2-wp1',
        capabilityId: 'cap-2',
        name: '系统测试',
        deliverable: '测试报告',
        doneDefinition: '缺陷清零',
        dependsOn: ['cap-1'],
        effortDays: 5,
      },
    ]
    const { wbs, nodeOfPackage } = buildWbsFromDecomposition(understanding, workPackages)
    expect(wbs).toHaveLength(2)
    expect(wbs[0]!.isLeaf).toBe(false)
    const children = wbs[0]!.children as Array<Record<string, unknown>>
    expect(children[0]!.isLeaf).toBe(true)
    expect(children[0]!.outlineCode).toBe('1.1')
    expect(nodeOfPackage.get('cap-1-wp1')).toBe(children[0]!.id)
  })

  it('缺失的行业阶段门补到测试类能力下，已有的不重复补', () => {
    const workPackages = [
      {
        id: 'cap-2-wp1',
        capabilityId: 'cap-2',
        name: 'SIT 系统集成测试',
        deliverable: 'SIT 报告',
        doneDefinition: '通过',
        dependsOn: [],
        effortDays: 5,
      },
    ]
    const added = ensureStageGateWorkPackages(understanding, workPackages, ['SIT', 'UAT'])
    expect(added).toEqual(['UAT'])
    expect(workPackages.find((pkg) => pkg.name === 'UAT')?.capabilityId).toBe('cap-2')
  })

  it('补的阶段门接上先后：不再没有前置（此前稳定期被排到开工第一天）', () => {
    const pkg = (id: string, capabilityId: string, name: string) => ({
      id,
      capabilityId,
      name,
      deliverable: name,
      doneDefinition: '通过',
      dependsOn: [] as string[],
      effortDays: 3,
    })
    const pm: ProjectPlanUnderstanding = {
      ...understanding,
      capabilities: [
        ...understanding.capabilities,
        { id: 'cap-3', name: '项目管理与验收协调', purpose: '', deliverables: [], dependsOn: [] },
      ],
    }
    const workPackages = [
      pkg('cap-1-wp1', 'cap-1', '预订接口开发'),
      pkg('cap-1-wp2', 'cap-1', '预订页面开发'),
      pkg('cap-2-wp1', 'cap-2', 'SIT 系统集成测试'),
      pkg('cap-3-wp1', 'cap-3', '项目计划与周报'),
    ]
    ensureStageGateWorkPackages(pm, workPackages, [
      '立项与启动',
      'UAT 用户验收测试',
      '上线后稳定期与运维移交',
    ])
    const deps = (name: string) => workPackages.find((item) => item.name === name)!.dependsOn
    expect(deps('立项与启动')).toEqual([])
    // UAT：接在 SIT 之后，并等全部功能开发；项目管理不算
    expect(deps('UAT 用户验收测试').sort()).toEqual(['cap-1-wp1', 'cap-1-wp2', 'cap-2-wp1'])
    // 稳定期：接在 UAT 之后
    const uat = workPackages.find((item) => item.name === 'UAT 用户验收测试')!.id
    expect(deps('上线后稳定期与运维移交')).toContain(uat)
    expect(deps('上线后稳定期与运维移交')).not.toContain('cap-3-wp1')
  })
})

describe('质量闭环的确定性部件', () => {
  const task = (id: string, name: string, days: number) => ({
    id,
    wbsNodeId: 'wbs-1-1',
    name: marked(name),
    description: marked('完成后交给 task-2 使用'),
    durationDays: marked(days),
  })

  it('文本里的任务编号换成任务名，id 字段保持不变', () => {
    const aggregate: Record<string, unknown> = {
      tasks: [task('task-1', '需求评审', 2), task('task-2', '接口开发', 5)],
      acceptanceCriteria: [
        { id: 'ac-1', statement: marked('task-1/2 完成'), linkedTaskId: 'task-1' },
      ],
    }
    expect(humanizeTaskReferences(aggregate)).toBeGreaterThan(0)
    const tasks = aggregate.tasks as Array<{ id: string; description: { value: string } }>
    expect(tasks[0]!.id).toBe('task-1')
    expect(tasks[0]!.description.value).toBe('完成后交给 「接口开发」 使用')
    const criteria = aggregate.acceptanceCriteria as Array<{
      statement: { value: string }
      linkedTaskId: string
    }>
    expect(criteria[0]!.statement.value).toBe('「需求评审」、「接口开发」 完成')
    expect(criteria[0]!.linkedTaskId).toBe('task-1')
  })

  it('任务工期按工作包预算按比例校准，最多缩到原合计的 60%', () => {
    const aggregate: Record<string, unknown> = {
      tasks: [task('task-1', 'A', 6), task('task-2', 'B', 4), task('task-3', 'C', 10)],
    }
    ;(aggregate.tasks as Array<{ wbsNodeId: string }>)[2]!.wbsNodeId = 'wbs-2-1'
    const result = calibrateTaskEffort(
      aggregate,
      new Map([
        ['wbs-1-1', 5],
        ['wbs-2-1', 10],
      ]),
    )
    // wbs-1-1：合计 10 > 5×1.15，目标 max(5, 6) = 6 → 按 0.6 缩放
    expect(result.packages).toBe(1)
    const tasks = aggregate.tasks as Array<{ durationDays: { value: number } }>
    expect(tasks.map((item) => item.durationDays.value)).toEqual([4, 2, 10])
  })

  it('关键路径守卫只剪修复新增的依赖（dep-q），不动模型原有依赖', () => {
    const aggregate: Record<string, unknown> = {
      tasks: [task('task-1', 'A', 5), task('task-2', 'B', 5), task('task-3', 'C', 5)],
      dependencies: [
        {
          id: 'dep-1',
          predecessorId: 'task-1',
          successorId: 'task-2',
          type: 'FS',
          lagDays: marked(0),
        },
        {
          id: 'dep-q1',
          predecessorId: 'task-2',
          successorId: 'task-3',
          type: 'FS',
          lagDays: marked(0),
        },
      ],
    }
    expect(pruneChainExtendingDependencies(aggregate, 10)).toBe(1)
    const deps = aggregate.dependencies as Array<{ id: string }>
    expect(deps.map((dep) => dep.id)).toEqual(['dep-1'])
  })
})

describe('成员与名册', () => {
  it('「另外后端 2 人」去掉连接词；「成员#16 负责架构」记为架构师 1 人', () => {
    const roster = parseTeamRoster('成员#16 负责架构，另外后端 2 人、前端 1 人', 1)
    expect(roster).toEqual(
      expect.arrayContaining([
        { role: '架构师', headcount: 1 },
        { role: '后端', headcount: 2 },
        { role: '前端', headcount: 1 },
      ]),
    )
  })

  it('「3 个分论坛」不是团队角色', () => {
    expect(parseTeamRoster('主论坛、3 个分论坛和晚宴、市场部 4 人', 1)).toEqual([
      { role: '市场部', headcount: 4 },
    ])
  })

  it('按角色负载均衡指派，成员代号直接指派，非本组织成员忽略', () => {
    const draft = {
      tasks: [
        { id: 't1', assigneeHint: { value: '后端' }, durationDays: { value: 5 } },
        { id: 't2', assigneeHint: { value: '后端' }, durationDays: { value: 5 } },
        { id: 't3', assigneeHint: { value: '成员#16' }, durationDays: { value: 3 } },
        { id: 't4', assigneeHint: { value: '成员#99' }, durationDays: { value: 3 } },
      ],
    } as unknown as ProjectDraft
    const plan = planTaskAssignees(
      draft,
      [{ role: '后端开发', userIds: [2, 3] }],
      new Set([2, 3, 16]),
    )
    expect(new Set([plan.get('t1'), plan.get('t2')])).toEqual(new Set([2, 3]))
    expect(plan.get('t3')).toBe(16)
    expect(plan.has('t4')).toBe(false)
  })
})

describe('核心问题的回答解析', () => {
  const now = new Date('2026-09-27T02:00:00Z')

  it('日期容许空格', () => {
    expect(parseStartDateAnswer('10 月 12 日', now)).toBe('2026-10-12')
  })

  it('工期题回答日期时作为截止日', () => {
    expect(parseDeadlineAnswer('到 11 月 27 日', now)).toBe('2026-11-27')
    expect(parseDeadlineAnswer('3 个月', now)).toBeNull()
  })

  it('「11 月下旬举办」是日期不是工期', () => {
    expect(rawInputHasDuration('希望在 11 月下旬举办')).toBe(false)
    expect(rawInputHasDuration('周期约 6 个月')).toBe(true)
    expect(rawInputHasDuration('2027 年 4 月中旬完成生产切换')).toBe(true)
  })
})
