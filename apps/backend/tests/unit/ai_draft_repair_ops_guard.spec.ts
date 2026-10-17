import { describe, expect, it } from 'vitest'
import { applyRepairOps, deterministicCritic } from '#services/ai_draft/quality_loop'

const dep = (id: string, from: string, to: string) => ({
  id,
  predecessorId: from,
  successorId: to,
  type: 'FS',
  lagDays: {
    value: 0,
    marker: { confidence: 1, source: 'explicit', reason: '', needsConfirmation: false },
  },
})

describe('修复操作：不删任务的最后一条前置', () => {
  it('删最后一条前置被拒绝（否则任务漂到开工日）；还有别的前置时照删', () => {
    const aggregate: Record<string, unknown> = {
      charter: {},
      tasks: [
        { id: 'task-1', wbsNodeId: 'n1' },
        { id: 'task-2', wbsNodeId: 'n1' },
        { id: 'task-3', wbsNodeId: 'n1' },
      ],
      dependencies: [
        dep('d1', 'task-1', 'task-3'),
        dep('d2', 'task-2', 'task-3'),
        dep('d3', 'task-1', 'task-2'),
      ],
    }
    applyRepairOps(
      aggregate,
      [
        { op: 'removeDependency', from: 'task-1', to: 'task-3' },
        { op: 'removeDependency', from: 'task-1', to: 'task-2' },
      ],
      new Set(['n1']),
      { repairedTasks: new Set(), addedDependencies: 0, addedTasks: 0 },
    )
    const ids = (aggregate.dependencies as Array<{ id: string }>).map((item) => item.id)
    expect(ids).toEqual(['d2', 'd3'])
  })
})

describe('质量检查：项目管理分支的一次性交付物也要有前后依赖', () => {
  it('立项结论报告没有后继要指出；周报这类持续性工作仍免查', () => {
    const aggregate: Record<string, unknown> = {
      wbs: [
        { id: 'w1', name: { value: '食堂后台' }, children: [{ id: 'w1-1', children: [] }] },
        {
          id: 'w2',
          name: { value: '项目管理与需求验收' },
          children: [{ id: 'w2-1', children: [] }],
        },
      ],
      tasks: [
        { id: 'task-1', wbsNodeId: 'w1-1', name: { value: '开发后台汇总页面' } },
        { id: 'task-2', wbsNodeId: 'w2-1', name: { value: '输出立项与启动结论报告并完成归档' } },
        { id: 'task-3', wbsNodeId: 'w2-1', name: { value: '编写项目周报与进度跟踪' } },
      ],
      dependencies: [dep('d1', 'task-2', 'task-3')],
    }
    const issues = deterministicCritic(aggregate).filter((issue) =>
      ['no_predecessor', 'no_successor'].includes(issue.kind),
    )
    // task-2 没有前置（它不在第一个分支），task-3 是持续性工作免查
    expect(issues.map((issue) => `${issue.taskId}:${issue.kind}`)).toContain(
      'task-2:no_predecessor',
    )
    expect(issues.some((issue) => issue.taskId === 'task-3')).toBe(false)
  })
})
