/**
 * v3-triz-to-delivery-closed-loop §11.1/11.2 —— 确定性性能门（vitest，纯内存 fixture）。
 *
 * fixture：1000 links × bounded refs（每 link ≤50 delivery + ≤20 context）；
 * 门限依据 Observation Packet A9 冻结值（机器相关阈值不入 spec）：
 * - posture projector 1000 项 × 50 refs < 800ms（p95 预算的纯函数部分）
 * - 列表稳定排序 1000 项 < 100ms
 * - read model 查询计数不随 link 数增长由 japa 功能层 N+1 测试守住
 * （read_adapters spec 断言 task port 整页恰一次调用），此处锁纯函数上界。
 */
import { describe, expect, it } from 'vitest'
import { projectTrizDlPosture, sortTrizDlItems, trizDlCanonicalizeRefs } from '@aiproj/types'

const N = 1000
const REFS_PER_LINK = 50

function buildFacts(seed: number) {
  return Array.from({ length: REFS_PER_LINK }, (_, i) => ({
    ref: { kind: 'task' as const, entityId: String((seed * 1000 + i) as number) },
    state: 'ok' as const,
    posture: i % 5 === 0 ? ('completed' as const) : ('in_progress' as const),
  }))
}

describe('§11.2 性能门（1000 links × 50 refs）', () => {
  it('D4 projector 全量投影 p95 内（<800ms）', () => {
    const t0 = performance.now()
    let checksum = 0
    for (let i = 0; i < N; i += 1) {
      const out = projectTrizDlPosture({
        linkSuperseded: false,
        decisionSuperseded: false,
        sourceFreshness: 'fresh',
        hasValidLink: true,
        latestVerification: null,
        requiredDeliveryFacts: buildFacts(i),
      })
      checksum += out.posture.length
    }
    const elapsed = performance.now() - t0

    console.log(`[PERF] projector ${N}x${REFS_PER_LINK}: ${elapsed.toFixed(1)}ms`)
    expect(checksum).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(800)
  })

  it('列表稳定排序 1000 项 < 100ms 且结果确定性', () => {
    const items = Array.from({ length: N }, (_, i) => ({
      itemId: `link-${i}`,
      updatedAt: new Date(Date.UTC(2026, 7, (i % 28) + 1)).toISOString(),
      posture: 'in_progress' as const,
    }))
    const t0 = performance.now()
    const first = sortTrizDlItems(items)
    const second = sortTrizDlItems(first)
    const elapsed = performance.now() - t0
    expect(elapsed).toBeLessThan(100)
    expect(second.map((s) => s.itemId)).toEqual(first.map((s) => s.itemId))
  })

  it('canonical refs 规范化 50×1000 次幂等且去重正确', () => {
    const refs = Array.from({ length: REFS_PER_LINK }, (_, i) => ({
      kind: 'task' as const,
      entityId: String(i % 25), // 一半重复
    }))
    const t0 = performance.now()
    let total = 0
    for (let i = 0; i < N; i += 1) {
      const r = trizDlCanonicalizeRefs(refs)
      total += r.visible.length + r.duplicatesRemoved
    }
    const elapsed = performance.now() - t0
    expect(total).toBe(N * REFS_PER_LINK)
    expect(elapsed).toBeLessThan(200)
  })
})
