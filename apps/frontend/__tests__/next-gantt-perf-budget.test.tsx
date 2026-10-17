/**
 * v3-ui-next-gantt-lens W4 tasks 4.3 —— 性能预算与视口裁剪断言测试。
 *
 * 覆盖指标与契约（spec「甘特时间镜头渲染与性能预算」/ design 决策 9）：
 * 1. 1000 任务 / 1500 依赖大规模基准数据集构建；
 * 2. performance.now() 测量数据就绪到首屏可见 DOM 完成渲染耗时 < 3000ms（注明 jsdom 口径）；
 * 3. 视口裁剪：常驻活跃 DOM/SVG 图元 [data-gantt-element] ≤ 200 个；
 * 4. 模拟滚动单帧响应，滚动后活动图元稳定维持在 ≤ 200 个；
 * 5. 精确档 pure DOM 表格在 1000 任务规模下平稳挂载。
 */

import * as React from 'react'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceGanttChart } from '@/components/next/gantt/WorkspaceGanttChart'
import { WorkspaceGanttPreciseTable } from '@/components/next/gantt/WorkspaceGanttPreciseTable'
import { createGanttViewStore } from '@/stores/gantt-store'
import type { GanttModel, GanttRenderDependency, GanttRenderTask } from '@/lib/gantt/types'

const EPOCH_MS = Date.parse('2026-01-01T00:00:00Z')

/**
 * 确定性生成 1000 个任务、1500 条依赖的性能基准模型。
 * 纯算法生成，DAG 自然无环（predecessorId < successorId）。
 */
function build1000Tasks1500DepsModel(): GanttModel {
  const tasks: GanttRenderTask[] = []
  for (let i = 1; i <= 1000; i++) {
    const isMilestone = i <= 10
    const startDay = (i * 7) % 300
    const durationDays = isMilestone ? 0 : (i % 12) + 2
    tasks.push({
      id: i,
      name: isMilestone ? `里程碑 M${i}` : `排程任务 ${i}`,
      wbsCode: `1.${i}`,
      depth: i % 4,
      parentId: i > 4 ? Math.floor(i / 4) : null,
      kind: isMilestone ? 'milestone' : 'task',
      startDay,
      durationDays,
      progress: (i % 100) / 100,
      status: i % 5 === 0 ? 'completed' : i % 3 === 0 ? 'in_progress' : 'not_started',
      priority: i % 4 === 0 ? 'highest' : i % 2 === 0 ? 'high' : 'medium',
      milestoneId: isMilestone ? i : undefined,
    })
  }

  const dependencies: GanttRenderDependency[] = []
  const types: Array<'fs' | 'ss' | 'ff' | 'sf'> = ['fs', 'ss', 'ff', 'sf']
  for (let d = 1; d <= 1500; d++) {
    const pred = (d % 600) + 1
    const succ = pred + ((d % 380) + 1)
    const effectiveSucc = succ <= 1000 ? succ : 1000
    const effectivePred = effectiveSucc === pred ? Math.max(1, pred - 1) : pred
    dependencies.push({
      id: d,
      predecessorId: effectivePred,
      successorId: effectiveSucc,
      type: types[d % 4]!,
      lagDays: d % 10 === 0 ? 1 : 0,
    })
  }

  const milestones = tasks
    .filter((t) => t.kind === 'milestone')
    .map((m) => ({
      id: m.milestoneId ?? m.id,
      taskId: m.id,
      name: m.name,
      day: m.startDay,
      status: 'planned' as const,
    }))

  return {
    tasks,
    dependencies,
    milestones,
    timeRange: { startDay: 0, endDay: 365 },
    epochMs: EPOCH_MS,
  }
}

describe('v3-ui-next-gantt-lens 性能预算与视口裁剪测试 (W4)', () => {
  let model: GanttModel

  beforeEach(() => {
    model = build1000Tasks1500DepsModel()
  })

  afterEach(() => {
    cleanup()
  })

  it('基准数据集契约：严格包含 1000 个任务与 1500 条依赖', () => {
    expect(model.tasks).toHaveLength(1000)
    expect(model.dependencies).toHaveLength(1500)
    expect(model.milestones.length).toBeGreaterThanOrEqual(10)
    // 依赖无自环
    for (const dep of model.dependencies) {
      expect(dep.predecessorId).toBeLessThan(dep.successorId)
    }
  })

  it('首屏渲染耗时预算：从数据就绪到可见 DOM 完成挂载 < 3000ms（jsdom 口径）', () => {
    const store = createGanttViewStore()
    const onRenderComplete = vi.fn()

    // 测量首屏挂载耗时（jsdom 纯 JS DOM 操作无 GPU 硬件加速，执行时间反映 VDOM 与裁剪计算效率）
    const startMs = performance.now()
    const { container } = render(
      <WorkspaceGanttChart
        model={model}
        store={store}
        initialViewport={{ width: 1200, height: 800 }}
        onRenderComplete={onRenderComplete}
      />,
    )
    const mountDurationMs = performance.now() - startMs

    // 断言 1：首屏渲染耗时在预算 3000ms 以内（注明：jsdom 环境测量，实际耗时远低于预算）
    expect(mountDurationMs).toBeLessThan(3000)

    // 回调正常触发
    expect(onRenderComplete).toHaveBeenCalledTimes(1)
    const report = onRenderComplete.mock.calls[0]?.[0]
    expect(report).toBeDefined()
    expect(report!.durationMs).toBeLessThan(3000)

    // 检查画板正常挂载
    const canvas = container.querySelector('[data-gantt-canvas]')
    expect(canvas).toBeInTheDocument()
  })

  it('视口裁剪预算：1000 任务规模下常驻活动图元 [data-gantt-element] ≤ 200 个', () => {
    const store = createGanttViewStore()
    const { container } = render(
      <WorkspaceGanttChart
        model={model}
        store={store}
        initialViewport={{ width: 1200, height: 800 }}
      />,
    )

    // 统计活动 DOM/SVG 图元（包含可视任务条、里程碑等）
    const activeElements = container.querySelectorAll('[data-gantt-element]')
    const bars = container.querySelectorAll('[data-gantt-bar]')

    // 纵向行窗口仅实例化视口内可见行（ROW_BUFFER=4，可视约 20~30 行）
    expect(bars.length).toBeLessThanOrEqual(35)
    // 活动图元总数严格受控在 ≤ 200 个
    expect(activeElements.length).toBeLessThanOrEqual(200)
    expect(activeElements.length).toBeGreaterThan(0)
  })

  it('快速滚动交互：单帧重绘响应迅速且活动图元稳定控制在 ≤ 200 个', () => {
    const store = createGanttViewStore()
    const { container } = render(
      <WorkspaceGanttChart
        model={model}
        store={store}
        initialViewport={{ width: 1200, height: 800 }}
      />,
    )

    const viewport = container.querySelector('[data-gantt-viewport]') as HTMLElement
    expect(viewport).toBeInTheDocument()

    // 模拟纵向向下滚动 1000px，横向滚动 500px
    const scrollStart = performance.now()
    fireEvent.scroll(viewport, { target: { scrollTop: 1000, scrollLeft: 500 } })
    const scrollDuration = performance.now() - scrollStart

    // jsdom 下滚动事件派发与裁剪重绘单次耗时 < 100ms
    expect(scrollDuration).toBeLessThan(100)

    // 滚动后重新裁剪，活动图元仍稳定保持在 ≤ 200 个
    const elementsAfterScroll = container.querySelectorAll('[data-gantt-element]')
    expect(elementsAfterScroll.length).toBeLessThanOrEqual(200)
    expect(elementsAfterScroll.length).toBeGreaterThan(0)
  })

  it('精确档纯 DOM 表格在 1000 任务规模下平稳挂载且渲染无异常', () => {
    const mockSession = {
      status: 'idle' as const,
      enterSession: vi.fn(),
      executeCommand: vi.fn().mockReturnValue({ valid: true, error: null }),
    }

    const startMs = performance.now()
    const { container } = render(
      <WorkspaceGanttPreciseTable model={model} canEdit={true} session={mockSession} />,
    )
    const durationMs = performance.now() - startMs

    expect(durationMs).toBeLessThan(3000)
    const table = container.querySelector('[data-precise-table]')
    expect(table).toBeInTheDocument()
    expect(table?.getAttribute('data-precise-rows')).toBe('1000')
  })
})
