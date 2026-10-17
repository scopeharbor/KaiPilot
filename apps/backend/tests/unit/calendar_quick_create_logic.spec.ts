import { describe, expect, it } from 'vitest'
import { createWorkingCalendar } from '#services/gantt_working_calendar'
import {
  normalizeQuickCreate,
  quickCreateConflicts,
  ruleQuickCreate,
  splitQuickCreateText,
  suggestQuickCreateWithAi,
  type QuickCreateContext,
} from '#services/calendar/calendar_quick_create_logic'

function context(overrides: Partial<QuickCreateContext> = {}): QuickCreateContext {
  return {
    today: '2026-10-09',
    projectName: '食堂订餐',
    projectStart: '2026-10-01',
    projectEnd: '2026-12-31',
    window: { startDate: '2026-10-12', endDate: null },
    calendar: createWorkingCalendar({ workdays: [1, 2, 3, 4, 5], holidays: [], extraWorkdays: [] }),
    members: [
      { id: 1, name: '王经理', role: 'project_manager', activeTasks: 4 },
      { id: 2, name: '李开发', role: '后端', activeTasks: 1 },
    ],
    workPackages: [
      { id: 9, code: '1', name: '食堂订餐', taskCount: 0, hasChildren: true },
      { id: 10, code: '1.1', name: '订单导出', taskCount: 2, hasChildren: false },
      { id: 11, code: '1.2', name: '数据迁移', taskCount: 0, hasChildren: false },
    ],
    milestones: [{ id: 5, name: '内测上线', plannedDate: '2026-10-20' }],
    existingTaskNames: ['评审需求'],
    currentUserId: 1,
    ...overrides,
  }
}

describe('日历快速新建：一句话拆多条', () => {
  it('按换行 / 分号 / 「然后」切开，去掉编号', () => {
    expect(splitQuickCreateText('1. 整理需求；2、写接口，然后联调\n上线')).toEqual([
      '整理需求',
      '写接口',
      '联调',
      '上线',
    ])
  })
})

describe('日历快速新建：模型输出规整', () => {
  it('只认给定的成员与工作包；日期不早于选中日、按工作日接排；用户原话没改的名字不标 AI', () => {
    const result = normalizeQuickCreate(
      {
        tasks: [
          {
            name: '整理导出需求',
            startDate: '2026-10-01',
            durationDays: 2,
            assigneeId: 2,
            assigneeReason: '后端、手上任务少',
            wbsNodeId: 10,
            priority: 'high',
          },
          {
            name: '开发订单导出接口并自测',
            durationDays: 3,
            assigneeId: 99,
            wbsNodeId: 77,
            priority: 'urgent',
          },
        ],
        note: '拆成两条',
      },
      context(),
      '整理导出需求；开发导出接口',
    )!
    const [a, b] = result.tasks
    expect(result.source).toBe('ai')
    expect(a).toMatchObject({
      startDate: '2026-10-12',
      endDate: '2026-10-13',
      assigneeName: '李开发',
      assigneeReason: '后端、手上任务少',
      wbsNodeName: '1.1 订单导出',
      priority: 'high',
    })
    expect(a!.aiFields).not.toContain('name')
    // 第二条：从前一条结束后的工作日开始；编造的成员 / 工作包被丢掉，负责人退回负载最轻的
    expect(b).toMatchObject({
      startDate: '2026-10-14',
      endDate: '2026-10-16',
      assigneeId: 2,
      wbsNodeId: null,
      priority: 'medium',
    })
    expect(b!.aiFields).toContain('name')
    expect(b!.assigneeReason).toMatch(/任务最少/)
  })

  it('拖曳了范围且只有一条：起止用用户的，不标 dates', () => {
    const result = normalizeQuickCreate(
      { tasks: [{ name: '写回归测试', startDate: '2026-11-01', durationDays: 5, assigneeId: 2 }] },
      context({ window: { startDate: '2026-10-14', endDate: '2026-10-12' } }),
      '写回归测试',
    )!
    expect(result.tasks[0]).toMatchObject({
      startDate: '2026-10-12',
      endDate: '2026-10-14',
      durationDays: 3,
    })
    expect(result.tasks[0]!.aiFields).not.toContain('dates')
  })

  it('模型没给任务：返回 null（交给规则兜底）', () => {
    expect(normalizeQuickCreate({ tasks: [] }, context(), '')).toBeNull()
  })

  it('经假模型走完整调用', async () => {
    const gateway = {
      generate: async () => ({
        rawText: JSON.stringify({
          tasks: [
            { name: '启动数据迁移：盘点旧表', durationDays: 1, assigneeId: 2, wbsNodeId: 11 },
          ],
          note: '数据迁移还没有任务',
        }),
        triggeredErrors: [],
      }),
    }
    const result = await suggestQuickCreateWithAi({
      gateway,
      context: context(),
      text: '',
      now: new Date('2026-10-09T08:00:00Z'),
    })
    expect(result?.tasks[0]).toMatchObject({ name: '启动数据迁移：盘点旧表', wbsNodeId: 11 })
    expect(result?.note).toBe('数据迁移还没有任务')
  })
})

describe('日历快速新建：冲突与规则兜底', () => {
  it('冲突由程序计算', () => {
    const codes = quickCreateConflicts(
      { name: '评审需求', startDate: '2026-10-17', endDate: '2026-10-21', assigneeId: 1 },
      context(),
    ).map((item) => item.code)
    expect(codes).toEqual(['overload', 'non_working', 'after_milestone', 'duplicate'])
    expect(
      quickCreateConflicts(
        { name: '新事', startDate: '2026-12-30', endDate: '2027-01-05', assigneeId: 2 },
        context(),
      ).map((item) => item.code),
    ).toEqual(['outside_project'])
  })

  it('空输入的规则建议：WBS 缺口 + 临近里程碑', () => {
    const names = ruleQuickCreate(context(), '').tasks.map((task) => task.name)
    expect(names).toEqual(['启动数据迁移：拆出第一批任务', '内测上线前的验收检查'])
  })
})

describe('日历快速新建：避开个人休假（第 3 批）', () => {
  const onLeave = () =>
    context({
      members: [
        { id: 1, name: '王经理', role: 'project_manager', activeTasks: 4 },
        {
          id: 2,
          name: '李开发',
          role: '后端',
          activeTasks: 0,
          offDays: ['2026-10-12', '2026-10-13'],
        },
      ],
    })

  it('规则：负载最轻的人这几天休假 → 选这几天上班的人', () => {
    const [task] = ruleQuickCreate(onLeave(), '写接口').tasks
    expect(task!.assigneeId).toBe(1)
    expect(task!.conflicts.map((item) => item.code)).toContain('overload')
  })

  it('模型选了休假的人 → 改派给上班的人并说明', () => {
    const result = normalizeQuickCreate(
      { tasks: [{ name: '写接口', durationDays: 1, assigneeId: 2, assigneeReason: '后端' }] },
      onLeave(),
      '写接口',
    )!
    expect(result.tasks[0]).toMatchObject({
      assigneeId: 1,
      assigneeReason: '李开发 这几天休假，改派给 王经理',
    })
  })

  it('冲突：负责人这几天休假', () => {
    const conflicts = quickCreateConflicts(
      { name: '新事', startDate: '2026-10-12', endDate: '2026-10-14', assigneeId: 2 },
      onLeave(),
    )
    expect(conflicts).toContainEqual({
      code: 'assignee_off',
      message: '李开发 10/12、10/13 休假或不上班',
    })
  })
})

describe('日历快速新建：没输入时是几个备选', () => {
  it('备选都从选中的日期开始，不接排；用户拖选了范围时都用这个范围', () => {
    const raw = {
      tasks: [
        { name: '启动数据迁移：盘点旧表', durationDays: 2, assigneeId: 2 },
        { name: '内测上线前的验收检查', durationDays: 1, assigneeId: 1 },
      ],
    }
    const single = normalizeQuickCreate(raw, context(), '')!
    expect(single.tasks.map((task) => task.startDate)).toEqual(['2026-10-12', '2026-10-12'])
    const ranged = normalizeQuickCreate(
      raw,
      context({ window: { startDate: '2026-10-12', endDate: '2026-10-14' } }),
      '',
    )!
    expect(ranged.tasks.map((task) => [task.startDate, task.endDate])).toEqual([
      ['2026-10-12', '2026-10-14'],
      ['2026-10-12', '2026-10-14'],
    ])
    expect(ranged.tasks[1]!.aiFields).not.toContain('dates')
  })
})
