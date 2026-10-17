/**
 * BI 聚合前端 API/Hooks/Helper 测试（v3-bi-data-aggregation-service §7.4）。
 * 覆盖 query serialization、stable key、success/error envelope、
 * forbidden/redacted/stale/degraded/unsupported 状态和未授权下钻链接过滤。
 */
import { describe, it, expect } from 'vitest'
import { biAggregationKeys, parseBiAggregationError } from '@/lib/api/bi-aggregation'
import {
  getBiAggregationRenderState,
  getBiAggregationFreshnessLabel,
  getBiAggregationFreshnessColor,
  getBiAggregationWarningSummary,
  filterAuthorizedBiAggregationLinks,
} from '@/components/bi-aggregation/status-helpers'

describe('BiAggregation API Client — Query Keys', () => {
  it('生成稳定 query key', () => {
    const key1 = biAggregationKeys.aggregation(1, { metricKeys: ['a', 'b'] })
    const key2 = biAggregationKeys.aggregation(1, { metricKeys: ['a', 'b'] })
    expect(key1).toEqual(key2)
  })

  it('不同 organizationId 生成不同 key', () => {
    const key1 = biAggregationKeys.aggregation(1, {})
    const key2 = biAggregationKeys.aggregation(2, {})
    expect(key1).not.toEqual(key2)
  })

  it('key 包含 organization/bi/aggregations 路径', () => {
    const key = biAggregationKeys.aggregation(1, {})
    expect(key).toContain('bi')
    expect(key).toContain('aggregations')
  })
})

describe('BiAggregation — Error 解析', () => {
  it('解析标准错误信封', () => {
    const error = { error: { code: 'VALIDATION_ERROR', message: '参数格式不正确' } }
    const parsed = parseBiAggregationError(error)
    expect(parsed.code).toBe('VALIDATION_ERROR')
    expect(parsed.message).toBe('参数格式不正确')
  })

  it('未知错误返回 UNKNOWN', () => {
    const parsed = parseBiAggregationError(new Error('network'))
    expect(parsed.code).toBe('UNKNOWN')
  })
})

describe('BiAggregation — Render State', () => {
  it('loading 状态', () => {
    const state = getBiAggregationRenderState({ isLoading: true, isError: false, data: null })
    expect(state).toBe('loading')
  })

  it('error 状态', () => {
    const state = getBiAggregationRenderState({ isLoading: false, isError: true, data: null })
    expect(state).toBe('error')
  })

  it('无数据 empty 状态', () => {
    const state = getBiAggregationRenderState({ isLoading: false, isError: false, data: null })
    expect(state).toBe('empty')
  })

  it('unsupported metric warning → unsupported', () => {
    const state = getBiAggregationRenderState({
      isLoading: false,
      isError: false,
      data: {
        warnings: [{ code: 'UNSUPPORTED_METRIC', level: 'blocking', message: '不支持的指标' }],
        provenance: { redaction: { state: 'none' } },
      },
    })
    expect(state).toBe('unsupported')
  })

  it('source forbidden → forbidden', () => {
    const state = getBiAggregationRenderState({
      isLoading: false,
      isError: false,
      data: {
        warnings: [{ code: 'SOURCE_FORBIDDEN', level: 'warning', message: '无权限' }],
        provenance: { redaction: { state: 'none' } },
      },
    })
    expect(state).toBe('forbidden')
  })

  it('full redaction → redacted', () => {
    const state = getBiAggregationRenderState({
      isLoading: false,
      isError: false,
      data: {
        warnings: [],
        provenance: { redaction: { state: 'full' } },
      },
    })
    expect(state).toBe('redacted')
  })

  it('stale warning → stale', () => {
    const state = getBiAggregationRenderState({
      isLoading: false,
      isError: false,
      data: {
        warnings: [{ code: 'STALE_SOURCE', level: 'warning', message: '已过期' }],
        provenance: { redaction: { state: 'none' } },
      },
    })
    expect(state).toBe('stale')
  })

  it('cache degraded → degraded', () => {
    const state = getBiAggregationRenderState({
      isLoading: false,
      isError: false,
      data: {
        warnings: [{ code: 'CACHE_DEGRADED', level: 'info', message: '缓存降级' }],
        provenance: { redaction: { state: 'none' } },
      },
    })
    expect(state).toBe('degraded')
  })

  it('正常数据 success', () => {
    const state = getBiAggregationRenderState({
      isLoading: false,
      isError: false,
      data: {
        warnings: [],
        provenance: { redaction: { state: 'none' } },
      },
    })
    expect(state).toBe('success')
  })
})

describe('BiAggregation — Freshness Labels', () => {
  it('fresh → 实时, green', () => {
    expect(getBiAggregationFreshnessLabel('fresh')).toBe('实时')
    expect(getBiAggregationFreshnessColor('fresh')).toBe('#22c55e')
  })

  it('stale → 已过期, amber', () => {
    expect(getBiAggregationFreshnessLabel('stale')).toBe('已过期')
    expect(getBiAggregationFreshnessColor('stale')).toBe('#f59e0b')
  })

  it('unavailable → 不可用, red', () => {
    expect(getBiAggregationFreshnessLabel('unavailable')).toBe('不可用')
    expect(getBiAggregationFreshnessColor('unavailable')).toBe('#ef4444')
  })

  it('degraded → 降级, amber', () => {
    expect(getBiAggregationFreshnessLabel('degraded')).toBe('降级')
    expect(getBiAggregationFreshnessColor('degraded')).toBe('#f59e0b')
  })

  it('unknown → 未知, gray', () => {
    expect(getBiAggregationFreshnessLabel('unknown')).toBe('未知')
    expect(getBiAggregationFreshnessColor('unknown')).toBe('#9ca3af')
  })
})

describe('BiAggregation — Warning Summary', () => {
  it('空 warnings 返回空字符串', () => {
    expect(getBiAggregationWarningSummary([])).toBe('')
  })

  it('单个 warning 返回中文摘要', () => {
    const summary = getBiAggregationWarningSummary([
      { code: 'STALE_SOURCE', level: 'warning', message: '过期' },
    ])
    expect(summary).toContain('过期')
  })

  it('多个 warning 去重合并', () => {
    const summary = getBiAggregationWarningSummary([
      { code: 'STALE_SOURCE', level: 'warning', message: '过期1' },
      { code: 'STALE_SOURCE', level: 'warning', message: '过期2' },
      { code: 'SOURCE_UNAVAILABLE', level: 'warning', message: '不可用' },
    ])
    expect(summary).toContain('过期')
    expect(summary).toContain('不可用')
  })
})

describe('BiAggregation — Link 过滤', () => {
  it('过滤未授权链接', () => {
    const evidence = [
      { authorized: true, targetType: 'project', refId: 'p1' },
      { authorized: false, targetType: 'okr', refId: 'o_secret' },
      { authorized: true, targetType: 'risk', refId: 'r1' },
    ]
    const filtered = filterAuthorizedBiAggregationLinks(evidence)
    expect(filtered).toHaveLength(2)
    // 未授权的 okr 链接必须被剔除；原断言写成 toBe(false)，
    // 即「泄露了才算通过」，与脱敏红线相反。
    expect(filtered.every((f) => f.targetType !== 'okr')).toBe(true)
    expect(filtered.map((f) => f.refId)).not.toContain('o_secret')
  })

  it('空 refId 也被过滤', () => {
    const evidence = [{ authorized: true, targetType: 'project', refId: '' }]
    const filtered = filterAuthorizedBiAggregationLinks(evidence)
    expect(filtered).toHaveLength(0)
  })
})
