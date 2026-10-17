/**
 * v3-triz-to-delivery-closed-loop —— 共享契约测试（task 2.8）。
 *
 * 覆盖：枚举闭集、DTO bounds、digest/fingerprint 可复现、D4 posture 全矩阵、
 * sanitizer、hidden-count 排除与 fixture consistency。零网络零 provider。
 */
import { describe, expect, it } from 'vitest'

import {
  TRIZ_DL_CONTEXT_KINDS,
  TRIZ_DL_DEGRADED_REASONS,
  TRIZ_DL_ENTITY_KINDS,
  TRIZ_DL_EVENT_KINDS,
  TRIZ_DL_MAX_REQUIRED_DELIVERY_REFS,
  TRIZ_DL_POSTURES,
  TRIZ_DL_REQUIRED_DELIVERY_KINDS,
  TRIZ_DL_VERIFICATION_CONCLUSIONS,
  TRIZ_DL_WARNING_CODES,
  projectTrizDlPosture,
  sanitizeTrizDlText,
  scanTrizDlForbiddenKeys,
  sortTrizDlItems,
  trizDlCanonicalizeRefs,
  trizDlComputeEventDigest,
  trizDlComputeLinkDigest,
  trizDlComputePreviewFingerprint,
  trizDlComputeVerificationFingerprint,
  trizDlStableSerialize,
  truncateTrizDlRefs,
  validateTrizDlClosedLoopItemBounds,
  filterHiddenTrizDlEntities,
} from './triz-to-delivery-closed-loop.js'
import type { TrizDlClosedLoopItem, TrizDlProjectionInput } from './triz-to-delivery-closed-loop.js'
import {
  buildTrizDlEntitySummaryFixtures,
  buildTrizDlFixtureItems,
  buildTrizDlLegacyUnlinkedItem,
  trizDlFixtureDigestPair,
} from './triz-to-delivery-closed-loop.fixtures.js'

// ---------------------------------------------------------------------------
// 枚举闭集
// ---------------------------------------------------------------------------

describe('枚举闭集', () => {
  it('posture 词表恰为 D4 九态且无多余值', () => {
    expect([...TRIZ_DL_POSTURES].sort()).toEqual(
      [
        'awaiting_apply',
        'awaiting_verification',
        'blocked',
        'delivery_linked',
        'in_progress',
        'source_stale',
        'superseded',
        'verified_effective',
        'verified_ineffective',
      ].sort(),
    )
  })

  it('required/context kind 划分与实体闭集一致', () => {
    expect([...TRIZ_DL_ENTITY_KINDS].sort()).toEqual(
      ['change_request', 'milestone', 'risk', 'task'].sort(),
    )
    for (const k of TRIZ_DL_REQUIRED_DELIVERY_KINDS) {
      expect(TRIZ_DL_ENTITY_KINDS).toContain(k)
    }
    for (const k of TRIZ_DL_CONTEXT_KINDS) {
      expect(TRIZ_DL_ENTITY_KINDS).toContain(k)
      expect(TRIZ_DL_REQUIRED_DELIVERY_KINDS).not.toContain(k)
    }
  })

  it('event / conclusion / warning / degraded 词表非空且封闭引用一致', () => {
    expect(TRIZ_DL_EVENT_KINDS).toContain('verification_recorded')
    expect(TRIZ_DL_EVENT_KINDS).toContain('verification_superseded')
    expect(TRIZ_DL_EVENT_KINDS).toContain('reopen_requested')
    expect(TRIZ_DL_VERIFICATION_CONCLUSIONS).toEqual(['effective', 'ineffective', 'inconclusive'])
    expect(TRIZ_DL_WARNING_CODES.length).toBeGreaterThan(5)
    expect(TRIZ_DL_DEGRADED_REASONS).toContain('plugin_timeout')
    expect(TRIZ_DL_DEGRADED_REASONS).not.toContain('automatic_success' as never)
  })
})

// ---------------------------------------------------------------------------
// digest / fingerprint 可复现性
// ---------------------------------------------------------------------------

describe('digest 与 fingerprint', () => {
  const base = {
    organizationId: 1,
    projectId: 10,
    decisionLogId: 'dec-1',
    linkMode: 'apply_receipt' as const,
    deliveryRefs: [
      { kind: 'task' as const, entityId: '2001' },
      { kind: 'milestone' as const, entityId: '1001' },
    ],
  }

  it('同输入恒同输出（可复现）', () => {
    const a = trizDlComputeLinkDigest(base)
    const b = trizDlComputeLinkDigest({ ...base })
    expect(a).toBe(b)
  })

  it('refs 顺序无关（规范化排序）', () => {
    expect(
      trizDlComputeLinkDigest({
        ...base,
        deliveryRefs: [...base.deliveryRefs].reverse(),
      }),
    ).toBe(trizDlComputeLinkDigest(base))
  })

  it('任一输入变化改变 digest', () => {
    const baseDigest = trizDlComputeLinkDigest(base)
    expect(trizDlComputeLinkDigest({ ...base, decisionLogId: 'dec-2' })).not.toBe(baseDigest)
    expect(
      trizDlComputeLinkDigest({ ...base, deliveryRefs: [{ kind: 'task', entityId: '9999' }] }),
    ).not.toBe(baseDigest)
    expect(
      trizDlComputeLinkDigest({
        ...base,
        contextRefs: [{ kind: 'risk', entityId: '51' }],
      }),
    ).not.toBe(baseDigest)
  })

  it('跨组织分域：同 refs 不同 org 得到不同 digest（fixture 一致）', () => {
    const [orgA, orgB] = trizDlFixtureDigestPair()
    expect(orgA).not.toBe(orgB)
  })

  it('preview/verification/event 指纹同输入稳定、异输入不同', () => {
    const p1 = trizDlComputePreviewFingerprint({
      projectId: 10,
      decisionLogId: 'dec-1',
      decisionSchemeHash: 'sch1',
      sourceContentHashes: ['h1', 'h2'],
      deliveryRefs: base.deliveryRefs,
    })
    expect(p1).toBe(
      trizDlComputePreviewFingerprint({
        projectId: 10,
        decisionLogId: 'dec-1',
        decisionSchemeHash: 'sch1',
        sourceContentHashes: ['h2', 'h1'],
        deliveryRefs: base.deliveryRefs,
      }),
    )
    expect(
      trizDlComputePreviewFingerprint({
        projectId: 10,
        decisionLogId: 'dec-1',
        decisionSchemeHash: 'schCHANGED',
        sourceContentHashes: ['h1', 'h2'],
        deliveryRefs: base.deliveryRefs,
      }),
    ).not.toBe(p1)

    const v = trizDlComputeVerificationFingerprint({
      linkDigest: 'x',
      sourceContentHashes: ['h1'],
      requiredRevisions: ['r1'],
      latestEventId: null,
    })
    expect(v).not.toBe(
      trizDlComputeVerificationFingerprint({
        linkDigest: 'x',
        sourceContentHashes: ['h1'],
        requiredRevisions: ['r1'],
        latestEventId: 'ev-9',
      }),
    )

    const e = trizDlComputeEventDigest({
      itemId: 'item-1',
      kind: 'verification_recorded',
      conclusion: 'effective',
      evidenceRefs: ['doc:1'],
      supersedesEventId: null,
      actorUserId: 7,
      fingerprint: 'fp',
    })
    expect(e).toBe(
      trizDlComputeEventDigest({
        itemId: 'item-1',
        kind: 'verification_recorded',
        conclusion: 'effective',
        evidenceRefs: ['doc:1'],
        supersedesEventId: null,
        actorUserId: 7,
        fingerprint: 'fp',
      }),
    )
  })

  it('stableSerialize 对 key 顺序无关', () => {
    expect(trizDlStableSerialize({ b: 1, a: [2, { z: 3, y: 4 }] })).toBe(
      trizDlStableSerialize({ a: [2, { y: 4, z: 3 }], b: 1 }),
    )
  })
})

// ---------------------------------------------------------------------------
// D4 posture 全矩阵
// ---------------------------------------------------------------------------

function facts(postures: Array<'completed' | 'blocked' | 'in_progress' | 'not_started'>) {
  return postures.map((p, i) => ({
    ref: { kind: 'task' as const, entityId: String(i + 1) },
    state: 'ok' as const,
    posture: p,
  }))
}

function input(over: Partial<TrizDlProjectionInput>): TrizDlProjectionInput {
  return {
    linkSuperseded: false,
    decisionSuperseded: false,
    sourceFreshness: 'fresh',
    hasValidLink: true,
    latestVerification: null,
    requiredDeliveryFacts: [],
    ...over,
  }
}

describe('D4 posture 全矩阵', () => {
  it('superseded 优先级最高（link 或 decision）', () => {
    expect(projectTrizDlPosture(input({ linkSuperseded: true })).posture).toBe('superseded')
    expect(projectTrizDlPosture(input({ decisionSuperseded: true })).posture).toBe('superseded')
  })

  it('stale 优先于验证；unknown freshness fail closed 为 source_stale', () => {
    const stale = input({
      sourceFreshness: 'stale',
      latestVerification: { conclusion: 'effective', fresh: false, superseded: false },
      requiredDeliveryFacts: facts(['completed']),
    })
    const out = projectTrizDlPosture(stale)
    expect(out.posture).toBe('source_stale')
    expect(out.warningCodes).toContain('TRIZ_DL_SOURCE_STALE')

    expect(
      projectTrizDlPosture(input({ sourceFreshness: 'unknown', requiredDeliveryFacts: [] }))
        .posture,
    ).toBe('source_stale')
  })

  it('fresh verification 三种结论：两态生效，inconclusive 不宣称成功', () => {
    const done = facts(['completed'])
    expect(
      projectTrizDlPosture(
        input({
          requiredDeliveryFacts: done,
          latestVerification: { conclusion: 'effective', fresh: true, superseded: false },
        }),
      ).posture,
    ).toBe('verified_effective')
    expect(
      projectTrizDlPosture(
        input({
          requiredDeliveryFacts: done,
          latestVerification: { conclusion: 'ineffective', fresh: true, superseded: false },
        }),
      ).posture,
    ).toBe('verified_ineffective')
    const inconclusive = projectTrizDlPosture(
      input({
        requiredDeliveryFacts: done,
        latestVerification: { conclusion: 'inconclusive', fresh: true, superseded: false },
      }),
    )
    expect(inconclusive.posture).toBe('awaiting_verification')
    expect(inconclusive.warningCodes).toContain('TRIZ_DL_INCONCLUSIVE_EVIDENCE')
  })

  it('全部完成且无验证 → awaiting_verification；部分完成 → in_progress', () => {
    expect(
      projectTrizDlPosture(input({ requiredDeliveryFacts: facts(['completed', 'completed']) }))
        .posture,
    ).toBe('awaiting_verification')
    expect(
      projectTrizDlPosture(input({ requiredDeliveryFacts: facts(['completed', 'in_progress']) }))
        .posture,
    ).toBe('in_progress')
  })

  it('blocking 存在 → blocked（低敏原因不外泄）', () => {
    expect(
      projectTrizDlPosture(input({ requiredDeliveryFacts: facts(['in_progress', 'blocked']) }))
        .posture,
    ).toBe('blocked')
  })

  it('无 link → awaiting_apply；有 link 未开始 → delivery_linked', () => {
    expect(projectTrizDlPosture(input({ hasValidLink: false })).posture).toBe('awaiting_apply')
    expect(
      projectTrizDlPosture(input({ requiredDeliveryFacts: facts(['not_started']) })).posture,
    ).toBe('delivery_linked')
  })

  it('mixed completion 边界确定：完成+取消 → 非 awaiting，落入 in_progress', () => {
    expect(
      projectTrizDlPosture(
        input({
          requiredDeliveryFacts: [
            ...facts(['completed']),
            { ref: { kind: 'task', entityId: 'x' }, state: 'ok', posture: 'cancelled' },
          ],
        }),
      ).posture,
    ).toBe('in_progress')
  })

  it('unavailable/missing ref fail closed 为 blocked + PARTIAL_UNAVAILABLE', () => {
    const out = projectTrizDlPosture(
      input({
        requiredDeliveryFacts: [
          ...facts(['completed']),
          { ref: { kind: 'task', entityId: 'y' }, state: 'unavailable', posture: null },
        ],
      }),
    )
    expect(out.posture).toBe('blocked')
    expect(out.warningCodes).toContain('TRIZ_DL_PARTIAL_UNAVAILABLE')
  })

  it('同事实两次投影结果恒等（确定性）', () => {
    const inp = input({
      requiredDeliveryFacts: facts(['completed']),
      latestVerification: { conclusion: 'inconclusive', fresh: true, superseded: false },
    })
    expect(projectTrizDlPosture(inp)).toEqual(projectTrizDlPosture(inp))
  })
})

// ---------------------------------------------------------------------------
// sanitizer 与截断/隐藏计数
// ---------------------------------------------------------------------------

describe('sanitizer', () => {
  it('拒绝禁止键（含嵌套与数组）', () => {
    const violations = scanTrizDlForbiddenKeys({
      summary: 'ok',
      nested: { prompt: 'leak' },
      list: [{ Authorization: 'Bearer x' }],
      meta: { apiKey: 'k' },
    })
    expect(violations).toHaveLength(3)
  })

  it('URL/body 类任意载荷键同样拒绝', () => {
    expect(scanTrizDlForbiddenKeys({ url: 'https://x' })).toHaveLength(1)
    expect(scanTrizDlForbiddenKeys({ body: '{}' })).toHaveLength(1)
    expect(scanTrizDlForbiddenKeys({ payload: [] })).toHaveLength(1)
    expect(scanTrizDlForbiddenKeys({ title: '正常字段' })).toHaveLength(0)
  })

  it('文本清洗：截断与控制字符剥离', () => {
    expect(sanitizeTrizDlText('abc', 10)).toBe('abc')
    expect(sanitizeTrizDlText('abcdef', 3)).toBe('abc')
    expect(sanitizeTrizDlText('a\u0000b\u001fc', 10)).toBe('abc')
    expect(sanitizeTrizDlText(null, 5)).toBeNull()
    expect(sanitizeTrizDlText(undefined, 5)).toBeNull()
  })
})

describe('可见计数与截断', () => {
  it('truncateTrizDlRefs 超限截断并给 warning code', () => {
    const refs = Array.from({ length: TRIZ_DL_MAX_REQUIRED_DELIVERY_REFS + 3 }, (_, i) => ({
      kind: 'task' as const,
      entityId: String(i),
    }))
    const r = truncateTrizDlRefs(refs, TRIZ_DL_MAX_REQUIRED_DELIVERY_REFS, 'TRIZ_DL_REFS_TRUNCATED')
    expect(r.visible).toHaveLength(TRIZ_DL_MAX_REQUIRED_DELIVERY_REFS)
    expect(r.truncatedCount).toBe(3)
    expect(r.warningCode).toBe('TRIZ_DL_REFS_TRUNCATED')

    const within = truncateTrizDlRefs(refs.slice(0, 5), 50, 'TRIZ_DL_REFS_TRUNCATED')
    expect(within.truncatedCount).toBe(0)
    expect(within.warningCode).toBeNull()
  })

  it('hidden 实体被剔除且只暴露 hasHidden 布尔，不泄露 hidden 计数细节', () => {
    const items = [
      { kind: 'task' as const, entityId: '1' },
      { kind: 'task' as const, entityId: '2' },
      { kind: 'risk' as const, entityId: '3' },
    ]
    const r = filterHiddenTrizDlEntities(items, new Set(['2']))
    expect(r.visible.map((v) => v.entityId)).toEqual(['1', '3'])
    expect(r.hasHidden).toBe(true)
  })

  it('canonicalizeRefs 按 kind+id 去重并排序', () => {
    const r = trizDlCanonicalizeRefs([
      { kind: 'task', entityId: '9' },
      { kind: 'milestone', entityId: '1' },
      { kind: 'task', entityId: '9' },
    ])
    expect(r.duplicatesRemoved).toBe(1)
    expect(r.visible).toEqual([
      { kind: 'milestone', entityId: '1' },
      { kind: 'task', entityId: '9' },
    ])
  })

  it('列表稳定排序：posture 优先级、updatedAt 降序、itemId tie-breaker', () => {
    const mk = (
      itemId: string,
      updatedAt: string,
    ): Pick<TrizDlClosedLoopItem, 'itemId' | 'updatedAt' | 'posture'> & {
      posture: TrizDlClosedLoopItem['posture']
    } => ({
      itemId,
      updatedAt,
      posture: 'in_progress',
    })
    const sorted = sortTrizDlItems([
      mk('c', '2026-01-03T00:00:00.000Z'),
      mk('a', '2026-01-02T00:00:00.000Z'),
      mk('b', '2026-01-02T00:00:00.000Z'),
    ])
    expect(sorted.map((s) => s.itemId)).toEqual(['c', 'a', 'b'])
  })
})

// ---------------------------------------------------------------------------
// DTO bounds 与 fixture consistency
// ---------------------------------------------------------------------------

describe('DTO bounds 校验', () => {
  it('合法 fixture item 全部通过 bounds 校验', () => {
    for (const item of buildTrizDlFixtureItems()) {
      expect(validateTrizDlClosedLoopItemBounds(item)).toEqual([])
    }
    expect(validateTrizDlClosedLoopItemBounds(buildTrizDlLegacyUnlinkedItem())).toEqual([])
  })

  it('超限 ref 数量与未知 warning 会被拒绝', () => {
    const bad: TrizDlClosedLoopItem = {
      ...buildTrizDlLegacyUnlinkedItem(),
      deliveryRefs: Array.from({ length: TRIZ_DL_MAX_REQUIRED_DELIVERY_REFS + 1 }, (_, i) => ({
        kind: 'task' as const,
        entityId: String(i),
      })),
      warningCodes: ['TOTALLY_UNKNOWN' as never],
    }
    const errors = validateTrizDlClosedLoopItemBounds(bad)
    expect(errors.some((e) => e.includes('上限'))).toBe(true)
    expect(errors.some((e) => e.includes('warning'))).toBe(true)
  })
})

describe('fixture consistency', () => {
  const expectedByName: Record<string, string> = {
    'small-baseline-awaiting-apply': 'awaiting_apply',
    'delivery-linked': 'delivery_linked',
    'in-progress': 'in_progress',
    blocked: 'blocked',
    'awaiting-verification': 'awaiting_verification',
    'verified-effective': 'verified_effective',
    'verified-ineffective': 'verified_ineffective',
    inconclusive: 'awaiting_verification',
    'source-stale': 'source_stale',
    'superseded-link': 'superseded',
    'unavailable-fail-closed': 'blocked',
    'cross-tenant-decoy-A': 'delivery_linked',
    'cross-tenant-decoy-B': 'source_stale',
  }

  it('每个 fixture 的姿态与手写期望一致（防投影回归）', () => {
    const items = buildTrizDlFixtureItems()
    expect(items).toHaveLength(Object.keys(expectedByName).length)
    const byItemId = new Map(items.map((i) => [i.itemId, i]))
    for (const [name, posture] of Object.entries(expectedByName)) {
      const found = byItemId.get(nameToItemId(name))
      expect(found).toBeDefined()
      expect(found?.posture).toBe(posture)
    }
  })

  it('legacy-unlinked fixture 带 LEGACY_UNLINKED warning 且姿态为 awaiting_apply', () => {
    const legacy = buildTrizDlLegacyUnlinkedItem()
    expect(legacy.warningCodes).toContain('TRIZ_DL_LEGACY_UNLINKED')
    expect(legacy.posture).toBe('awaiting_apply')
  })

  it('entity summary fixtures：forbidden 实体 title 必须为 null', () => {
    for (const s of buildTrizDlEntitySummaryFixtures()) {
      if (s.unavailableReason !== null) {
        expect(s.title).toBeNull()
      }
    }
  })

  function nameToItemId(name: string): string {
    const map: Record<string, string> = {
      'small-baseline-awaiting-apply': 'item-001',
      'delivery-linked': 'item-002',
      'in-progress': 'item-003',
      blocked: 'item-004',
      'awaiting-verification': 'item-005',
      'verified-effective': 'item-006',
      'verified-ineffective': 'item-007',
      inconclusive: 'item-008',
      'source-stale': 'item-009',
      'superseded-link': 'item-010',
      'unavailable-fail-closed': 'item-011',
      'cross-tenant-decoy-A': 'item-901',
      'cross-tenant-decoy-B': 'item-902',
    }
    return map[name] ?? name
  }
})
