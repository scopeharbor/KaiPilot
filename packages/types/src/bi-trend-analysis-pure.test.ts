import { describe, expect, test } from 'vitest'
import {
  BI_TREND_WARNING_CODES,
  aggregateBiTrendFreshness,
  biTrendBucketEndDay,
  biTrendBucketStartDay,
  classifyBiTrendDirection,
  computeBiTrendLinearForecast,
  computeBiTrendMovingAverage,
  computeBiTrendPreviousPeriodComparison,
  detectBiTrendAnomalies,
  enumerateBiTrendBuckets,
  normalizeBiTrendBuckets,
  simpleBiTrendHash,
  summarizeBiTrendSeries,
} from './bi-trend-analysis.js'
import type { BiTrendPoint, BiTrendSourceRef } from './bi-trend-analysis.js'

// 纯函数测试（v3-bi-trend-analysis §2.6）：确定性、零 Date.now() 依赖。

const REF = '2026-07-30'

describe('桶化（日/周/月）', () => {
  test('日桶：起止同一日', () => {
    const start = biTrendBucketStartDay('2026-07-15', 'day')
    expect(biTrendBucketEndDay(start, 'day')).toBe(start)
  })

  test('周桶：以周一为起点', () => {
    // 2026-07-15 是周三 → 周一起点 2026-07-13
    const start = biTrendBucketStartDay('2026-07-15', 'week')
    expect(new Date(start * 86400000).toISOString().slice(0, 10)).toBe('2026-07-13')
    // 周日也归到同一周
    const sunday = biTrendBucketStartDay('2026-07-19', 'week')
    expect(sunday).toBe(start)
    // 周一是新桶
    const monday = biTrendBucketStartDay('2026-07-20', 'week')
    expect(monday).toBe(start + 7)
    expect(biTrendBucketEndDay(start, 'week')).toBe(start + 6)
  })

  test('月桶：当月 1 号起，月末止', () => {
    const start = biTrendBucketStartDay('2026-07-15', 'month')
    expect(new Date(start * 86400000).toISOString().slice(0, 10)).toBe('2026-07-01')
    const end = biTrendBucketEndDay(start, 'month')
    expect(new Date(end * 86400000).toISOString().slice(0, 10)).toBe('2026-07-31')
    // 二月（2026 非闰年）
    const febStart = biTrendBucketStartDay('2026-02-10', 'month')
    const febEnd = biTrendBucketEndDay(febStart, 'month')
    expect(new Date(febEnd * 86400000).toISOString().slice(0, 10)).toBe('2026-02-28')
  })

  test('枚举日桶：last_7_days 得到 7 个桶', () => {
    const buckets = enumerateBiTrendBuckets('last_7_days', 'day', REF)
    expect(buckets).toHaveLength(7)
    expect(buckets[0].bucketStart).toBe('2026-07-24')
    expect(buckets[6].bucketEnd).toBe('2026-07-30')
  })

  test('枚举周桶：last_12_weeks 得到 12 个桶', () => {
    const buckets = enumerateBiTrendBuckets('last_12_weeks', 'week', REF)
    expect(buckets).toHaveLength(12)
    expect(buckets[11].bucketEnd >= REF).toBe(true)
  })

  test('枚举月桶：last_6_months 得到 6 个桶', () => {
    const buckets = enumerateBiTrendBuckets('last_6_months', 'month', REF)
    expect(buckets).toHaveLength(6)
    expect(buckets[5].bucketStart).toBe('2026-07-01')
  })
})

describe('缺失桶标记与同桶聚合', () => {
  test('稀疏数据补齐缺失桶，缺失桶 value=null', () => {
    const points = normalizeBiTrendBuckets(
      [
        { date: '2026-07-25', value: 10 },
        { date: '2026-07-29', value: 20 },
      ],
      'last_7_days',
      'day',
      REF,
    )
    expect(points).toHaveLength(7)
    const missing = points.filter((p) => p.missing)
    expect(missing).toHaveLength(5)
    expect(missing[0].value).toBeNull()
    const present = points.filter((p) => !p.missing)
    expect(present.map((p) => p.value)).toEqual([10, 20])
  })

  test('同桶多点按样本数加权平均', () => {
    const points = normalizeBiTrendBuckets(
      [
        { date: '2026-07-28', value: 10, sampleCount: 1 },
        { date: '2026-07-28', value: 20, sampleCount: 3 },
      ],
      'last_7_days',
      'day',
      REF,
    )
    const p = points.find((pt) => pt.bucketStart === '2026-07-28')
    expect(p?.value).toBeCloseTo((10 * 1 + 20 * 3) / 4)
    expect(p?.sampleCount).toBe(4)
  })

  test('周粒度窗口：last_7_days/week 只有 reference 所在的 1 个周桶', () => {
    const points = normalizeBiTrendBuckets(
      [{ date: '2026-07-13', value: 5 }],
      'last_7_days',
      'week',
      REF,
    )
    // 桶数 = round(7/7) = 1，桶为 2026-07-27 所在周；窗口外数据被丢弃
    expect(points).toHaveLength(1)
    expect(points[0].bucketStart).toBe('2026-07-27')
    expect(points[0].missing).toBe(true)
  })
})

describe('移动平均', () => {
  const mk = (values: (number | null)[]): BiTrendPoint[] =>
    values.map((v, i) => ({
      bucketStart: `2026-07-${String(i + 1).padStart(2, '0')}`,
      bucketEnd: `2026-07-${String(i + 1).padStart(2, '0')}`,
      value: v,
      missing: v === null,
      sampleCount: v === null ? 0 : 1,
    }))

  test('窗口=3 的移动平均，跳过缺失桶', () => {
    const ma = computeBiTrendMovingAverage(mk([3, 6, 9, 12]))
    expect(ma[0]).toBe(3)
    expect(ma[1]).toBe(4.5)
    expect(ma[2]).toBe(6)
    expect(ma[3]).toBe(9)
  })

  test('全部缺失时返回 null', () => {
    const ma = computeBiTrendMovingAverage(mk([null, null]))
    expect(ma).toEqual([null, null])
  })

  test('缺失桶参与窗口但不参与均值', () => {
    const ma = computeBiTrendMovingAverage(mk([2, null, 4]))
    expect(ma[2]).toBe(3)
  })
})

describe('上期对比与方向判定', () => {
  const mk = (values: number[]): BiTrendPoint[] =>
    values.map((v, i) => ({
      bucketStart: `2026-07-${String(i + 1).padStart(2, '0')}`,
      bucketEnd: `2026-07-${String(i + 1).padStart(2, '0')}`,
      value: v,
      missing: false,
      sampleCount: 1,
    }))

  test('上升趋势：up + deltaRatio > 0', () => {
    const cmp = computeBiTrendPreviousPeriodComparison(mk([10, 10, 20, 20]))
    expect(cmp).not.toBeNull()
    expect(cmp?.previousAverage).toBe(10)
    expect(cmp?.currentAverage).toBe(20)
    expect(cmp?.delta).toBe(10)
    expect(cmp?.deltaRatio).toBeCloseTo(1)
    expect(classifyBiTrendDirection(cmp)).toBe('up')
  })

  test('下降趋势：down', () => {
    const cmp = computeBiTrendPreviousPeriodComparison(mk([20, 20, 10, 10]))
    expect(classifyBiTrendDirection(cmp)).toBe('down')
  })

  test('平稳趋势：flat（变化率 ≤ 5%）', () => {
    const cmp = computeBiTrendPreviousPeriodComparison(mk([100, 100, 102, 102]))
    expect(classifyBiTrendDirection(cmp)).toBe('flat')
  })

  test('历史不足：comparison 为 null，方向 unknown', () => {
    const cmp = computeBiTrendPreviousPeriodComparison(mk([10, 20]))
    expect(cmp).toBeNull()
    expect(classifyBiTrendDirection(cmp)).toBe('unknown')
  })

  test('上期为 0：deltaRatio 为 null，用绝对变化兜底', () => {
    const cmp = computeBiTrendPreviousPeriodComparison(mk([0, 0, 5, 5]))
    expect(cmp?.deltaRatio).toBeNull()
    expect(classifyBiTrendDirection(cmp)).toBe('up')
  })
})

describe('异常点检测', () => {
  const mk = (values: number[]): BiTrendPoint[] =>
    values.map((v, i) => ({
      bucketStart: `2026-07-${String(i + 1).padStart(2, '0')}`,
      bucketEnd: `2026-07-${String(i + 1).padStart(2, '0')}`,
      value: v,
      missing: false,
      sampleCount: 1,
    }))

  test('显著尖峰被标注为 above 异常', () => {
    // 9 个 10 + 1 个 100：std ≈ 28.5，z ≈ 3.16 > 2.5
    const anomalies = detectBiTrendAnomalies(mk([10, 10, 10, 10, 10, 10, 10, 10, 10, 100]))
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0].value).toBe(100)
    expect(anomalies[0].direction).toBe('above')
    expect(anomalies[0].threshold).toBe(2.5)
    expect(anomalies[0].bucketStart).toBe('2026-07-10')
  })

  test('恒定序列无异常（std=0）', () => {
    expect(detectBiTrendAnomalies(mk([5, 5, 5, 5, 5]))).toHaveLength(0)
  })

  test('样本 <3 不检测', () => {
    expect(detectBiTrendAnomalies(mk([1, 100]))).toHaveLength(0)
  })

  test('缺失桶不参与异常检测', () => {
    const points = mk([10, 10, 10, 10, 10, 10, 10, 10, 10, 100])
    points[9].missing = true
    points[9].value = null
    expect(detectBiTrendAnomalies(points)).toHaveLength(0)
  })
})

describe('短期线性外推', () => {
  const mk = (values: number[]): BiTrendPoint[] =>
    values.map((v, i) => ({
      bucketStart: `2026-07-${String(i + 1).padStart(2, '0')}`,
      bucketEnd: `2026-07-${String(i + 1).padStart(2, '0')}`,
      value: v,
      missing: false,
      sampleCount: 1,
    }))

  test('线性序列外推延续斜率', () => {
    const forecast = computeBiTrendLinearForecast(mk([10, 20, 30, 40, 50, 60]), 'day', 2)
    expect(forecast.suppressed).toBe(false)
    expect(forecast.points).toHaveLength(2)
    expect(forecast.points[0].value).toBeCloseTo(70)
    expect(forecast.points[1].value).toBeCloseTo(80)
    expect(forecast.points[0].bucketStart).toBe('2026-07-07')
  })

  test('历史不足时 suppressed 且不产出点', () => {
    const forecast = computeBiTrendLinearForecast(mk([10, 20, 30]), 'day')
    expect(forecast.suppressed).toBe(true)
    expect(forecast.points).toHaveLength(0)
    expect(forecast.suppressionReason).toBe(BI_TREND_WARNING_CODES.INSUFFICIENT_HISTORY)
  })

  test('月粒度外推跨月正确', () => {
    const points: BiTrendPoint[] = [
      {
        bucketStart: '2026-05-01',
        bucketEnd: '2026-05-31',
        value: 10,
        missing: false,
        sampleCount: 1,
      },
      {
        bucketStart: '2026-06-01',
        bucketEnd: '2026-06-30',
        value: 20,
        missing: false,
        sampleCount: 1,
      },
      {
        bucketStart: '2026-07-01',
        bucketEnd: '2026-07-31',
        value: 30,
        missing: false,
        sampleCount: 1,
      },
      {
        bucketStart: '2026-08-01',
        bucketEnd: '2026-08-31',
        value: 40,
        missing: false,
        sampleCount: 1,
      },
      {
        bucketStart: '2026-09-01',
        bucketEnd: '2026-09-30',
        value: 50,
        missing: false,
        sampleCount: 1,
      },
      {
        bucketStart: '2026-10-01',
        bucketEnd: '2026-10-31',
        value: 60,
        missing: false,
        sampleCount: 1,
      },
    ]
    const forecast = computeBiTrendLinearForecast(points, 'month', 2)
    expect(forecast.suppressed).toBe(false)
    expect(forecast.points[0].bucketStart).toBe('2026-11-01')
    expect(forecast.points[1].bucketStart).toBe('2026-12-01')
  })
})

describe('响应摘要计算', () => {
  const freshness = aggregateBiTrendFreshness([
    {
      sourceKind: 'organization_dashboard',
      metricVersion: 'org-dash-v1',
      lastRefreshedAt: '2026-07-30T00:00:00.000Z',
      state: 'fresh',
    },
  ] satisfies BiTrendSourceRef[])

  test('空历史：INSUFFICIENT_HISTORY，方向 unknown，不编造趋势', () => {
    const points = normalizeBiTrendBuckets([], 'last_7_days', 'day', REF)
    const series = summarizeBiTrendSeries({
      metricKey: 'project_progress',
      grain: 'day',
      window: 'last_7_days',
      points,
      freshness,
      includeForecast: true,
    })
    expect(series.sampleCount).toBe(0)
    expect(series.direction).toBe('unknown')
    expect(series.warnings.map((w) => w.code)).toContain('INSUFFICIENT_HISTORY')
    expect(series.forecast?.suppressed).toBe(true)
    expect(series.warnings.map((w) => w.code)).toContain('FORECAST_SUPPRESSED')
  })

  test('正常序列：方向/移动平均/异常/外推齐备', () => {
    const raw = Array.from({ length: 7 }, (_, i) => ({
      date: `2026-07-${String(24 + i).padStart(2, '0')}`,
      value: 10 + i * 10,
    }))
    const points = normalizeBiTrendBuckets(raw, 'last_7_days', 'day', REF)
    const series = summarizeBiTrendSeries({
      metricKey: 'okr_progress',
      grain: 'day',
      window: 'last_7_days',
      points,
      freshness,
      includeAnomalies: true,
      includeForecast: true,
      compareWith: 'previous_period',
    })
    expect(series.direction).toBe('up')
    expect(series.movingAverage).toHaveLength(7)
    expect(series.comparison?.deltaRatio).toBeGreaterThan(0)
    expect(series.forecast?.suppressed).toBe(false)
    expect(series.sampleCount).toBe(7)
    expect(series.metricVersion).toBe('bi-trend-v1')
  })

  test('部分缺失：MISSING_BUCKETS warning', () => {
    const raw = [
      { date: '2026-07-24', value: 10 },
      { date: '2026-07-26', value: 20 },
      { date: '2026-07-28', value: 30 },
    ]
    const points = normalizeBiTrendBuckets(raw, 'last_7_days', 'day', REF)
    const series = summarizeBiTrendSeries({
      metricKey: 'risk_pressure',
      grain: 'day',
      window: 'last_7_days',
      points,
      freshness,
    })
    expect(series.warnings.map((w) => w.code)).toContain('MISSING_BUCKETS')
  })
})

describe('freshness 聚合与低敏哈希', () => {
  test('多来源取最差状态', () => {
    const f = aggregateBiTrendFreshness([
      {
        sourceKind: 'organization_dashboard',
        metricVersion: 'v1',
        lastRefreshedAt: '2026-07-30T00:00:00Z',
        state: 'fresh',
      },
      { sourceKind: 'risk_register', metricVersion: 'v1', lastRefreshedAt: null, state: 'unknown' },
    ])
    expect(f.state).toBe('unknown')
    expect(f.sourceCoverage).toBe(0.5)
  })

  test('空来源：unknown + no-sources 哈希', () => {
    const f = aggregateBiTrendFreshness([])
    expect(f.state).toBe('unknown')
    expect(f.freshnessHash).toBe('no-sources')
  })

  test('哈希确定性且不含原始内容', () => {
    const h1 = simpleBiTrendHash('a:b:c')
    const h2 = simpleBiTrendHash('a:b:c')
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^fnv1a-[0-9a-f]+$/)
    expect(h1).not.toContain('a:b:c')
  })
})
