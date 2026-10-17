/**
 * v3-triz-to-delivery-closed-loop —— §8 advisory 宿主与 AI draft 单测。
 *
 * 覆盖：contribution 校验全矩阵（缺 advisory/未知 capability/命令动词键/
 * forbidden keys/超长内容截断/坏 provenance）、宿主装配隔离（disabled/timeout/
 * oversize/partial 混合降级且好块保留）、AI draft 确定性 fallback
 * （providerCalls=0 / networkCalls=0 断言、无自动判定措辞）。
 */
import { describe, expect, it } from 'vitest'

import {
  assembleTrizDlAdvisories,
  resolveAdvisoryContribution,
  TrizDlAiDraftService,
} from '../../app/services/triz_delivery_loop/advisory_service.js'

const good = {
  advisory: true,
  capability: 'delivery_template',
  version: '1.0.0',
  source: { pluginId: 'triz-pack', provider: 'first_party' },
  content: '建议按矛盾类型拆解交付。',
}

describe('advisory contribution 校验（8.3）', () => {
  it('合法贡献通过并携带 provenance 与 advisory 标记', () => {
    const r = resolveAdvisoryContribution(good)
    expect('block' in r && r.block.provenance).toBe('triz-pack@first_party')
    if ('block' in r) {
      expect(r.block.advisory).toBe(true)
      expect(r.block.capability).toBe('delivery_template')
    }
  })

  it('未知 capability / 非 object / 坏版本 / 缺 source 全部拒绝', () => {
    expect(resolveAdvisoryContribution(null)).toEqual({ reason: 'invalid_output' })
    for (const bad of [
      { ...good, capability: 'auto_apply' },
      { ...good, version: 'not a version!!' },
      { ...good, source: null },
    ]) {
      expect(resolveAdvisoryContribution(bad)).toEqual({ reason: 'invalid_output' })
    }
  })

  it('direct-write 意图（命令动词键）与 forbidden 键拒绝', () => {
    expect(resolveAdvisoryContribution({ ...good, verify: true })).toEqual({
      reason: 'forbidden_content',
    })
    expect(resolveAdvisoryContribution({ ...good, apply: 'all' })).toEqual({
      reason: 'forbidden_content',
    })
    expect(resolveAdvisoryContribution({ ...good, nested: { token: 'x' } })).toEqual({
      reason: 'forbidden_content',
    })
  })

  it('advisory !== true 一律拒绝（防止伪装权威事实）', () => {
    expect(resolveAdvisoryContribution({ ...good, advisory: false })).toEqual({
      reason: 'forbidden_content',
    })
    // biome-ignore：刻意测试错误类型
    const noFlag = { ...good } as Record<string, unknown>
    delete noFlag['advisory']
    expect(resolveAdvisoryContribution(noFlag)).toEqual({ reason: 'forbidden_content' })
  })

  it('超长内容被截断到上限而非拒绝（内容类贡献允许截断+保留）', () => {
    const r = resolveAdvisoryContribution({ ...good, content: 'x'.repeat(5000) })
    if ('block' in r) {
      expect(r.block.content.length).toBeLessThanOrEqual(2000)
    } else {
      throw new Error('应当产出 block')
    }
  })
})

describe('宿主装配隔离（8.4）', () => {
  it('插件停用 → 整区降级 plugin_disabled，零 blocks', () => {
    const r = assembleTrizDlAdvisories([good], {
      pluginEnabled: false,
      timeout: false,
      oversize: false,
    })
    expect(r.available).toBe(false)
    expect(r.degradedReasons).toContain('plugin_disabled')
    expect(r.blocks).toHaveLength(0)
  })

  it('timeout/oversize 只追加 degrade 原因；有效贡献仍可渲染', () => {
    const r = assembleTrizDlAdvisories([good], {
      pluginEnabled: true,
      timeout: true,
      oversize: true,
    })
    expect(r.available).toBe(true)
    expect(r.blocks).toHaveLength(1)
    expect(r.degradedReasons).toEqual(
      expect.arrayContaining(['plugin_timeout', 'payload_oversize']),
    )
  })

  it('混合好坏载荷：坏项逐项降级、好项保留（partial_failure 隔离）', () => {
    const r = assembleTrizDlAdvisories(
      [good, { ...good, capability: 'nonsense' }, { ...good, advisory: false }],
      { pluginEnabled: true, timeout: false, oversize: false },
    )
    expect(r.blocks).toHaveLength(1)
    expect(r.available).toBe(true)
    expect(r.degradedReasons).toContain('invalid_output')
    expect(r.degradedReasons).toContain('forbidden_content')
  })
})

describe('AI draft service（8.5–8.7）', () => {
  it('三类草稿恒为 fallback 且 providerCalls=0 networkCalls=0', () => {
    const svc = new TrizDlAiDraftService()
    for (const t of ['delivery_breakdown', 'metrics_draft', 'retrospective'] as const) {
      const r = svc.generateDraft(
        t,
        {
          decisionLogId: '5',
          posture: 'awaiting_verification',
          conclusion: null,
          visibleDeliveryCount: 2,
        },
        false,
      )
      expect(r.isFallback).toBe(true)
      expect(r.advisory).toBe(true)
      expect(r.costSummary.providerCalls).toBe(0)
      expect(r.costSummary.networkCalls).toBe(0)
      expect(r.costSummary.model).toBeNull()
    }
  })

  it('结论回显只用闭集词面，不产生“已自动判定有效”类措辞', () => {
    const svc = new TrizDlAiDraftService()
    const r = svc.generateDraft(
      'retrospective',
      {
        decisionLogId: '5',
        posture: 'verified_effective',
        conclusion: 'effective',
        visibleDeliveryCount: 1,
      },
      false,
    )
    expect(r.content).toContain('人工验证结论为「effective」')
    expect(r.content).not.toContain('已自动判定')
    expect(r.content).not.toContain('系统判定有效')
  })
})
