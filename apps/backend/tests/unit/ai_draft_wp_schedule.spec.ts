import { describe, expect, it } from 'vitest'
import type { ProjectDraftWorkPackage } from '@aiproj/types'
import {
  alignTaskDependencies,
  breakDependencyCycles,
  packagePredecessors,
  scheduleWorkPackages,
} from '#services/ai_draft/wp_schedule'

const pkg = (
  id: string,
  capabilityId: string,
  roleEffort: Record<string, number>,
  dependsOn: string[] = [],
): ProjectDraftWorkPackage => ({
  id,
  capabilityId,
  name: id,
  deliverable: `${id} 交付物`,
  doneDefinition: '通过',
  dependsOn,
  effortDays: Object.values(roleEffort).reduce((sum, value) => sum + value, 0),
  roleEffort,
})

describe('工作包层级排期', () => {
  it('依赖「整项能力」展开为该能力的全部工作包', () => {
    const preds = packagePredecessors([
      pkg('cap-1-wp1', 'cap-1', { 后端: 4 }),
      pkg('cap-1-wp2', 'cap-1', { 后端: 4 }),
      pkg('cap-2-wp1', 'cap-2', { 测试: 4 }, ['cap-1']),
    ])
    expect(preds.get('cap-2-wp1')).toEqual(['cap-1-wp1', 'cap-1-wp2'])
  })

  it('按依赖与角色人数排期：同一角色人数不够时顺延，算出延期', () => {
    const plan = scheduleWorkPackages({
      workPackages: [
        pkg('a', 'cap-1', { 后端: 10 }),
        pkg('b', 'cap-1', { 后端: 10 }),
        pkg('c', 'cap-2', { 测试: 4 }, ['a', 'b']),
      ],
      // 后端只有 1 人：a、b 各 10 天只能先后做，c 再做 4 天 → 24 个工作日
      headcount: new Map([
        ['后端', 1],
        ['测试', 1],
      ]),
      workdays: 20,
    })
    expect(plan.totalWorkdays).toBe(24)
    expect(plan.lateWorkdays).toBe(4)
    // 纯依赖最长链只有 14 天：瓶颈在人手不在依赖
    expect(plan.chainWorkdays).toBe(14)
  })

  it('同一角色 2 人时单个工作包最多 2 人并行', () => {
    const plan = scheduleWorkPackages({
      workPackages: [pkg('a', 'cap-1', { 后端: 10 })],
      headcount: new Map([['后端', 3]]),
      workdays: 20,
    })
    expect(plan.totalWorkdays).toBe(5)
  })
})

describe('任务依赖对齐工作包计划', () => {
  const marked = (value: unknown) => ({
    value,
    marker: { confidence: 1, source: 'inferred', reason: '测试', needsConfirmation: false },
  })
  it('删掉没有工作包依据的跨包依赖，补齐缺失的包间衔接', () => {
    const packages = [
      pkg('p1', 'cap-1', { 后端: 2 }),
      pkg('p2', 'cap-1', { 后端: 2 }, ['p1']),
      pkg('p3', 'cap-2', { 测试: 2 }),
    ]
    const aggregate: Record<string, unknown> = {
      tasks: [
        { id: 'task-1', wbsNodeId: 'n1' },
        { id: 'task-2', wbsNodeId: 'n1' },
        { id: 'task-3', wbsNodeId: 'n2' },
        { id: 'task-4', wbsNodeId: 'n3' },
      ],
      dependencies: [
        // 同包内：保留（编号沿用上一次对齐补的 dep-wp1：本次新补的不能再用这个编号）
        {
          id: 'dep-wp1',
          predecessorId: 'task-1',
          successorId: 'task-2',
          type: 'FS',
          lagDays: marked(0),
        },
        // p3 → p2 没有工作包依据：删除
        {
          id: 'd2',
          predecessorId: 'task-4',
          successorId: 'task-3',
          type: 'FS',
          lagDays: marked(0),
        },
      ],
    }
    const result = alignTaskDependencies(
      aggregate,
      new Map([
        ['n1', 'p1'],
        ['n2', 'p2'],
        ['n3', 'p3'],
      ]),
      packages,
    )
    expect(result).toEqual({ removed: 1, added: 1 })
    const deps = aggregate.dependencies as Array<{ predecessorId: string; successorId: string }>
    expect(deps.map((dep) => `${dep.predecessorId}>${dep.successorId}`)).toEqual([
      'task-1>task-2',
      // p1 → p2：p1 的最后任务 → p2 的首个任务
      'task-2>task-3',
    ])
    const ids = (aggregate.dependencies as Array<{ id: string }>).map((dep) => dep.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('任务依赖对齐：不让任务漂到开工日', () => {
  it('删完会一个前置都不剩的任务，保留它原有的跨包依赖；还有别的前置的照删', () => {
    const marked = (value: number) => ({
      value,
      marker: { confidence: 1, source: 'explicit', reason: '', needsConfirmation: false },
    })
    const dep = (id: string, from: string, to: string) => ({
      id,
      predecessorId: from,
      successorId: to,
      type: 'FS',
      lagDays: marked(0),
    })
    // dev 包与 uat 包之间没有登记工作包依赖
    const aggregate: Record<string, unknown> = {
      tasks: [
        { id: 'dev-1', wbsNodeId: 'n-dev' },
        { id: 'dev-2', wbsNodeId: 'n-dev' },
        { id: 'uat', wbsNodeId: 'n-uat' },
        { id: 'fix', wbsNodeId: 'n-uat' },
      ],
      dependencies: [
        dep('d1', 'dev-1', 'dev-2'),
        // UAT 只有跨包前置：保留，否则会被排到开工日
        dep('d2', 'dev-2', 'uat'),
        // 修缺陷：包内已有 UAT 在前，跨包那条照删
        dep('d3', 'uat', 'fix'),
        dep('d4', 'dev-1', 'fix'),
      ],
    }
    const result = alignTaskDependencies(
      aggregate,
      new Map([
        ['n-dev', 'dev'],
        ['n-uat', 'uat'],
      ]),
      [pkg('dev', 'cap-1', { 后端: 4 }), pkg('uat', 'cap-2', { 测试: 2 })],
    )
    expect(result).toEqual({ removed: 1, added: 0 })
    const ids = (aggregate.dependencies as Array<{ id: string }>).map((item) => item.id).sort()
    expect(ids).toEqual(['d1', 'd2', 'd3'])
  })
})

describe('破除依赖环', () => {
  it('优先删程序补的衔接（dep-wp），其次删最后加入的依赖，直到无环', () => {
    const edge = (id: string, from: string, to: string) => ({
      id,
      predecessorId: from,
      successorId: to,
    })
    const aggregate: Record<string, unknown> = {
      dependencies: [
        edge('dep-1', 'a', 'b'),
        edge('dep-2', 'b', 'c'),
        edge('dep-wp1', 'c', 'a'),
        edge('dep-3', 'c', 'd'),
      ],
    }
    expect(breakDependencyCycles(aggregate)).toBe(1)
    expect((aggregate.dependencies as Array<{ id: string }>).map((dep) => dep.id)).toEqual([
      'dep-1',
      'dep-2',
      'dep-3',
    ])
  })
})
