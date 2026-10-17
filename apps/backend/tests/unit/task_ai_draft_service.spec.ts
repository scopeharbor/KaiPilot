import { describe, expect, it } from 'vitest'
import { normalizeTaskAiDraft } from '#services/ai_planning/task_ai_draft_service'

const context = {
  description: '做一下订单导出',
  projectName: '食堂订餐',
  projectStart: '2026-10-12',
  projectEnd: '2026-11-12',
  workPackages: [{ id: 7, code: '1.2', name: '订单服务' }],
  roles: ['后端', '前端'],
  existingTaskNames: [],
}

describe('任务卡 AI 补全：模型输出规整', () => {
  it('字段校验：工期按半天取整并限制在 0.5–2 天，工作包 / 角色只能用给定的', () => {
    const draft = normalizeTaskAiDraft(
      {
        name: '开发订单导出接口并通过自测',
        durationDays: 3.3,
        priority: 'urgent',
        wbsNodeId: 99,
        roleHint: '运维',
        steps: ['设计导出字段', '实现接口', '自测'],
        doneCriteria: ['导出 1000 条 < 3 秒'],
      },
      context,
    )
    expect(draft.durationDays).toBe(2)
    expect(draft.priority).toBe('medium')
    expect(draft.wbsNodeId).toBeNull()
    expect(draft.roleHint).toBeNull()
    expect(draft.steps).toHaveLength(3)
  })

  it('拆分建议至少两张才保留；每张 0.5–2 天', () => {
    const draft = normalizeTaskAiDraft(
      {
        name: '梳理导出需求',
        wbsNodeId: 7,
        roleHint: '后端',
        split: [
          { name: '梳理导出需求', durationDays: 0.4, steps: ['a'] },
          { name: '开发导出接口', durationDays: 1, steps: ['b'] },
        ],
        note: '超过 2 天，拆成 2 张',
      },
      context,
    )
    expect(draft.wbsNodeId).toBe(7)
    expect(draft.roleHint).toBe('后端')
    expect(draft.split.map((item) => item.durationDays)).toEqual([0.5, 1])
    expect(normalizeTaskAiDraft({ split: [{ name: 'x' }] }, context).split).toEqual([])
  })

  it('模型没给名字时用用户原话兜底', () => {
    expect(normalizeTaskAiDraft({}, context).name).toBe('做一下订单导出')
  })
})

describe('任务卡 AI 补全：拆分清单修整（2026-09-29 实测）', () => {
  it('丢掉占位卡；主卡不在拆分清单里时补到最前面（带上主卡的完成标准与步骤）', () => {
    const draft = normalizeTaskAiDraft(
      {
        name: '完成压测方案评审',
        durationDays: 1,
        steps: ['写方案', '评审'],
        doneCriteria: ['评审纪要归档'],
        split: [
          { name: '准备压测数据', durationDays: 0.5, steps: ['a'], doneCriteria: ['数据可重放'] },
          { name: '编写压测脚本', durationDays: 1, steps: ['b'] },
          { name: '（占位）无', durationDays: 0.5, steps: [] },
        ],
      },
      context,
    )
    expect(draft.split.map((item) => item.name)).toEqual([
      '完成压测方案评审',
      '准备压测数据',
      '编写压测脚本',
    ])
    expect(draft.split[0]!.steps).toEqual(['写方案', '评审'])
    expect(draft.split[0]!.doneCriteria).toEqual(['评审纪要归档'])
  })

  it('拆分小卡保留各自的完成标准；模型没给时为空数组', () => {
    const draft = normalizeTaskAiDraft(
      {
        name: '准备压测数据',
        split: [
          {
            name: '准备压测数据',
            durationDays: 0.5,
            steps: ['a'],
            doneCriteria: ['数据可重放', '覆盖 3 类异常'],
          },
          { name: '编写压测脚本', durationDays: 1, steps: ['b'] },
        ],
      },
      context,
    )
    expect(draft.split[0]!.doneCriteria).toEqual(['数据可重放', '覆盖 3 类异常'])
    expect(draft.split[1]!.doneCriteria).toEqual([])
  })
})
