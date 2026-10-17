import { describe, expect, it } from 'vitest'
import { buildGanttM0Dataset, summarizeDataset, TASK_COUNT } from '@/lib/gantt-m0/dataset'
import { DEPENDENCY_TYPES, GANTT_TASK_STATUSES } from '@/lib/gantt-m0/types'

describe('buildGanttM0Dataset —— M0 数据集契约', () => {
  it('同一 seed 逐次一致（复现性）', () => {
    const a = buildGanttM0Dataset(20260705)
    const b = buildGanttM0Dataset(20260705)
    // 逐位一致：结构化对象深度相等即可作为「逐条一致」的可测代理。
    expect(b).toEqual(a)
  })

  it('不同 seed 产出不同数据集（种子确实生效）', () => {
    const a = buildGanttM0Dataset(1)
    const b = buildGanttM0Dataset(2)
    expect(b).not.toEqual(a)
  })

  it('恰好 1000 个任务', () => {
    const spec = buildGanttM0Dataset(7)
    expect(spec.tasks).toHaveLength(TASK_COUNT)
    expect(summarizeDataset(spec).taskCount).toBe(TASK_COUNT)
  })

  it('四类依赖均有可观实例', () => {
    const summary = summarizeDataset(buildGanttM0Dataset(7))
    for (const type of DEPENDENCY_TYPES) {
      expect(summary.dependencyTypeCounts[type]).toBeGreaterThan(0)
    }
    expect(summary.dependencyCount).toBeGreaterThan(400)
  })

  it('六状态混合分布（每种状态都出现）', () => {
    const summary = summarizeDataset(buildGanttM0Dataset(7))
    for (const status of GANTT_TASK_STATUSES) {
      expect(summary.statusCounts[status]).toBeGreaterThan(0)
    }
  })

  it('含里程碑任务且工期为 0', () => {
    const spec = buildGanttM0Dataset(7)
    expect(spec.milestones.length).toBeGreaterThan(0)
    for (const milestone of spec.milestones) {
      expect(spec.tasks[milestone.taskId]!.isMilestone).toBe(true)
      expect(spec.tasks[milestone.taskId]!.durationDays).toBe(0)
    }
  })

  it('WBS 深度达标：命中 3~20 层区间的深层结构', () => {
    const summary = summarizeDataset(buildGanttM0Dataset(7))
    expect(summary.maxDepth).toBeGreaterThanOrEqual(3)
    expect(summary.maxDepth).toBeLessThanOrEqual(20)
    // 显式深脊柱保证至少深入约 16 层，避免「只有浅层」误判为达标。
    expect(summary.maxDepth).toBeGreaterThanOrEqual(16)
  })

  it('依赖无自环且 successor 索引恒大于 predecessor（天然无环）', () => {
    const spec = buildGanttM0Dataset(7)
    for (const dep of spec.dependencies) {
      expect(dep.predecessorId).toBeLessThan(dep.successorId)
    }
  })

  it('outline 编号与父子关系一致', () => {
    const spec = buildGanttM0Dataset(7)
    for (const task of spec.tasks) {
      if (task.parentId === null) {
        expect(task.depth).toBe(0)
        expect(task.wbsCode).not.toContain('.')
      } else {
        const parent = spec.tasks[task.parentId]!
        expect(task.depth).toBe(parent.depth + 1)
        expect(task.wbsCode.startsWith(`${parent.wbsCode}.`)).toBe(true)
      }
    }
  })
})
