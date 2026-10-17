import { describe, expect, it } from 'vitest'
import {
  OVERLAY_PRIORITY,
  describeOverlay,
  overlayRank,
  resolveOverlay,
} from '@/lib/gantt/overlay-priority'
import { getEntryPreset } from '@/lib/gantt/entry-presets'

describe('lib/gantt/overlay-priority（task 4.5/4.6）', () => {
  it('优先级顺序固定：preview > conflict > selectedChain > criticalPath > problemChain > baselineDeviation > dependency > base', () => {
    expect(OVERLAY_PRIORITY).toEqual([
      'preview',
      'conflict',
      'selectedChain',
      'criticalPath',
      'problemChain',
      'baselineDeviation',
      'dependency',
      'base',
    ])
    expect(overlayRank('preview')).toBeLessThan(overlayRank('conflict'))
    expect(overlayRank('conflict')).toBeLessThan(overlayRank('criticalPath'))
    expect(overlayRank('criticalPath')).toBeLessThan(overlayRank('baselineDeviation'))
  })

  it('冲突覆盖普通叠加：同时基线滞后+关键路径+冲突时主样式为 conflict', () => {
    const winner = resolveOverlay(['baselineDeviation', 'criticalPath', 'conflict'])
    expect(winner).toBe('conflict')
  })

  it('preview 优先于冲突（拖拽编辑态最高）', () => {
    expect(resolveOverlay(['conflict', 'preview'])).toBe('preview')
  })

  it('describeOverlay 保留被覆盖的次要状态供详情说明', () => {
    const { primary, secondary } = describeOverlay([
      'baselineDeviation',
      'criticalPath',
      'conflict',
    ])
    expect(primary).toBe('conflict')
    // 详情仍需说明该任务同时属于关键路径与基线滞后。
    expect(secondary).toEqual(['criticalPath', 'baselineDeviation'])
  })

  it('空集合回落 base', () => {
    expect(resolveOverlay([])).toBe('base')
    expect(describeOverlay([])).toEqual({ primary: 'base', secondary: [] })
  })
})

describe('简化入口默认不铺满常规依赖（spec R6 场景）', () => {
  it('simplified preset 隐藏常规依赖且不提供“显示全部依赖”，但关键路径常显', () => {
    const preset = getEntryPreset('simplified')
    expect(preset.dependencyDefault).toBe('hidden')
    expect(preset.offerShowAllDependencies).toBe(false)
    expect(preset.alwaysShowCriticalPath).toBe(true)
  })

  it('standard preset 常规依赖 muted 常显并提供显式开关', () => {
    const preset = getEntryPreset('standard')
    expect(preset.dependencyDefault).toBe('muted')
    expect(preset.offerShowAllDependencies).toBe(true)
  })
})
