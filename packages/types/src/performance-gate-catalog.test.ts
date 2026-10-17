/**
 * performance-gate-catalog.test —— V3 性能门禁 catalog 测试（任务 4.5/4.6）。
 *
 * 证明：
 * - 首批 V3 high-risk surface 全部有 smoke-profile catalog 条目（spec: Initial catalog MUST cover）。
 * - 未知 high-risk surface 产生 catalog_gap finding（spec: Unknown high-risk surface is detected）。
 * - catalog 自身校验零 issue；probe 表与 catalog 一致。
 * - 最稳定确定性 gate 扩展了 v3-default profile（4.6）。
 * - 授权门条目（requires-user-authorization）在 catalog 中显式登记。
 */
import { describe, expect, it } from 'vitest'
import {
  GATE_PROFILES,
  REQUIRED_V3_HIGH_RISK_SURFACES,
  validateGateCatalog,
  type GateSurface,
} from './performance-and-scale-gates.js'
import {
  GATE_PROBES,
  PERFORMANCE_GATE_CATALOG,
  PERFORMANCE_GATE_CATALOG_BY_ID,
  checkCatalogCoverage,
  filterCatalog,
  validateCatalogProbeConsistency,
} from './performance-gate-catalog.js'

describe('catalog 完整性', () => {
  it('catalog 自身校验零 issue（含重复 id / 缺字段 / 预算兼容）', () => {
    expect(validateGateCatalog(PERFORMANCE_GATE_CATALOG)).toEqual([])
  })

  it('probe 表与 catalog 一致（每 probe 有条目、每非 command gate 有 probe）', () => {
    expect(validateCatalogProbeConsistency()).toEqual([])
  })

  it('id 全局唯一', () => {
    const ids = PERFORMANCE_GATE_CATALOG.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(Object.keys(PERFORMANCE_GATE_CATALOG_BY_ID).length).toBe(ids.length)
  })
})

describe('首批 V3 high-risk surface 覆盖（4.5）', () => {
  it('每个必选 surface 在 smoke profile 下都有条目', () => {
    for (const surface of REQUIRED_V3_HIGH_RISK_SURFACES) {
      const covered = filterCatalog(PERFORMANCE_GATE_CATALOG, { surface, profile: 'smoke' })
      expect(covered.length, `surface ${surface} 缺 smoke 条目`).toBeGreaterThan(0)
    }
  })

  it('checkCatalogCoverage 对已覆盖 surface 零 finding', () => {
    expect(checkCatalogCoverage(undefined, 'smoke')).toEqual([])
  })

  it('未知 high-risk surface 产生 catalog_gap finding', () => {
    const findings = checkCatalogCoverage('not-a-real-surface' as GateSurface, 'smoke')
    expect(findings.length).toBe(1)
    expect(findings[0]?.code).toBe('catalog_gap')
    expect(findings[0]?.summary).toContain('not-a-real-surface')
  })

  it('逐 surface 检查无缺口', () => {
    for (const s of REQUIRED_V3_HIGH_RISK_SURFACES) {
      expect(checkCatalogCoverage(s, 'smoke'), `surface ${s} 有缺口`).toEqual([])
    }
  })
})

describe('catalog 条目语义', () => {
  it('所有 smoke 条目 local-first：授权边界为 fixture-mock/local-only 或显式登记 requires-user-authorization', () => {
    for (const e of PERFORMANCE_GATE_CATALOG) {
      const profiles = Array.isArray(e.profile) ? e.profile : [e.profile]
      if (!profiles.includes('smoke')) continue
      expect(
        ['fixture-mock', 'local-only', 'requires-user-authorization'].includes(
          e.authorizationBoundary,
        ),
        `gate ${e.id} 授权边界非法: ${e.authorizationBoundary}`,
      ).toBe(true)
    }
  })

  it('授权门条目（real-provider-smoke）显式登记 requires-user-authorization 与原因码', () => {
    const entry = PERFORMANCE_GATE_CATALOG_BY_ID['real-provider-smoke']
    expect(entry).toBeDefined()
    expect(entry.authorizationBoundary).toBe('requires-user-authorization')
    expect(entry.allowedReasonCodes).toContain('external-not-authorized')
    expect(entry.probeKind).toBe('degraded-placeholder')
  })

  it('时间类指标只走软门（duration-ms 无 hard 或 hard 由稳定后登记）', () => {
    const compiler = PERFORMANCE_GATE_CATALOG_BY_ID['compiler-validation-smoke']
    const duration = compiler.metrics.find((m) => m.metric === 'duration-ms')
    expect(duration).toBeDefined()
    expect(duration?.soft).toBeDefined()
  })

  it('blocking 门禁都有 hard 预算（确定性资源边界）', () => {
    for (const e of PERFORMANCE_GATE_CATALOG) {
      if (e.severity !== 'blocking') continue
      expect(
        e.metrics.some((m) => m.hard !== undefined),
        `blocking gate ${e.id} 缺 hard 预算`,
      ).toBe(true)
    }
  })
})

describe('profile 扩展（4.6 P1）', () => {
  it('最稳定确定性 gate（contract-*）扩展 v3-default', () => {
    const defaultGates = filterCatalog(PERFORMANCE_GATE_CATALOG, { profile: 'v3-default' })
    expect(defaultGates.length).toBeGreaterThan(0)
    const contractIds = [
      'contract-catalog-integrity',
      'contract-fixture-determinism',
      'contract-report-schema',
      'contract-redaction-safety',
      'contract-waiver-validity',
    ]
    for (const id of contractIds) {
      const e = PERFORMANCE_GATE_CATALOG_BY_ID[id]
      const profiles = Array.isArray(e.profile) ? e.profile : [e.profile]
      expect(profiles, `gate ${id} 应含 v3-default`).toContain('v3-default')
    }
  })

  it('stress-local 不默认启用（避免拖慢日常 apply）', () => {
    const stressGates = filterCatalog(PERFORMANCE_GATE_CATALOG, { profile: 'stress-local' })
    expect(stressGates).toEqual([])
  })

  it('GATE_PROFILES 三档与 catalog 引用一致', () => {
    for (const e of PERFORMANCE_GATE_CATALOG) {
      const profiles = Array.isArray(e.profile) ? e.profile : [e.profile]
      for (const p of profiles) {
        expect(GATE_PROFILES).toContain(p)
      }
    }
  })
})

describe('probe 注册表', () => {
  it('每个 probe 都是函数', () => {
    for (const [id, probe] of Object.entries(GATE_PROBES)) {
      expect(typeof probe, `probe ${id}`).toBe('function')
    }
  })

  it('probe 执行结果状态合法', async () => {
    for (const [id, probe] of Object.entries(GATE_PROBES)) {
      const result = await probe()
      expect(['passed', 'degraded', 'skipped'], `probe ${id} 状态非法`).toContain(result.status)
      if (result.status !== 'passed') {
        expect(result.reasonCode, `probe ${id} 非 passed 必须带 reasonCode`).toBeDefined()
      }
    }
  })
})
