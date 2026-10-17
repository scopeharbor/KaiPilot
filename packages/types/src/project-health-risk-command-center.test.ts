// v3-project-health-risk-command-center §2 契约与纯函数验证。
// 覆盖：封闭词表完整性 / 序列化兼容 / query 规范化拒绝 / 投影签名确定性 /
// headline precedence / 注意力排序去重截断 / safe-target allowlist / 低敏扫描 / lens 隔离。

import { describe, expect, it } from 'vitest'
import {
  COMMAND_CENTER_ATTENTION_KIND_VALUES,
  COMMAND_CENTER_AVAILABILITY_VALUES,
  COMMAND_CENTER_CONTRACT_VERSION,
  COMMAND_CENTER_EVIDENCE_CLASS_VALUES,
  COMMAND_CENTER_FORBIDDEN_KEYS,
  COMMAND_CENTER_FRESHNESS_STATE_VALUES,
  COMMAND_CENTER_MAX_ATTENTION_LIMIT,
  COMMAND_CENTER_MANDATORY_SOURCES,
  COMMAND_CENTER_REASON_CODE_VALUES,
  COMMAND_CENTER_SEVERITY_RANK,
  COMMAND_CENTER_SOURCE_KEYS,
  COMMAND_CENTER_SOURCES,
  COMMAND_CENTER_TARGET_KIND_VALUES,
  COMMAND_CENTER_WARNING_CODE_VALUES,
  canonicalizeCommandCenterQuery,
  checkLensContribution,
  commandCenterFnv1a,
  commandCenterStableSerialize,
  compareCommandCenterAttention,
  computeCommandCenterPermissionFingerprint,
  computeProjectionSignature,
  detectForbiddenFields,
  detectSourcePostureConflict,
  normalizeCommandCenterQuery,
  projectAttentionQueue,
  resolveHeadline,
  setCommandCenterNow,
  validateSafeTarget,
} from './project-health-risk-command-center.js'
import type { CommandCenterAttentionCandidate } from './project-health-risk-command-center.js'
import {
  COMMAND_CENTER_FIXTURE_NOW_MS,
  FIXTURE_CANONICAL_QUERY_READY,
  fixtureConflict,
  fixtureDashboardFacts,
  fixtureDiagnosisFacts,
  fixtureLargeProject,
  fixtureRiskFacts,
} from './project-health-risk-command-center-fixtures.js'

const FIXED_NOW = Date.parse('2026-09-01T08:00:00.000Z')
setCommandCenterNow(FIXED_NOW)

// ─── 2.2 封闭词表与契约完整性 ──────────────────────────────────────────────────

describe('contract vocabulary integrity', () => {
  it('contract version 固定为 v1 且各词表非空、无重复', () => {
    expect(COMMAND_CENTER_CONTRACT_VERSION).toBe('project-health-risk-command-center/v1')
    for (const values of [
      COMMAND_CENTER_SOURCE_KEYS,
      COMMAND_CENTER_EVIDENCE_CLASS_VALUES,
      COMMAND_CENTER_AVAILABILITY_VALUES,
      COMMAND_CENTER_FRESHNESS_STATE_VALUES,
      COMMAND_CENTER_REASON_CODE_VALUES,
      COMMAND_CENTER_WARNING_CODE_VALUES,
      COMMAND_CENTER_TARGET_KIND_VALUES,
      COMMAND_CENTER_ATTENTION_KIND_VALUES,
    ]) {
      expect(values.length).toBeGreaterThan(0)
      expect(new Set(values).size).toBe(values.length)
    }
  })

  it('mandatory 来源只含基础 Dashboard', () => {
    expect(COMMAND_CENTER_MANDATORY_SOURCES).toEqual([COMMAND_CENTER_SOURCES.PROJECT_DASHBOARD])
  })

  it('severity rank 单调：critical > high > medium > low > info', () => {
    expect(COMMAND_CENTER_SEVERITY_RANK.critical).toBeGreaterThan(COMMAND_CENTER_SEVERITY_RANK.high)
    expect(COMMAND_CENTER_SEVERITY_RANK.high).toBeGreaterThan(COMMAND_CENTER_SEVERITY_RANK.medium)
    expect(COMMAND_CENTER_SEVERITY_RANK.medium).toBeGreaterThan(COMMAND_CENTER_SEVERITY_RANK.low)
    expect(COMMAND_CENTER_SEVERITY_RANK.low).toBeGreaterThan(COMMAND_CENTER_SEVERITY_RANK.info)
  })

  it('stable serialize 键序无关且序列化往返稳定', () => {
    const a = commandCenterStableSerialize({ b: 1, a: [2, { z: null, y: 'x' }] })
    const b = commandCenterStableSerialize({ a: [2, { y: 'x', z: null }], b: 1 })
    expect(a).toBe(b)
    expect(JSON.parse(a)).toEqual({ a: [2, { y: 'x', z: null }], b: 1 })
  })

  it('fnv1a 确定且 8 位十六进制', () => {
    expect(commandCenterFnv1a('abc')).toBe(commandCenterFnv1a('abc'))
    expect(commandCenterFnv1a('abc')).toMatch(/^[0-9a-f]{8}$/)
    expect(commandCenterFnv1a('abc')).not.toBe(commandCenterFnv1a('abd'))
  })
})

// ─── 2.4 query 规范化与签名 ────────────────────────────────────────────────────

describe('normalizeCommandCenterQuery', () => {
  it('缺省值：limit=20、include=全部来源、window=30', () => {
    const r = normalizeCommandCenterQuery({})
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.query.attentionLimit).toBe(20)
      expect(r.query.include).toEqual([...COMMAND_CENTER_SOURCE_KEYS].sort())
      expect(r.query.freshnessWindowDays).toBe(30)
    }
  })

  it(`拒绝超过 ${COMMAND_CENTER_MAX_ATTENTION_LIMIT} 的 limit 与非法 limit`, () => {
    expect(normalizeCommandCenterQuery({ attentionLimit: 101 }).ok).toBe(false)
    expect(normalizeCommandCenterQuery({ attentionLimit: 0 }).ok).toBe(false)
    expect(normalizeCommandCenterQuery({ attentionLimit: -5 }).ok).toBe(false)
    expect(normalizeCommandCenterQuery({ attentionLimit: 'abc' }).ok).toBe(false)
    expect(normalizeCommandCenterQuery({ attentionLimit: 1.5 }).ok).toBe(false)
    expect(normalizeCommandCenterQuery({ attentionLimit: '100' }).ok).toBe(true)
  })

  it('拒绝未知 include、重复 include 并给出 issue code', () => {
    const unknown = normalizeCommandCenterQuery({ include: ['risk-workbench', 'nope'] })
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.issues.some((i) => i.code === 'unknown-value')).toBe(true)

    const dup = normalizeCommandCenterQuery({ include: ['risk-workbench', 'risk-workbench'] })
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.issues.some((i) => i.code === 'duplicate-value')).toBe(true)
  })

  it('拒绝越界 freshness window', () => {
    expect(normalizeCommandCenterQuery({ freshnessWindowDays: 0 }).ok).toBe(false)
    expect(normalizeCommandCenterQuery({ freshnessWindowDays: 91 }).ok).toBe(false)
    expect(normalizeCommandCenterQuery({ freshnessWindowDays: '7' }).ok).toBe(true)
  })

  it('乱序 include 归一为同 query → 同 canonical key', () => {
    const a = normalizeCommandCenterQuery({ include: ['prediction', 'risk-workbench'] })
    const b = normalizeCommandCenterQuery({ include: ['risk-workbench', 'prediction'] })
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(canonicalizeCommandCenterQuery(a.query)).toBe(canonicalizeCommandCenterQuery(b.query))
    }
  })

  it('fixture ready 场景的 canonical key 是稳定基线', () => {
    expect(FIXTURE_CANONICAL_QUERY_READY).toContain('"al":20')
  })
})

describe('computeProjectionSignature', () => {
  const baseSources = [
    {
      sourceKey: COMMAND_CENTER_SOURCES.RISK_WORKBENCH as const,
      evidenceClass: 'fact' as const,
      availability: 'available' as const,
      freshness: 'current' as const,
      reasonCode: null,
      sourceVersionDigest: 'rw-1',
    },
  ]
  const fp = computeCommandCenterPermissionFingerprint(['project:view'])
  const q = normalizeCommandCenterQuery({})

  function sig(sources = baseSources, fingerprint = fp) {
    if (!q.ok) throw new Error('bad fixture query')
    return computeProjectionSignature({
      permissionFingerprint: fingerprint,
      query: q.query,
      sources,
    })
  }

  it('相同输入恒同签名；重复调用稳定', () => {
    expect(sig()).toBe(sig())
    expect(sig()).toHaveLength(8)
  })

  it('权限指纹隔离：不同权限位集合 → 不同签名', () => {
    const other = computeCommandCenterPermissionFingerprint(['project:view', 'risk:view'])
    expect(sig(baseSources, other)).not.toBe(sig())
  })

  it('隐藏文本不进签名：label/title 类字段不影响结果（签名输入无自由文本字段）', () => {
    // 签名输入类型上不存在 label 字段；同结构不同 digest 才会改变签名。
    expect(sig([{ ...baseSources[0], sourceVersionDigest: 'rw-2' }])).not.toBe(sig())
  })

  it('来源可用性变化反映在签名中', () => {
    expect(sig([{ ...baseSources[0], availability: 'unavailable' as const }])).not.toBe(sig())
  })
})

// ─── 2.6 headline precedence 与冲突 ───────────────────────────────────────────

function metaFor(
  availability: 'available' | 'empty' | 'stale',
  freshness: 'current' | 'stale',
  evidenceClass: 'confirmed-diagnosis' | 'fact',
) {
  return {
    meta: {
      sourceKey: COMMAND_CENTER_SOURCES.HEALTH_DIAGNOSIS as const,
      evidenceClass,
      availability,
      freshness,
      authorityRef: { kind: 'diagnosis', id: 9001 as number | null },
      sourceVersionDigest: 'sig-abc',
      calculatedAt: new Date(FIXED_NOW - 86_400_000).toISOString(),
      reasonCode: null,
    },
    facts: fixtureDiagnosisFacts(),
  }
}

describe('resolveHeadline precedence', () => {
  it('confirmed + current 诊断成为 headline，不降级', () => {
    const h = resolveHeadline({
      diagnosis: metaFor('available', 'current', 'confirmed-diagnosis'),
      dashboard: { facts: fixtureDashboardFacts(), meta: {} as never },
    })
    expect(h.sourceKey).toBe(COMMAND_CENTER_SOURCES.HEALTH_DIAGNOSIS)
    expect(h.degraded).toBe(false)
    expect(h.degradationWarning).toBeNull()
    expect(h.overallScore).toBe(86)
  })

  it('missing 诊断回退 Dashboard 并带 MISSING warning', () => {
    const h = resolveHeadline({ diagnosis: null })
    expect(h.sourceKey).toBe(COMMAND_CENTER_SOURCES.PROJECT_DASHBOARD)
    expect(h.degraded).toBe(true)
    expect(h.degradationWarning?.code).toBe('HEALTH_DIAGNOSIS_MISSING')
  })

  it('stale 诊断回退 Dashboard 并带 STALE warning；不隐式生成/确认诊断（纯函数零副作用）', () => {
    const h = resolveHeadline({ diagnosis: metaFor('stale', 'stale', 'confirmed-diagnosis') })
    expect(h.sourceKey).toBe(COMMAND_CENTER_SOURCES.PROJECT_DASHBOARD)
    expect(h.degradationWarning?.code).toBe('HEALTH_DIAGNOSIS_STALE')
  })

  it('pending（非 confirmed）诊断不得成为 headline', () => {
    const h = resolveHeadline({
      diagnosis: {
        ...metaFor('available', 'current', 'fact'),
        meta: { ...metaFor('available', 'current', 'fact').meta, evidenceClass: 'fact' },
      },
    })
    expect(h.sourceKey).toBe(COMMAND_CENTER_SOURCES.PROJECT_DASHBOARD)
  })

  it('source conflict：headline green + 高严重风险 → 冲突 warning，不合成新总分', () => {
    const h = resolveHeadline({ diagnosis: null })
    const conflict = detectSourcePostureConflict(
      { ...h, healthStatus: 'green' },
      fixtureRiskFacts({ highRiskCount: 2, criticalRiskCount: 1 }),
    )
    expect(conflict?.code).toBe('SOURCE_POSTURE_CONFLICT')

    // 无冲突情形
    expect(
      detectSourcePostureConflict(
        { ...h, healthStatus: 'red' },
        fixtureRiskFacts({ highRiskCount: 2 }),
      ),
    ).toBeNull()
    expect(detectSourcePostureConflict({ ...h, healthStatus: 'green' }, null)).toBeNull()
    expect(
      detectSourcePostureConflict(
        { ...h, healthStatus: 'green' },
        fixtureRiskFacts({ highRiskCount: 0, criticalRiskCount: 0 }),
      ),
    ).toBeNull()
  })

  it('conflict fixture 可构造且 attention 含 critical 风险项', () => {
    const scenario = fixtureConflict()
    expect(scenario.name).toBe('conflict')
    expect(scenario.attentionCandidates[0]?.severity).toBe('critical')
  })

  it('forbidden/unavailable 场景不携带事实即可表达（词表完备）', () => {
    expect(COMMAND_CENTER_AVAILABILITY_VALUES).toContain('forbidden')
    expect(COMMAND_CENTER_AVAILABILITY_VALUES).toContain('unavailable')
    expect(COMMAND_CENTER_AVAILABILITY_VALUES).toContain('unsupported')
  })
})

// ─── 2.8 注意力队列 ────────────────────────────────────────────────────────────

function cand(
  overrides: Partial<CommandCenterAttentionCandidate>,
): CommandCenterAttentionCandidate {
  return {
    sourceKey: COMMAND_CENTER_SOURCES.RISK_WORKBENCH,
    kind: 'high-risk-open',
    severity: 'medium',
    reasonCode: 'HIGH_SEVERITY_RISK_OPEN',
    entityRef: { kind: 'risk', id: 1 },
    label: `风险 ${overrides.entityRef?.id ?? 1}`,
    occurredAt: new Date(FIXED_NOW - 3600_000).toISOString(),
    dueAt: null,
    stale: false,
    targets: [],
    ...overrides,
  }
}

describe('projectAttentionQueue', () => {
  it('同输入恒同顺序（重复调用与倒序输入一致）', () => {
    const items = [
      cand({ entityRef: { kind: 'risk', id: 1 }, severity: 'high' }),
      cand({ entityRef: { kind: 'risk', id: 2 }, severity: 'critical' }),
      cand({ entityRef: { kind: 'risk', id: 3 }, severity: 'low' }),
    ]
    const forward = projectAttentionQueue(items, 100)
    const shuffled = projectAttentionQueue([...items].reverse(), 100)
    expect(forward.items.map((i) => i.attentionId)).toEqual(
      shuffled.items.map((i) => i.attentionId),
    )
    expect(forward.truncation.truncated).toBe(false)
  })

  it('随机顺序 property-style：20 组随机排列产出同一顺序', () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      cand({
        entityRef: { kind: 'risk', id: i + 1 },
        severity: (['critical', 'high', 'medium', 'low'] as const)[i % 4],
        occurredAt: new Date(FIXED_NOW - i * 7200_000).toISOString(),
        dueAt: i % 3 === 0 ? new Date(FIXED_NOW - 86_400_000).toISOString() : null,
        stale: i % 5 === 0,
      }),
    )
    const baseline = projectAttentionQueue(items, 100).items.map((i) => i.attentionId)
    // 确定性 LCG 伪随机洗牌：20 轮不同排列必须产出同一队列顺序。
    for (let round = 0; round < 20; round++) {
      const copy = [...items]
      let seed = 12345 + round * 97
      const nextRand = (n: number) => {
        seed = (seed * 1103515245 + 12345) % 2147483648
        return seed % n
      }
      for (let i = copy.length - 1; i > 0; i--) {
        const j = nextRand(i + 1)
        ;[copy[i], copy[j]] = [copy[j], copy[i]]
      }
      expect(projectAttentionQueue(copy, 100).items.map((i) => i.attentionId)).toEqual(baseline)
    }
  })

  it('跨域同实体不同 reason 不误合并（保留两项）', () => {
    const items = [
      cand({
        sourceKey: COMMAND_CENTER_SOURCES.HEALTH_DIAGNOSIS,
        reasonCode: 'HEALTH_DIMENSION_ATTENTION',
        entityRef: { kind: 'task', id: 42 },
      }),
      cand({
        sourceKey: COMMAND_CENTER_SOURCES.RISK_WORKBENCH,
        reasonCode: 'HIGH_SEVERITY_RISK_OPEN',
        entityRef: { kind: 'task', id: 42 },
      }),
    ]
    const queue = projectAttentionQueue(items, 100)
    expect(queue.items).toHaveLength(2)
  })

  it('完全同键候选项去重为一项', () => {
    const queue = projectAttentionQueue([cand({}), cand({})], 100)
    expect(queue.items).toHaveLength(1)
  })

  it('逾期项排在未逾期同级项之前；severity DESC 次序优先', () => {
    setCommandCenterNow(FIXED_NOW)
    const overdueMedium = cand({
      severity: 'medium',
      dueAt: new Date(FIXED_NOW - 86_400_000).toISOString(),
      entityRef: { kind: 'risk', id: 10 },
    })
    const futureHigh = cand({
      severity: 'high',
      dueAt: new Date(FIXED_NOW + 86_400_000).toISOString(),
      entityRef: { kind: 'risk', id: 11 },
    })
    const noDueLow = cand({ severity: 'low', entityRef: { kind: 'risk', id: 12 } })
    const queue = projectAttentionQueue([overdueMedium, futureHigh, noDueLow], 100)
    expect(queue.items.map((i) => i.entityRef?.id)).toEqual([11, 10, 12])
  })

  it('stale 候选保留 stale=true 并排在同级非 stale 之前（转复核语义）', () => {
    const staleItem = cand({
      stale: true,
      entityRef: { kind: 'risk', id: 20 },
      occurredAt: new Date(FIXED_NOW).toISOString(),
    })
    const freshItem = cand({
      stale: false,
      entityRef: { kind: 'risk', id: 21 },
      occurredAt: new Date(FIXED_NOW).toISOString(),
    })
    const queue = projectAttentionQueue([freshItem, staleItem], 100)
    expect(queue.items[0]?.stale).toBe(true)
  })

  it('截断到 limit 并返回准确 truncation 元数据', () => {
    const items = Array.from({ length: 130 }, (_, i) =>
      cand({ entityRef: { kind: 'risk', id: i + 1 } }),
    )
    const queue = projectAttentionQueue(items, 100)
    expect(queue.items).toHaveLength(100)
    expect(queue.truncation).toEqual({
      requestedLimit: 100,
      returned: 100,
      omitted: 30,
      truncated: true,
    })
  })

  it('large-project fixture：120 条候选按 limit=100 截断且顺序确定', () => {
    const scenario = fixtureLargeProject()
    const first = projectAttentionQueue(scenario.attentionCandidates, 100)
    const second = projectAttentionQueue(scenario.attentionCandidates, 100)
    expect(first.items.map((i) => i.attentionId)).toEqual(second.items.map((i) => i.attentionId))
    expect(first.items).toHaveLength(100)
    expect(first.truncation.omitted).toBe(20)
    // 复核逾期风险（critical）排最前
    expect(first.items[0]?.sourceKey).toBe(COMMAND_CENTER_SOURCES.RISK_WORKBENCH)
    expect(first.items[0]?.reasonCode).toBe('RISK_REVIEW_OVERDUE')
  })

  it('compare 直接比较：时间戳新者优先（同 severity 同 stale）', () => {
    const newer = cand({ occurredAt: new Date(FIXED_NOW).toISOString() })
    const older = cand({ occurredAt: new Date(FIXED_NOW - 1000).toISOString() })
    expect(compareCommandCenterAttention(newer, older)).toBeLessThan(0)
  })
})

// ─── 2.9/2.10 safe-target 与低敏扫描 ──────────────────────────────────────────

describe('validateSafeTarget', () => {
  const ctx = { projectId: 101 }

  it('接受每个闭集 kind 的合法目标', () => {
    expect(validateSafeTarget({ kind: 'risk-workbench', params: { projectId: 101 } }, ctx)).toEqual(
      {
        ok: true,
        target: { kind: 'risk-workbench', params: { projectId: 101 } },
      },
    )
    expect(
      validateSafeTarget(
        { kind: 'health-evidence', params: { projectId: 101, diagnosisId: 9001 } },
        ctx,
      ).ok,
    ).toBe(true)
    expect(
      validateSafeTarget({ kind: 'task-detail', params: { projectId: 101, taskId: 7 } }, ctx).ok,
    ).toBe(true)
  })

  it('拒绝未知 kind 与未知 params 键（伪造 URL / 自由字段）', () => {
    expect(validateSafeTarget({ kind: 'external-dashboard', params: {} }, ctx).ok).toBe(false)
    expect(
      validateSafeTarget({ kind: 'risk-workbench', params: { href: 'https://evil.example' } }, ctx)
        .ok,
    ).toBe(false)
    expect(
      validateSafeTarget({ kind: 'task-detail', params: { projectId: 101, url: '/x' } }, ctx).ok,
    ).toBe(false)
    expect(validateSafeTarget(null, ctx).ok).toBe(false)
    expect(validateSafeTarget('https://evil.example', ctx).ok).toBe(false)
  })

  it('拒绝跨项目 projectId', () => {
    const r = validateSafeTarget(
      { kind: 'risk-detail', params: { projectId: 999, riskId: 1 } },
      ctx,
    )
    expect(r).toMatchObject({ ok: false, code: 'cross-project' })
  })

  it('拒绝写/确认句柄类 params（method/token 不在白名单）', () => {
    expect(validateSafeTarget({ kind: 'risk-detail', params: { method: 'POST' } }, ctx).ok).toBe(
      false,
    )
    expect(
      validateSafeTarget({ kind: 'health-evidence', params: { confirmToken: 'x' } }, ctx).ok,
    ).toBe(false)
  })

  it('拒绝畸形参数值', () => {
    expect(validateSafeTarget({ kind: 'risk-detail', params: { riskId: 'one' } }, ctx).ok).toBe(
      false,
    )
    expect(validateSafeTarget({ kind: 'risk-detail', params: { riskId: -1 } }, ctx).ok).toBe(false)
  })

  it('目标 kind 词表覆盖 design D7 全部九种', () => {
    expect([...COMMAND_CENTER_TARGET_KIND_VALUES].sort()).toEqual(
      [
        'change-impact',
        'health-evidence',
        'milestone-view',
        'prediction-workbench',
        'project-dashboard',
        'resource-workbench',
        'risk-detail',
        'risk-workbench',
        'task-detail',
      ].sort(),
    )
  })
})

describe('detectForbiddenFields 低敏扫描', () => {
  it('捕获 secret/token/url/method/confirm handle 类键', () => {
    const findings = detectForbiddenFields({
      data: {
        nested: [{ apiKey: 'x' }],
        href: 'https://x',
        previewToken: 't',
      },
    })
    const keys = findings.map((f) => f.key.toLowerCase())
    expect(keys).toContain('apikey')
    expect(keys).toContain('href')
    expect(keys).toContain('previewtoken')
  })

  it('禁用键词表包含 confirmation handle 与 model output', () => {
    for (const key of ['confirmhandle', 'modeloutput', 'prompt', 'authorization']) {
      expect(COMMAND_CENTER_FORBIDDEN_KEYS).toContain(key)
    }
  })

  it('正常低敏投影零命中', () => {
    const findings = detectForbiddenFields({
      data: {
        project: { id: 101 },
        headline: { healthStatus: 'yellow', overallScore: 74 },
        sources: [
          {
            sourceKey: 'risk-workbench',
            meta: { availability: 'available', freshness: 'current', reasonCode: null },
            facts: { totalRisks: 12, highRiskCount: 2 },
          },
        ],
        attention: [],
      },
      meta: { contractVersion: COMMAND_CENTER_CONTRACT_VERSION, projectionSignature: 'abcd1234' },
    })
    expect(findings).toEqual([])
  })

  it('发现数受 maxFindings 上限约束', () => {
    const big = Array.from({ length: 100 }, (_, i) => ({ token: i }))
    expect(detectForbiddenFields(big, 10)).toHaveLength(10)
  })
})

describe('checkLensContribution lens 隔离', () => {
  it('插件缺失/禁用（contribution 缺席）→ lens-unsupported，核心投影不受影响', () => {
    expect(checkLensContribution({ contributionPresent: false, declaredActions: [] })).toEqual({
      accepted: false,
      reason: 'lens-unsupported',
    })
  })

  it('lens 声明写动作（confirm/accept/update）→ 拒绝并指出动作', () => {
    const r = checkLensContribution({
      contributionPresent: true,
      declaredActions: ['render-summary', 'confirm-diagnosis'],
    })
    expect(r).toEqual({
      accepted: false,
      reason: 'write-action-declared',
      rejectedAction: 'confirm-diagnosis',
    })
    expect(
      checkLensContribution({ contributionPresent: true, declaredActions: ['accept-risk'] })
        .accepted,
    ).toBe(false)
    expect(
      checkLensContribution({ contributionPresent: true, declaredActions: ['update-resource'] })
        .accepted,
    ).toBe(false)
  })

  it('纯展示贡献可被接受', () => {
    expect(
      checkLensContribution({ contributionPresent: true, declaredActions: ['render-chart'] }),
    ).toEqual({ accepted: true })
  })
})

// ─── fixtures 时间注入纪律 ─────────────────────────────────────────────────────

describe('fixtures determinism', () => {
  it('fixtures 参考时间为固定常量且与注入时钟一致', () => {
    expect(COMMAND_CENTER_FIXTURE_NOW_MS).toBe(FIXED_NOW)
    setCommandCenterNow(COMMAND_CENTER_FIXTURE_NOW_MS)
    expect(fixtureLargeProject().nowMs).toBe(FIXED_NOW)
  })
})
