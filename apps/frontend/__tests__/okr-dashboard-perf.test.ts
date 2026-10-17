/**
 * OKR Dashboard 大组织性能验证（v3-okr-dashboard §6.1–§6.2）。
 *
 * 阈值（前端投影侧）：
 *   - computeOkrDashboardSummary：1000 objective × 4 KR（总 4000 KR） < 2s
 *   - selectOkrKpiStrip + deriveOkrDashboardUiStatus：< 20ms（O(kpi) 常数）
 *   - buildOkrDashboardModuleRenderProps：< 50ms
 *
 * 若不达标，测试失败即为 §6.2 blocker。
 */
import { describe, it, expect } from 'vitest'
import {
  buildOkrDashboardModuleRenderProps,
  computeOkrDashboardSummary,
  makeOkrDashboardLargeFixtureInput,
} from '@aiproj/types'
import { deriveOkrDashboardUiStatus, selectOkrKpiStrip } from '@/lib/okr-dashboard-ui'

describe('OKR Dashboard perf — 大组织 fixture', () => {
  const largeInput = makeOkrDashboardLargeFixtureInput({
    objectiveCount: 1000,
    keyResultsPerObjective: 4,
  })

  it('computeOkrDashboardSummary(1000×4) 在 2s 内完成', () => {
    const t0 = performance.now()
    const summary = computeOkrDashboardSummary(largeInput)
    const t1 = performance.now()
    const elapsed = t1 - t0
    // 不裸 print，保留 metadata 便于失败时看
    expect(summary.meta.visibleObjectiveCount).toBeGreaterThanOrEqual(900)
    console.log(`[perf] compute summary elapsed=${elapsed.toFixed(1)}ms`)
    expect(elapsed).toBeLessThan(2000)
  })

  it('attention 按 limit 截断，且列表长度稳定', () => {
    const summary = computeOkrDashboardSummary(largeInput)
    expect(summary.attention.length).toBeLessThanOrEqual(summary.meta.attentionLimit)
  })

  it('selectOkrKpiStrip + deriveOkrDashboardUiStatus 在 20ms 内完成', () => {
    const summary = computeOkrDashboardSummary(largeInput)
    const t0 = performance.now()
    for (let i = 0; i < 100; i += 1) {
      selectOkrKpiStrip(summary)
      deriveOkrDashboardUiStatus({
        isLoading: false,
        error: null,
        summary,
        actorCanView: true,
      })
    }
    const t1 = performance.now()
    const elapsed = t1 - t0
    console.log(`[perf] kpi+status 100× elapsed=${elapsed.toFixed(1)}ms`)
    expect(elapsed).toBeLessThan(2000) // 100 次总和 2s，均值 20ms
  })

  it('buildOkrDashboardModuleRenderProps 在 50ms 内完成', () => {
    const summary = computeOkrDashboardSummary(largeInput)
    const t0 = performance.now()
    const props = buildOkrDashboardModuleRenderProps({
      summary,
      actorCanView: true,
      moduleEmptyStateKey: 'okr-empty',
      attentionLimit: 3,
    })
    const t1 = performance.now()
    const elapsed = t1 - t0
    console.log(`[perf] module render props elapsed=${elapsed.toFixed(1)}ms`)
    expect(elapsed).toBeLessThan(50)
    expect(props.kpis.length).toBeGreaterThan(0)
  })
})
