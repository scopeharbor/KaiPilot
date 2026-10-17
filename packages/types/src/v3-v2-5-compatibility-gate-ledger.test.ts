/**
 * v3-v2-5-compatibility-gate-ledger.test —— V3/V2.5 兼容账本与校验 helpers 的共享测试。
 *
 * 证明：
 * - 合法账本通过校验（零 issue）。
 * - 不完整账本（缺 GA P0 / 缺授权门 / 重复 surfaceId / 缺权威 sourceRef）各自失败且 issue.kind 正确。
 * - 非法状态迁移被 assertSupportedStatusTransition 拦截。
 * - conditional/deferred 条目在主账本中保持 protected（未被改成 verified-archived）。
 * - 主账本所有 sourceRefs 不含敏感关键词（值级扫描，证明 finding/ledger 摘要低敏）。
 */
import { describe, expect, it } from 'vitest'
import { COMPATIBILITY_SENSITIVE_KEYWORDS } from './v3-v2-5-compatibility-gate.js'
import type { CompatibilityLedger } from './v3-v2-5-compatibility-gate.js'
import {
  REQUIRED_AUTHORIZATION_GATE_IDS,
  REQUIRED_GA_P0_SURFACE_IDS,
  V25_COMPATIBILITY_LEDGER,
  assertSupportedStatusTransition,
  findLedgerSurface,
  getAuthorizationGate,
  validateCompatibilityLedger,
} from './v3-v2-5-compatibility-gate-ledger.js'
import {
  ILLEGAL_STATUS_TRANSITION_PAIRS,
  MISSING_GA_P0_LEDGER_FIXTURE,
  STALE_EVIDENCE_LEDGER_FIXTURE,
  VALID_COMPATIBILITY_LEDGER_FIXTURE,
} from './v3-v2-5-compatibility-gate-fixtures.js'

describe('V25 兼容账本校验', () => {
  it('合法完整账本通过校验（零 issue）', () => {
    expect(validateCompatibilityLedger(VALID_COMPATIBILITY_LEDGER_FIXTURE)).toEqual([])
    expect(validateCompatibilityLedger(V25_COMPATIBILITY_LEDGER)).toEqual([])
  })

  it('缺 GA P0 表面的账本失败且报 missing-ga-p0', () => {
    const issues = validateCompatibilityLedger(MISSING_GA_P0_LEDGER_FIXTURE)
    const kinds = issues.map((issue) => issue.kind)
    expect(kinds).toContain('missing-ga-p0')
    const missingIds = issues
      .filter((issue) => issue.kind === 'missing-ga-p0')
      .map((issue) => issue.surfaceId)
    expect(missingIds).toContain('gantt-what-if')
    expect(missingIds).toContain('compiler-orchestration-wiring')
  })

  it('缺授权门的账本失败且报 missing-authorization-gate', () => {
    const ledger: CompatibilityLedger = {
      ...V25_COMPATIBILITY_LEDGER,
      authorizationGates: V25_COMPATIBILITY_LEDGER.authorizationGates.filter(
        (gate) => gate.gateId !== 'real-oauth-token-exchange',
      ),
    }
    const issues = validateCompatibilityLedger(ledger)
    expect(issues.map((issue) => issue.kind)).toContain('missing-authorization-gate')
  })

  it('重复 surfaceId 的账本失败且报 duplicate-surface-id', () => {
    const first = V25_COMPATIBILITY_LEDGER.surfaces[0]!
    const ledger: CompatibilityLedger = {
      ...V25_COMPATIBILITY_LEDGER,
      surfaces: [...V25_COMPATIBILITY_LEDGER.surfaces, first],
    }
    const issues = validateCompatibilityLedger(ledger)
    expect(issues.map((issue) => issue.kind)).toContain('duplicate-surface-id')
  })

  it('缺权威 sourceRef 的表面失败且报 missing-authoritative-ref', () => {
    const ledger: CompatibilityLedger = {
      ...V25_COMPATIBILITY_LEDGER,
      surfaces: V25_COMPATIBILITY_LEDGER.surfaces.map((surface) =>
        surface.surfaceId === 'command-palette'
          ? {
              ...surface,
              sourceRefs: [{ kind: 'source-file', path: 'apps/frontend/lib/command-palette.ts' }],
            }
          : surface,
      ),
    }
    const issues = validateCompatibilityLedger(ledger)
    const authoritativeIssues = issues.filter((issue) => issue.kind === 'missing-authoritative-ref')
    expect(authoritativeIssues).toHaveLength(1)
    expect(authoritativeIssues[0]!.surfaceId).toBe('command-palette')
  })

  it('非法 sourceRef.path（空串/绝对路径）失败且报 invalid-source-ref', () => {
    const ledger: CompatibilityLedger = {
      ...V25_COMPATIBILITY_LEDGER,
      surfaces: V25_COMPATIBILITY_LEDGER.surfaces.map((surface) =>
        surface.surfaceId === 'command-palette'
          ? {
              ...surface,
              sourceRefs: [
                ...surface.sourceRefs,
                { kind: 'source-file', path: '' },
                { kind: 'source-file', path: '/abs/path.ts' },
              ],
            }
          : surface,
      ),
    }
    const issues = validateCompatibilityLedger(ledger)
    expect(
      issues.filter((issue) => issue.kind === 'invalid-source-ref').length,
    ).toBeGreaterThanOrEqual(2)
  })

  it('证据陈旧账本结构合法（陈旧性由规则引擎以 warning 处理，非账本结构问题）', () => {
    expect(validateCompatibilityLedger(STALE_EVIDENCE_LEDGER_FIXTURE)).toEqual([])
    expect(STALE_EVIDENCE_LEDGER_FIXTURE.generatedAt).toBe('2025-01-01')
  })
})

describe('状态迁移纪律', () => {
  it('非法状态迁移全部被拦截（unsupported-status-transition）', () => {
    for (const pair of ILLEGAL_STATUS_TRANSITION_PAIRS) {
      const issue = assertSupportedStatusTransition(pair.from, pair.to)
      expect(issue).not.toBeNull()
      expect(issue!.kind).toBe('unsupported-status-transition')
    }
  })

  it('恒等迁移与显式授权路径迁移合法', () => {
    expect(assertSupportedStatusTransition('conditional', 'conditional')).toBeNull()
    expect(assertSupportedStatusTransition('conditional', 'verified-archived')).toBeNull()
    expect(assertSupportedStatusTransition('deferred', 'verified-archived')).toBeNull()
    expect(assertSupportedStatusTransition('archived-but-stub', 'verified-archived')).toBeNull()
    expect(assertSupportedStatusTransition('deferred', 'conditional')).toBeNull()
  })

  it('conditional/deferred 条目在主账本中保持 protected（未被改成 verified-archived）', () => {
    for (const gateId of REQUIRED_AUTHORIZATION_GATE_IDS) {
      const gate = getAuthorizationGate(V25_COMPATIBILITY_LEDGER, gateId)
      expect(gate, `授权门 ${gateId} 必须存在`).toBeDefined()
      expect(gate!.status).toBe('conditional')
    }
    const deferredGates = V25_COMPATIBILITY_LEDGER.authorizationGates.filter(
      (gate) => gate.status === 'deferred',
    )
    expect(deferredGates.map((gate) => gate.gateId)).toEqual([
      'containerized-private-deployment',
      'full-internationalization',
      'open-plugin-marketplace',
    ])
    // 账本表面中不存在任何把授权门包装成 verified-archived 的条目
    const gatedSurfaceIds = new Set(REQUIRED_AUTHORIZATION_GATE_IDS)
    for (const surface of V25_COMPATIBILITY_LEDGER.surfaces) {
      expect(gatedSurfaceIds.has(surface.surfaceId)).toBe(false)
    }
  })
})

describe('账本内容与查询 helpers', () => {
  it('GA P0 三主线全部存在且为 verified-archived', () => {
    for (const surfaceId of REQUIRED_GA_P0_SURFACE_IDS) {
      const surface = findLedgerSurface(V25_COMPATIBILITY_LEDGER, surfaceId)
      expect(surface, `GA P0 表面 ${surfaceId} 必须存在`).toBeDefined()
      expect(surface!.status).toBe('verified-archived')
    }
  })

  it('/api/v2 适配器为 archived-but-stub（归档 ≠ 已接通）', () => {
    const surface = findLedgerSurface(V25_COMPATIBILITY_LEDGER, 'api-v2-adapter')
    expect(surface).toBeDefined()
    expect(surface!.status).toBe('archived-but-stub')
  })

  it('账本包含 §5.4 全部 API/运行时裁决与 §5.5 红线', () => {
    const decisionIds = V25_COMPATIBILITY_LEDGER.apiRuntimeDecisions.map(
      (decision) => decision.decisionId,
    )
    expect(decisionIds).toEqual([
      'api-v1-default',
      'api-v2-stub-gated',
      'sqlite-first-local-monolith',
      'no-docker-no-microservices',
      'no-forced-redis-kafka-vectordb',
      'sse-default-transport',
      'gantt-visx-no-d3',
    ])
    expect(V25_COMPATIBILITY_LEDGER.redLines.length).toBeGreaterThanOrEqual(6)
  })

  it('查询 helper 未命中时返回 undefined', () => {
    expect(findLedgerSurface(V25_COMPATIBILITY_LEDGER, 'no-such-surface')).toBeUndefined()
    expect(getAuthorizationGate(V25_COMPATIBILITY_LEDGER, 'no-such-gate')).toBeUndefined()
  })
})

describe('低敏纪律', () => {
  it('主账本所有 sourceRefs 不含敏感关键词（值级扫描）', () => {
    const allRefs = [
      ...V25_COMPATIBILITY_LEDGER.surfaces.flatMap((surface) => surface.sourceRefs),
      ...V25_COMPATIBILITY_LEDGER.authorizationGates.flatMap((gate) => gate.sourceRefs),
      ...V25_COMPATIBILITY_LEDGER.apiRuntimeDecisions.flatMap((decision) => decision.sourceRefs),
      ...V25_COMPATIBILITY_LEDGER.redLines.flatMap((redLine) => redLine.sourceRefs),
    ]
    expect(allRefs.length).toBeGreaterThan(0)
    for (const ref of allRefs) {
      const value = `${ref.path} ${ref.note ?? ''}`.toLowerCase()
      for (const keyword of COMPATIBILITY_SENSITIVE_KEYWORDS) {
        expect(
          value.includes(keyword.toLowerCase()),
          `sourceRef "${ref.path}" 含敏感关键词 "${keyword}"`,
        ).toBe(false)
      }
    }
  })
})
