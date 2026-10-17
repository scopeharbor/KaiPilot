/**
 * What-if Impact Summary 单元测试 —— calculator、severity、evidence。
 */

import { describe, it, expect } from 'vitest'
import { computeImpactSummary } from '@/lib/gantt/what-if-impact'
import type { WhatIfBaseSnapshot } from '@/lib/gantt/what-if-types'
import type { GanttRenderTask, GanttRenderDependency, GanttModel } from '@/lib/gantt/types'

function makeTask(
  id: number,
  startDay = 0,
  dur = 5,
  kind: GanttRenderTask['kind'] = 'task',
): GanttRenderTask {
  return {
    id,
    name: `T${id}`,
    wbsCode: '',
    depth: 0,
    parentId: null,
    kind,
    startDay,
    durationDays: dur,
    progress: 0,
    status: 'not_started',
  }
}

function makeBaseSnapshot(
  tasks: GanttRenderTask[],
  deps: GanttRenderDependency[] = [],
): WhatIfBaseSnapshot {
  return { serverRevision: 'v1', inputHash: 'h', tasks, dependencies: deps, calendarSettings: null }
}

function makeModel(tasks: GanttRenderTask[], deps: GanttRenderDependency[] = []): GanttModel {
  return {
    tasks,
    dependencies: deps,
    milestones: [],
    timeRange: { startDay: 0, endDay: 100 },
    epochMs: Date.UTC(2025, 0, 1),
  }
}

describe('Severity & Apply gate (task 4)', () => {
  it('blocker 阻止 Apply', () => {
    const t1 = makeTask(1),
      t2 = makeTask(2)
    const base = makeBaseSnapshot([t1, t2])
    const model = makeModel([{ ...t1, startDay: 5 }, { ...t2 }])
    const result = computeImpactSummary({
      baseSnapshot: base,
      previewModel: model,
      directCommandTaskIds: [1],
      backendPreviewToken: 'tok',
      serverRevision: 'v1',
      validation: { hasCycle: true, constraintViolations: 1, warnings: ['环'] },
    })
    expect(result.gate.hasBlocker).toBe(true)
  })

  it('info 变化不能升格为 warning', () => {
    const t1 = makeTask(1)
    const base = makeBaseSnapshot([t1])
    const model = makeModel([{ ...t1 }])
    const result = computeImpactSummary({
      baseSnapshot: base,
      previewModel: model,
      directCommandTaskIds: [1],
      backendPreviewToken: 'tok',
      serverRevision: 'v1',
    })
    // 无变化 → 只有 info
    expect(result.gate.hasBlocker).toBe(false)
    expect(result.gate.hasWarning).toBe(false)
  })

  it('未确认 warning 时 gate 标 warning 但不禁用 Apply', () => {
    const ms = makeTask(1, 5, 0, 'milestone')
    const base = makeBaseSnapshot([ms])
    const model = makeModel([{ ...ms, startDay: 12 }])
    const result = computeImpactSummary({
      baseSnapshot: base,
      previewModel: model,
      directCommandTaskIds: [1],
      backendPreviewToken: 'tok',
      serverRevision: 'v1',
    })
    expect(result.gate.hasWarning).toBe(true)
    expect(result.gate.warningConfirmed).toBe(false)
    // warning 需要确认
  })
})

describe('computeImpactSummary', () => {
  it('无变化时的基准 summary', () => {
    const t1 = makeTask(1, 0, 5)
    const base = makeBaseSnapshot([t1])
    const model = makeModel([{ ...t1 }])
    const result = computeImpactSummary({
      baseSnapshot: base,
      previewModel: model,
      directCommandTaskIds: [],
      backendPreviewToken: 'tok',
      serverRevision: 'v1',
    })
    expect(result.gate.hasBlocker).toBe(false)
    expect(result.tasks.direct).toBe(0)
    expect(result.tasks.propagated).toBe(0)
    expect(result.tasks.unchanged).toBe(1)
    expect(result.isAuthoritative).toBe(true)
  })

  it('direct move 产生 DIRECT_DATE_MOVE', () => {
    const t1 = makeTask(1, 0, 5),
      t2 = makeTask(2, 10, 3)
    const base = makeBaseSnapshot([t1, t2])
    const moved = { ...t2, startDay: 20 }
    const model = makeModel([{ ...t1 }, moved])
    const result = computeImpactSummary({
      baseSnapshot: base,
      previewModel: model,
      directCommandTaskIds: [2],
      backendPreviewToken: 'tok',
      serverRevision: 'v1',
    })
    expect(result.tasks.direct).toBe(1)
    expect(result.evidence.some((e) => e.reasonCode === 'DIRECT_DATE_MOVE')).toBe(true)
  })

  it('依赖传播标记为 propagated', () => {
    const t1 = makeTask(1, 0, 5),
      t2 = makeTask(2, 10, 3),
      t3 = makeTask(3, 15, 7)
    const base = makeBaseSnapshot([t1, t2, t3])
    const moved3 = { ...t3, startDay: 25 }
    const model = makeModel([{ ...t1 }, { ...t2 }, moved3])
    const result = computeImpactSummary({
      baseSnapshot: base,
      previewModel: model,
      directCommandTaskIds: [1],
      backendPreviewToken: 'tok',
      serverRevision: 'v1',
    })
    // t2 和 t3 如果变化但不在 directSet 中 → propagated
    const propagated = result.evidence.filter(
      (e) => e.propagation === 'propagated' && e.entityType === 'task',
    )
    expect(propagated.length).toBeGreaterThanOrEqual(1)
  })

  it('blocker 出现在有环路时', () => {
    const t1 = makeTask(1),
      t2 = makeTask(2)
    const base = makeBaseSnapshot([t1, t2])
    const model = makeModel([{ ...t1 }, { ...t2 }])
    const result = computeImpactSummary({
      baseSnapshot: base,
      previewModel: model,
      directCommandTaskIds: [],
      backendPreviewToken: 'tok',
      serverRevision: 'v1',
      validation: { hasCycle: true, constraintViolations: 0, warnings: [] },
    })
    expect(result.gate.hasBlocker).toBe(true)
    expect(result.conflicts.cycleCount).toBe(1)
    expect(result.evidence.some((e) => e.reasonCode === 'CYCLE_DETECTED')).toBe(true)
  })

  it('里程碑延迟产生 warning', () => {
    const ms = makeTask(1, 5, 0, 'milestone')
    const base = makeBaseSnapshot([ms])
    const moved = { ...ms, startDay: 12 }
    const model = makeModel([moved])
    const result = computeImpactSummary({
      baseSnapshot: base,
      previewModel: model,
      directCommandTaskIds: [1],
      backendPreviewToken: 'tok',
      serverRevision: 'v1',
    })
    expect(result.milestones.delayed).toBe(1)
    expect(result.evidence.some((e) => e.reasonCode === 'MILESTONE_DELAYED')).toBe(true)
    const msEv = result.evidence.find((e) => e.reasonCode === 'MILESTONE_DELAYED')
    expect(msEv?.severity).toBe('warning')
  })

  it('里程碑提前产生 info', () => {
    const ms = makeTask(1, 10, 0, 'milestone')
    const base = makeBaseSnapshot([ms])
    const moved = { ...ms, startDay: 3 }
    const model = makeModel([moved])
    const result = computeImpactSummary({
      baseSnapshot: base,
      previewModel: model,
      directCommandTaskIds: [1],
      backendPreviewToken: 'tok',
      serverRevision: 'v1',
    })
    expect(result.milestones.advanced).toBe(1)
    expect(result.evidence.some((e) => e.reasonCode === 'MILESTONE_ADVANCED')).toBe(true)
  })

  it('provisional 标记（无后端 token）', () => {
    const t1 = makeTask(1)
    const base = makeBaseSnapshot([t1])
    const model = makeModel([{ ...t1 }])
    const result = computeImpactSummary({
      baseSnapshot: base,
      previewModel: model,
      directCommandTaskIds: [],
      backendPreviewToken: null,
      serverRevision: 'v1',
    })
    expect(result.isAuthoritative).toBe(false)
  })

  it('有 baseline 时计算 variance', () => {
    const t1 = makeTask(1, 0, 5),
      t2 = makeTask(2, 10, 3)
    const base = makeBaseSnapshot([t1, t2])
    const moved2 = { ...t2, startDay: 20 }
    const model = makeModel([{ ...t1 }, moved2])
    const result = computeImpactSummary({
      baseSnapshot: base,
      previewModel: model,
      directCommandTaskIds: [2],
      backendPreviewToken: 'tok',
      serverRevision: 'v1',
      baseline: { finishDate: '2025-01-17', startDate: '2025-01-01', durationDays: 12 },
    })
    expect(result.baseline.hasBaseline).toBe(true)
  })

  it('无 baseline 时显式 unknown', () => {
    const t1 = makeTask(1)
    const base = makeBaseSnapshot([t1])
    const model = makeModel([{ ...t1 }])
    const result = computeImpactSummary({
      baseSnapshot: base,
      previewModel: model,
      directCommandTaskIds: [],
      backendPreviewToken: 'tok',
      serverRevision: 'v1',
    })
    expect(result.baseline.hasBaseline).toBe(false)
    expect(result.baseline.finishVariance).toBeNull()
  })

  it('工期变化体现在 timeline metric', () => {
    const tasks = [makeTask(1, 0, 5), makeTask(2, 6, 3)]
    const base = makeBaseSnapshot(tasks)
    const model = makeModel([makeTask(1, 0, 5), makeTask(2, 20, 3)])
    const result = computeImpactSummary({
      baseSnapshot: base,
      previewModel: model,
      directCommandTaskIds: [2],
      backendPreviewToken: 'tok',
      serverRevision: 'v1',
    })
    expect(result.timeline.workingDelta).not.toBeNull()
    expect(result.timeline.before).toContain('d')
  })
})
