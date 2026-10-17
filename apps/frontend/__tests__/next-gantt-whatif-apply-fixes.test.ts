/**
 * 甘特 What-if 试算修复（2026-10-12 用户反馈）回归测试：
 * - 第一个任务往后拖 1 天、完工日不变时，不得显示「完工日期提前 1 天」/「提前 -1 天」；
 * - 应用失败后（error 态）仍可继续拖动调整（原先拖拽被拒、横幅消失，只能刷新）。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { computeImpactSummary } from '@/lib/gantt/what-if-impact'
import { buildWhatIfImpactLabel } from '@/components/next/gantt/WorkspaceGanttWhatIfHud'
import { formatWorkingDelta } from '@/components/next/gantt/WorkspaceGanttImpactDrawer'
import { useWhatIfSessionStore } from '@/stores/what-if-store'
import type { WhatIfBaseSnapshot } from '@/lib/gantt/what-if-types'
import type { GanttModel, GanttRenderTask } from '@/lib/gantt/types'

function task(id: number, startDay: number, durationDays: number): GanttRenderTask {
  return {
    id,
    name: `T${id}`,
    wbsCode: '',
    depth: 0,
    parentId: null,
    kind: 'task',
    startDay,
    durationDays,
    progress: 0,
    status: 'not_started',
  }
}

function base(tasks: GanttRenderTask[]): WhatIfBaseSnapshot {
  return { serverRevision: 'v1', inputHash: 'h', tasks, dependencies: [], calendarSettings: null }
}

function model(tasks: GanttRenderTask[]): GanttModel {
  return {
    tasks,
    dependencies: [],
    milestones: [],
    timeRange: { startDay: 0, endDay: 60 },
    epochMs: Date.UTC(2026, 10, 2),
  }
}

describe('完工日期变动按完工日比较（不是总工期）', () => {
  it('第一个任务往后拖 1 天、完工日不变：无变化', () => {
    const tasks = [task(1, 0, 1), task(2, 1, 1), task(3, 5, 26)]
    const summary = computeImpactSummary({
      baseSnapshot: base(tasks),
      previewModel: model([task(1, 1, 1), task(2, 2, 1), task(3, 5, 26)]),
      directCommandTaskIds: [1],
      backendPreviewToken: null,
      serverRevision: 'v1',
    })
    expect(summary.timeline.workingDelta).toBeNull()
    expect(formatWorkingDelta(summary.timeline.workingDelta)).toBe('项目整体完工日期无变化')
    expect(buildWhatIfImpactLabel(summary)).not.toMatch(/提前|延后/)
  })

  it('最后一个任务往后拖 2 天：完工延后 2 天', () => {
    const tasks = [task(1, 0, 3), task(2, 3, 5)]
    const summary = computeImpactSummary({
      baseSnapshot: base(tasks),
      previewModel: model([task(1, 0, 3), task(2, 5, 5)]),
      directCommandTaskIds: [2],
      backendPreviewToken: null,
      serverRevision: 'v1',
    })
    expect(summary.timeline.workingDelta).toBe(2)
    expect(buildWhatIfImpactLabel(summary)).toContain('完工延后 2 天')
  })

  it('完工提前时标签不出现负号', () => {
    const tasks = [task(1, 0, 3), task(2, 3, 5)]
    const summary = computeImpactSummary({
      baseSnapshot: base(tasks),
      previewModel: model([task(1, 0, 3), task(2, 2, 5)]),
      directCommandTaskIds: [2],
      backendPreviewToken: null,
      serverRevision: 'v1',
    })
    expect(summary.timeline.workingDelta).toBe(-1)
    expect(buildWhatIfImpactLabel(summary)).toContain('完工提前 1 天')
    expect(buildWhatIfImpactLabel(summary)).not.toContain('-1')
  })
})

describe('应用失败后可继续调整', () => {
  beforeEach(() => {
    useWhatIfSessionStore.getState().discardSession()
  })

  it('error 态下执行新命令：命令生效并回到 active，错误清除', () => {
    const store = useWhatIfSessionStore.getState()
    const tasks = [task(1, 0, 3), task(2, 3, 5)]
    store.enterSession(tasks, [], null, 'v1', 7, Date.UTC(2026, 10, 2))
    store.executeCommand({ kind: 'move-task', taskId: 1, newStartDate: '2026-11-03' })
    store.onApplyError('排程存在阻塞冲突')
    expect(useWhatIfSessionStore.getState().session.status).toBe('error')

    const result = useWhatIfSessionStore
      .getState()
      .executeCommand({ kind: 'move-task', taskId: 2, newStartDate: '2026-11-09' })
    expect(result.valid).toBe(true)
    const session = useWhatIfSessionStore.getState().session
    expect(session.status).toBe('active')
    expect(session.errorMessage).toBeNull()
    expect(session.history.cursor).toBe(2)
  })
})
