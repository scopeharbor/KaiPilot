/**
 * 图表馆 TRIZ 分馆目录与注册表用例（v3-triz-contradiction-copilot W7 · tasks 7.1）。
 *
 * 覆盖：
 * - 既有 20 项经典 PM 图表条数、tier、status、badge 与镜头行为零变化断言；
 * - 新增 TRIZ 独立领域与四件定义（矛盾矩阵 / 九屏幕 / 功能分析 / 进化 S 曲线）；
 * - 静态白名单注册（RL-14），无运行时动态注册；
 * - 未知件标识中性回退（getChartLensEntry 返回 undefined，不抛错不白屏）。
 */
import { describe, expect, test } from 'vitest'
import {
  CHART_DOMAINS,
  CHART_DOMAIN_LABELS,
  CLASSIC_PM_CHART_DEFINITIONS,
  PM_CHART_DEFINITIONS,
  TRIZ_CHART_DEFINITIONS,
  getChartDefinition,
  isAvailableChartId,
  isComingSoonChartId,
} from '@/lib/next/charts/chart-catalog-metadata'
import {
  CHART_LENS_REGISTRY,
  getChartLensEntry,
  isChartLensId,
} from '@/components/next/charts/chart-lens-registry'

describe('7.1 图表馆 TRIZ 分馆目录与注册表静态契约', () => {
  test('既有 20 项经典 PM 图表：批 G4 收口后全量已就绪，条数/顺序恒定', () => {
    expect(CLASSIC_PM_CHART_DEFINITIONS).toHaveLength(20)

    const availableClassic = CLASSIC_PM_CHART_DEFINITIONS.filter((d) => d.status === 'available')
    const comingSoonClassic = CLASSIC_PM_CHART_DEFINITIONS.filter((d) => d.status === 'coming-soon')

    // 批 G4（v3-chart-gallery-tier2-org-contract-plans）收口：20 项全量已就绪，即将上线归零
    expect(availableClassic).toHaveLength(20)
    expect(comingSoonClassic).toHaveLength(0)

    // 20 项已就绪清单与顺序恒定（含批 G4 新增 charter/communication/obs）
    const expectedTier1Ids = [
      'resource-load',
      'risk-register',
      'aon-network',
      'milestone-timeline',
      'fishbone',
      'rbs',
      'scatter-plot',
      'kanban',
      'charter',
      'rtm',
      'raci',
      'issues',
      'stakeholder',
      'communication',
      'evm',
      'lob',
      'burndown',
      'pareto',
      'obs',
      'control-chart',
    ]
    expect(availableClassic.map((d) => d.id)).toEqual(expectedTier1Ids)

    // 即将上线分组彻底归零
    const expectedTier2Ids: string[] = []
    expect(comingSoonClassic.map((d) => d.id)).toEqual(expectedTier2Ids)

    // 经典 20 项徽标文案一致
    availableClassic.forEach((d) => {
      expect(d.badge).toBe('已就绪')
      expect(d.tier).toBe(1)
    })
    comingSoonClassic.forEach((d) => {
      expect(d.badge).toBe('即将上线')
      expect(d.tier).toBe(2)
      expect(d.upcoming).toBeDefined()
    })
  })

  test('TRIZ 独立领域与四件定义：全量 24 项，四件均已就绪且元数据完备', () => {
    // 领域定义与中文标签映射
    expect(CHART_DOMAINS.some((d) => d.id === 'triz' && d.label === 'TRIZ创新')).toBe(true)
    expect(CHART_DOMAIN_LABELS.triz).toBe('TRIZ创新')

    // 总量 24 项
    expect(PM_CHART_DEFINITIONS).toHaveLength(24)
    expect(TRIZ_CHART_DEFINITIONS).toHaveLength(4)

    const expectedTriz = [
      {
        id: 'triz-contradiction-matrix',
        title: 'TRIZ 矛盾矩阵',
        subtitle: 'Contradiction Matrix',
        interactionMode: 'editable',
        exportViewLabel: 'TRIZ矛盾矩阵',
      },
      {
        id: 'triz-nine-windows',
        title: '九屏幕法',
        subtitle: '9-Screen Diagram',
        interactionMode: 'editable',
        exportViewLabel: '九屏幕分析图',
      },
      {
        id: 'triz-function-analysis',
        title: '功能分析图',
        subtitle: 'Function Analysis',
        interactionMode: 'editable',
        exportViewLabel: '功能分析图',
      },
      {
        id: 'triz-evolution-scurve',
        title: '进化 S 曲线',
        subtitle: 'Evolution S-Curve',
        interactionMode: 'readonly',
        exportViewLabel: '进化S曲线',
      },
    ]

    expectedTriz.forEach((item) => {
      const def = getChartDefinition(item.id)
      expect(def).toBeDefined()
      expect(def?.title).toBe(item.title)
      expect(def?.subtitle).toBe(item.subtitle)
      expect(def?.domain).toBe('triz')
      expect(def?.tier).toBe(1)
      expect(def?.status).toBe('available')
      expect(def?.badge).toBe('已就绪')
      expect(def?.description).toBeTruthy()
      expect(def?.tags.length).toBeGreaterThan(0)
      expect(isAvailableChartId(item.id)).toBe(true)

      // 镜头注册表静态白名单匹配
      expect(isChartLensId(item.id)).toBe(true)
      const entry = getChartLensEntry(item.id)
      expect(entry).toBeDefined()
      expect(entry?.chartId).toBe(item.id)
      expect(entry?.exportViewLabel).toBe(item.exportViewLabel)
      expect(entry?.interactionMode).toBe(item.interactionMode)
      expect(typeof entry?.component).toBe('function')
    })
  })

  test('RL-14 静态白名单防御：总注册镜头数为 23 项（19 经典 + 4 TRIZ，kanban 重定向不入册），无运行时动态注入', () => {
    const lensKeys = Object.keys(CHART_LENS_REGISTRY)
    expect(lensKeys).toHaveLength(23)
    expect(lensKeys).toEqual([
      'resource-load',
      'risk-register',
      'aon-network',
      'milestone-timeline',
      'fishbone',
      'rbs',
      'scatter-plot',
      'triz-contradiction-matrix',
      'triz-nine-windows',
      'triz-function-analysis',
      'triz-evolution-scurve',
      'evm',
      'burndown',
      'control-chart',
      'pareto',
      'lob',
      'raci',
      'rtm',
      'stakeholder',
      'issues',
      'obs',
      'charter',
      'communication',
    ])
  })

  test('未知件标识中性回退：返回 undefined 与 false，天然安全不报错不白屏', () => {
    const unknownId = 'triz-unknown-method-lens'
    expect(getChartDefinition(unknownId)).toBeUndefined()
    expect(isAvailableChartId(unknownId)).toBe(false)
    expect(isComingSoonChartId(unknownId)).toBe(false)
    expect(isChartLensId(unknownId)).toBe(false)
    expect(getChartLensEntry(unknownId)).toBeUndefined()
  })
})
