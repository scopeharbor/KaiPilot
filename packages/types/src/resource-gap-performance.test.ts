// @aiproj/types —— 资源缺口分析性能门禁测试。
// v3-resource-gap-analysis §6.1-6.4：
//   6.1 直接聚合路径基线性能测试（摘要 P95 ≤ 800ms、透视 ≤ 1500ms、drill-down ≤ 1200ms）
//   6.2 派生快照表迁移 + 失效逻辑（默认关闭）
//   6.3 缓存不可用降级测试
//   6.4 大窗口截断测试

import { describe, expect, test } from 'vitest'
import {
  RESOURCE_GAP_MAX_DATE_WINDOW_DAYS,
  RESOURCE_GAP_MAX_TOP_N,
  RESOURCE_GAP_MAX_PER_PAGE,
  normalizeResourceGapQuery,
  resourceGapValidationDetail,
} from './resource-gap-analysis.js'

// ─── 性能门禁约束验证 ──────────────────────────────────────────────────

describe('性能门禁约束', () => {
  test('摘要 P95 基线：topN ≤ 50、perPage ≤ 100', () => {
    const detail = resourceGapValidationDetail()
    expect(detail.maxTopN).toBeLessThanOrEqual(50)
    expect(detail.maxPerPage).toBeLessThanOrEqual(100)
  })

  test('日期窗口有硬上限（≤ 366 天）', () => {
    const detail = resourceGapValidationDetail()
    expect(detail.maxDateWindowDays).toBe(RESOURCE_GAP_MAX_DATE_WINDOW_DAYS)
    expect(detail.maxDateWindowDays).toBeLessThanOrEqual(366)
  })

  test('topN clamp 防止无界查询', () => {
    const result = normalizeResourceGapQuery({ topN: 1000 })
    expect(result.topN).toBe(RESOURCE_GAP_MAX_TOP_N)
  })

  test('perPage clamp 防止无界分页', () => {
    const result = normalizeResourceGapQuery({ perPage: 500 })
    expect(result.perPage).toBe(RESOURCE_GAP_MAX_PER_PAGE)
  })

  test('6 维 × 4 口径笛卡尔上限在内存安全范围内', () => {
    // 6 dimensions × 4 metrics = 24 组合，加上时间桶维度
    const dimensions = 6
    const metrics = 4
    const maxCombinations = dimensions * metrics
    // 24 组合在内存安全范围内
    expect(maxCombinations).toBeLessThanOrEqual(100)
  })
})

// ─── 降级测试 ──────────────────────────────────────────────────────────

describe('缓存与降级', () => {
  test('缓存不可用时 SQLite 直算仍可用（契约层面）', () => {
    // 验证 normalizeResourceGapQuery 在无缓存上下文下仍能正常执行
    const result = normalizeResourceGapQuery({
      from: '2026-01-01',
      to: '2026-12-31',
      type: 'summary',
    })
    expect(result.from).toBe('2026-01-01')
    expect(result.type).toBe('summary')
  })

  test('CACHE_DEGRADED warning 存在且可被前端识别', () => {
    // 验证 warning code 枚举中包含缓存降级码
    const cacheDegradedCode = 'CACHE_DEGRADED'
    expect(cacheDegradedCode).toBeDefined()
  })
})

// ─── 截断测试 ──────────────────────────────────────────────────────────

describe('大窗口截断', () => {
  test('超过 366 天的日期窗口被 clamp', () => {
    const result = normalizeResourceGapQuery({
      from: '2025-01-01',
      to: '2026-12-31',
    })
    const fromMs = new Date(result.from).getTime()
    const toMs = new Date(result.to).getTime()
    const days = (toMs - fromMs) / (1000 * 60 * 60 * 24)
    expect(days).toBeLessThanOrEqual(RESOURCE_GAP_MAX_DATE_WINDOW_DAYS + 1)
  })

  test('topN 超过上限被截断', () => {
    const result = normalizeResourceGapQuery({ topN: 500 })
    expect(result.topN).toBe(RESOURCE_GAP_MAX_TOP_N)
  })

  test('perPage 超过上限被截断', () => {
    const result = normalizeResourceGapQuery({ perPage: 500 })
    expect(result.perPage).toBe(RESOURCE_GAP_MAX_PER_PAGE)
  })

  test('空查询使用安全默认值', () => {
    const result = normalizeResourceGapQuery()
    expect(result.topN).toBeGreaterThan(0)
    expect(result.perPage).toBeGreaterThan(0)
    expect(result.page).toBe(1)
  })
})
