import { describe, expect, it } from 'vitest'
import { buildGanttM0Dataset } from '@/lib/gantt-m0/dataset'
import { buildGanttModelFromSeed, m0SpecToModel } from '@/lib/gantt/model-from-m0'
import { CHART_EPOCH_MS } from '@/lib/gantt/geometry'

describe('gantt model-from-m0 —— 确定性数据集 → 渲染模型', () => {
  const model = buildGanttModelFromSeed(1)

  it('保持 1000 任务、非空依赖/里程碑，epoch 固定', () => {
    expect(model.tasks).toHaveLength(1000)
    expect(model.dependencies.length).toBeGreaterThan(0)
    expect(model.milestones.length).toBeGreaterThan(0)
    expect(model.epochMs).toBe(CHART_EPOCH_MS)
  })

  it('依赖类型归一为小写 fs/ss/ff/sf', () => {
    for (const d of model.dependencies) {
      expect(['fs', 'ss', 'ff', 'sf']).toContain(d.type)
    }
  })

  it('由 parentId 派生 summary/里程碑/task 三类 kind', () => {
    const kinds = new Set(model.tasks.map((t) => t.kind))
    expect(kinds.has('summary')).toBe(true)
    expect(kinds.has('milestone')).toBe(true)
    expect(kinds.has('task')).toBe(true)
    // 里程碑任务工期为 0。
    for (const t of model.tasks) {
      if (t.kind === 'milestone') expect(t.durationDays).toBe(0)
    }
  })

  it('每任务合成负责人（简化入口头像）', () => {
    for (const t of model.tasks) {
      expect(t.assignee?.initials).toMatch(/^M\d+$/)
    }
  })

  it('派生一条连通关键链：关键依赖两端均为关键任务', () => {
    const criticalTaskIds = new Set(model.tasks.filter((t) => t.isCritical).map((t) => t.id))
    const criticalDeps = model.dependencies.filter((d) => d.isCritical)
    expect(criticalTaskIds.size).toBeGreaterThan(1)
    expect(criticalDeps.length).toBeGreaterThan(0)
    for (const d of criticalDeps) {
      expect(criticalTaskIds.has(d.predecessorId)).toBe(true)
      expect(criticalTaskIds.has(d.successorId)).toBe(true)
    }
  })

  it('确定性：同 seed 逐次一致', () => {
    const a = m0SpecToModel(buildGanttM0Dataset(7))
    const b = m0SpecToModel(buildGanttM0Dataset(7))
    expect(a.tasks[500]).toEqual(b.tasks[500])
    expect(a.dependencies.length).toBe(b.dependencies.length)
  })
})
