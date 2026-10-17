import { describe, expect, test } from 'vitest'
import {
  costPayloadHash,
  costStatusFor,
  costSummary,
  emptyPricingView,
  estimateCostForUsage,
  normalizeCost,
  normalizeCurrency,
  rankCandidates,
} from '#services/ai_pricing/model_pricing_service'

/**
 * 模型定价纯逻辑单测（无 DB）。
 *
 * 覆盖 2026-10-01 修复中的三个关键口径：
 * 1. 单价归一化：非法值不静默变 0（否则会把「没填」算成「免费」）；
 * 2. 候选排序：同名/端点/供应商名命中优先，AI 不可用时的确定性回退也走它；
 * 3. 成本状态：算不出成本必须是 cost_unknown，不能冒充 0 元。
 */
describe('model pricing · normalizeCost', () => {
  test('保留合法单价，负数/非数字/空串一律归为 null', () => {
    const cost = normalizeCost({
      input: 0.15,
      output: 0.6,
      cacheRead: -1,
      cacheWrite: 'abc' as unknown as number,
      inputAudio: '' as unknown as number,
      outputAudio: 1.2,
      reasoning: null,
    })
    expect(cost.input).toBe(0.15)
    expect(cost.output).toBe(0.6)
    expect(cost.outputAudio).toBe(1.2)
    expect(cost.cacheRead).toBeNull()
    expect(cost.cacheWrite).toBeNull()
    expect(cost.inputAudio).toBeNull()
    expect(cost.reasoning).toBeNull()
  })

  test('全空视为非法定价并抛错（避免「0 元」假象）', () => {
    expect(() => normalizeCost({})).toThrowError(/至少需要填写一个单价/)
    expect(() => normalizeCost({ input: null, output: null })).toThrowError()
  })

  test('显式 0 是合法价格（免费模型），与「未填」区分', () => {
    const cost = normalizeCost({ input: 0, output: 0 })
    expect(cost.input).toBe(0)
    expect(cost.output).toBe(0)
  })
})

describe('model pricing · normalizeCurrency', () => {
  test('缺省 USD，大小写归一', () => {
    expect(normalizeCurrency(undefined)).toBe('USD')
    expect(normalizeCurrency('')).toBe('USD')
    expect(normalizeCurrency('cny')).toBe('CNY')
  })

  test('非法币种抛错（避免出现「¥ 的数字按 $ 记」）', () => {
    expect(() => normalizeCurrency('人民币')).toThrowError(/3–8 位字母/)
    expect(() => normalizeCurrency('US')).toThrowError()
  })
})

describe('model pricing · costPayloadHash', () => {
  test('同价同币种复用同一指纹，改价必然换指纹', () => {
    const base = normalizeCost({ input: 0.15, output: 0.6 })
    const same = normalizeCost({ input: 0.15, output: 0.6 })
    const other = normalizeCost({ input: 0.15, output: 0.61 })
    expect(costPayloadHash('USD', base)).toBe(costPayloadHash('USD', same))
    expect(costPayloadHash('USD', base)).not.toBe(costPayloadHash('USD', other))
    // 同数字不同币种也不得混用
    expect(costPayloadHash('USD', base)).not.toBe(costPayloadHash('CNY', base))
  })
})

describe('model pricing · rankCandidates', () => {
  const candidates = [
    {
      providerId: 'relay-c',
      modelId: 'vendor-x/vendor-x-model-1',
      api: 'https://api.relay-c.example/v1',
    },
    { providerId: 'vendor-x', modelId: 'vendor-x-model-1', api: 'https://api.vendor-x.example/v1' },
    {
      providerId: 'relay-a',
      modelId: 'relay-a/vendor-x-model-1',
      api: 'https://api.relay-a.example/v1',
    },
    {
      providerId: 'relay-b',
      modelId: 'vendor-x/vendor-x-model-1',
      api: 'https://api.relay-b.example/v1',
    },
  ]

  test('端点精确命中优先（中转站自己的条目排第一）', () => {
    const ranked = rankCandidates(candidates, {
      modelName: 'relay-a/vendor-x-model-1',
      baseUrl: 'https://api.relay-a.example/v1',
    })
    expect(ranked[0]!.providerId).toBe('relay-a')
  })

  test('端点不在目录里时，模型名里出现的那家供应商优先', () => {
    const ranked = rankCandidates(candidates, {
      modelName: 'vendor-x-model-1',
      baseUrl: 'https://api.relay-e.example/v1',
    })
    expect(ranked[0]!.providerId).toBe('vendor-x')
  })

  test('同分时按 provider 名稳定排序（结果可复现）', () => {
    const first = rankCandidates(candidates, { modelName: 'vendor-x/vendor-x-model-1' })
    const second = rankCandidates(candidates, { modelName: 'vendor-x/vendor-x-model-1' })
    expect(first.map((c) => c.providerId)).toEqual(second.map((c) => c.providerId))
  })
})

describe('model pricing · estimateCostForUsage', () => {
  const cost = normalizeCost({ input: 0.15, output: 0.6, cacheRead: 0.003 })

  test('按每 1M token 单价线性计算', () => {
    const estimate = estimateCostForUsage(
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      cost,
      'USD',
    )
    expect(estimate).toBeCloseTo(0.75, 6)
  })

  test('只有输入用量时只算输入', () => {
    expect(estimateCostForUsage({ inputTokens: 2_000_000 }, cost, 'USD')).toBeCloseTo(0.3, 6)
  })

  test('缓存写单价未填时视为包含在基础输入价，不让整笔成本失效', () => {
    expect(
      estimateCostForUsage({ inputTokens: 1_000_000, cacheWriteTokens: 500 }, cost, 'USD'),
    ).toBeCloseTo(0.15, 6)
  })

  test('无定价时返回 null', () => {
    expect(estimateCostForUsage({ inputTokens: 100 }, null, 'USD')).toBeNull()
  })
})

describe('model pricing · costStatusFor', () => {
  test('算得出成本记 estimated，算不出记 cost_unknown', () => {
    expect(costStatusFor(0)).toBe('estimated')
    expect(costStatusFor(1.23)).toBe('estimated')
    expect(costStatusFor(null)).toBe('cost_unknown')
  })
})

describe('model pricing · 展示口径', () => {
  test('costSummary 缺价时明确说明，不打印 0', () => {
    expect(costSummary(null)).toBe('目录未提供价格')
    expect(costSummary(normalizeCost({ input: 0.15, output: 0.6 }))).toContain('输入 0.15')
  })

  test('未定价视图默认 USD 且 hasPricing=false', () => {
    const view = emptyPricingView()
    expect(view.hasPricing).toBe(false)
    expect(view.snapshotId).toBeNull()
    expect(view.approximate).toBe(false)
  })
})
