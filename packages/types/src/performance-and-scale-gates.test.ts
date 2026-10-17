/**
 * performance-and-scale-gates.test —— V3 性能与规模门禁共享契约测试（任务 2.5）。
 *
 * 证明：
 * - 合法报告通过 schema 校验；非法报告逐项报错。
 * - catalog 校验：缺必填字段 / 重复 id / 未知 surface / 缺预算 / 预算不兼容各自报错且 kind 正确。
 * - 状态迁移表：合法迁移放行、非法迁移拦截、自环合法。
 * - waiver 过期判定：过期/未过期/无 expiry 语义正确。
 * - redaction guard：secret/token/authorization header/prompt/model output/provider payload/
 *   webhook body/oversized log 全部被打码，剩余敏感命中为 0，warnings 只含低敏字段。
 */
import { describe, expect, it } from 'vitest'
import {
  ALLOWED_STATUS_TRANSITIONS,
  GATE_PROFILES,
  GATE_SURFACES,
  REQUIRED_V3_HIGH_RISK_SURFACES,
  canTransitionStatus,
  containsSensitiveContent,
  countSensitiveHits,
  fnv1aHash,
  isGateSurface,
  isWaiverExpired,
  makeReportId,
  redactSensitiveText,
  validateGateCatalog,
  validateGateCatalogEntry,
  validateReportSchema,
  type GateCatalogEntry,
  type PerformanceScaleGateReport,
  type Waiver,
} from './performance-and-scale-gates.js'

const validEntry: GateCatalogEntry = {
  id: 'sample-gate',
  surface: 'project-task-wbs-gantt',
  ownerCapability: 'project-management',
  scopeKind: 'change',
  profile: 'smoke',
  fixtureProfile: 'smoke',
  probeKind: 'fixture',
  metrics: [{ metric: 'tasks', kind: 'count', hard: 100, soft: 50 }],
  phase: 'apply',
  severity: 'blocking',
  evidencePolicy: { allowedEvidenceKinds: ['fixture-id'], maxOutputBytes: 1024 },
  authorizationBoundary: 'fixture-mock',
  allowedReasonCodes: ['surface-not-stable'],
}

const validReport: PerformanceScaleGateReport = {
  schemaVersion: '1.0',
  reportId: 'perf-test',
  generatedAt: '2026-08-16T00:00:00.000Z',
  commit: 'abc123',
  profile: 'smoke',
  environment: {
    platform: 'win32',
    nodeVersion: 'v20',
    commit: 'abc123',
    profile: 'smoke',
    graphFreshness: 'unknown',
  },
  observation: { graphFreshness: 'unknown', sourceFallbackRefs: [] },
  commands: [],
  gates: [],
  metricSummaries: [],
  status: 'passed',
  redactionSummary: { redactedCount: 0, reasons: {} },
  evidenceRefs: [],
  waiverRefs: [],
  sourceFallback: { used: false, refs: [], graphIncomplete: false },
}

describe('报告 schema 校验', () => {
  it('合法报告零 issue', () => {
    expect(validateReportSchema(validReport)).toEqual([])
  })

  it('缺 schemaVersion / reportId / status 逐项报错', () => {
    const issues = validateReportSchema({
      ...validReport,
      schemaVersion: '0.9',
      reportId: undefined,
      status: 'nope',
      gates: undefined,
    })
    expect(issues).toContain('schemaVersion 必须为 1.0')
    expect(issues).toContain('缺 reportId')
    expect(issues).toContain('status 非法')
    expect(issues).toContain('gates 必须是数组')
  })

  it('非对象报告直接报错', () => {
    expect(validateReportSchema(null)).toEqual(['报告不是对象'])
  })
})

describe('catalog 校验 helpers', () => {
  it('合法条目零 issue', () => {
    expect(validateGateCatalogEntry(validEntry)).toEqual([])
  })

  it('缺必填字段报 missing-field', () => {
    const issues = validateGateCatalogEntry({ ...validEntry, id: '' })
    expect(issues.some((i) => i.kind === 'missing-field' && i.message.includes('id'))).toBe(true)
  })

  it('未知 surface 报 unknown-surface', () => {
    const issues = validateGateCatalogEntry({
      ...validEntry,
      surface: 'unknown-surface-x' as never,
    })
    expect(issues.some((i) => i.kind === 'unknown-surface')).toBe(true)
  })

  it('缺预算（hard/soft 均缺）报 budget-incompatible', () => {
    const issues = validateGateCatalogEntry({
      ...validEntry,
      metrics: [{ metric: 'tasks', kind: 'count' }],
    })
    expect(
      issues.some((i) => i.kind === 'budget-incompatible' && i.message.includes('tasks')),
    ).toBe(true)
  })

  it('hard < soft 报 budget-incompatible', () => {
    const issues = validateGateCatalogEntry({
      ...validEntry,
      metrics: [{ metric: 'tasks', kind: 'count', hard: 10, soft: 100 }],
    })
    expect(issues.some((i) => i.kind === 'budget-incompatible')).toBe(true)
  })

  it('重复 id 报 duplicate-id', () => {
    const issues = validateGateCatalog([validEntry, validEntry])
    expect(issues.some((i) => i.kind === 'duplicate-id' && i.gateId === 'sample-gate')).toBe(true)
  })

  it('probe 类 gate 不要求 command；focused-test 类缺 command 报 missing-command', () => {
    expect(validateGateCatalogEntry(validEntry).some((i) => i.kind === 'missing-command')).toBe(
      false,
    )
    const issues = validateGateCatalogEntry({
      ...validEntry,
      id: 'cmd-gate',
      probeKind: 'focused-test',
      command: undefined,
    })
    expect(issues.some((i) => i.kind === 'missing-command')).toBe(true)
  })

  it('requires-user-authorization 边界必须显式登记 reason codes', () => {
    const issues = validateGateCatalogEntry({
      ...validEntry,
      id: 'auth-gate',
      authorizationBoundary: 'requires-user-authorization',
      allowedReasonCodes: ['external-not-authorized'],
    })
    expect(issues.some((i) => i.kind === 'authorization-boundary')).toBe(false)
  })
})

describe('状态迁移', () => {
  it('合法迁移放行，非法迁移拦截，自环合法', () => {
    expect(canTransitionStatus('blocked', 'waived')).toBe(true)
    expect(canTransitionStatus('skipped', 'waived')).toBe(true)
    expect(canTransitionStatus('passed', 'blocked')).toBe(false)
    expect(canTransitionStatus('blocked', 'passed')).toBe(true)
    expect(canTransitionStatus('passed', 'passed')).toBe(true)
  })

  it('迁移表覆盖全部状态', () => {
    for (const s of Object.keys(ALLOWED_STATUS_TRANSITIONS)) {
      expect(
        Array.isArray(ALLOWED_STATUS_TRANSITIONS[s as keyof typeof ALLOWED_STATUS_TRANSITIONS]),
      ).toBe(true)
    }
  })
})

describe('waiver 过期', () => {
  const now = new Date('2026-08-16T00:00:00.000Z')
  const mk = (expiresAt?: string): Waiver => ({
    waiverId: 'w',
    type: 'temporary',
    gateIds: ['g1'],
    reason: '本机负载波动（示例）',
    approverCategory: 'tech-lead',
    ...(expiresAt ? { expiresAt } : {}),
  })

  it('过期 waiver 判定为过期', () => {
    expect(isWaiverExpired(mk('2026-01-01T00:00:00.000Z'), now)).toBe(true)
  })

  it('未过期 waiver 不判定过期', () => {
    expect(isWaiverExpired(mk('2999-01-01T00:00:00.000Z'), now)).toBe(false)
  })

  it('无 expiresAt 视为永不过期；非法日期视为不过期', () => {
    expect(isWaiverExpired(mk(), now)).toBe(false)
    expect(isWaiverExpired(mk('not-a-date'), now)).toBe(false)
  })
})

describe('redaction guard 行为', () => {
  const sensitiveSample =
    'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc \n' +
    'sk-proj-abcdefghijklmnopqrstuvwxyz123456 \n' +
    '-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n' +
    'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456 \n' +
    'system prompt: 你是一个助手 model_output: choices[0].text=hello x-hub-signature: sha1=deadbeef \n' +
    'tenant_id: org-42-very-long-tenant-identifier'

  it('敏感样本被完全打码，剩余命中为 0', () => {
    const redacted = redactSensitiveText(sensitiveSample)
    expect(countSensitiveHits(redacted.text)).toBe(0)
    expect(containsSensitiveContent(redacted.text)).toBe(false)
    expect(redacted.redactedCount).toBeGreaterThan(0)
  })

  it('warnings 只含低敏字段（reason/byteCount/hash）', () => {
    const redacted = redactSensitiveText(sensitiveSample)
    for (const w of redacted.warnings) {
      expect(typeof w.reason).toBe('string')
      expect(typeof w.byteCount).toBe('number')
      expect(/^[0-9a-f]{8}$/.test(w.hash)).toBe(true)
      expect(w).not.toHaveProperty('content')
    }
  })

  it('明文输出不含任何敏感关键词', () => {
    expect(containsSensitiveContent('普通任务输出 123')).toBe(false)
  })

  it('超长日志按 oversized-log 截断并记录 hash', () => {
    const big = 'x'.repeat(200_000)
    const redacted = redactSensitiveText(big, 1024)
    expect(redacted.warnings.some((w) => w.reason === 'oversized-log')).toBe(true)
    expect(redacted.text.startsWith('[REDACTED:oversized-log:')).toBe(true)
    expect(redacted.text.length).toBeLessThan(2000)
  })

  it('fnv1aHash 确定性且区分输入', () => {
    expect(fnv1aHash('abc')).toBe(fnv1aHash('abc'))
    expect(fnv1aHash('abc')).not.toBe(fnv1aHash('abd'))
  })
})

describe('常量与守卫', () => {
  it('首批 V3 high-risk surfaces 全部在 GATE_SURFACES 内', () => {
    for (const s of REQUIRED_V3_HIGH_RISK_SURFACES) {
      expect(isGateSurface(s)).toBe(true)
      expect(GATE_SURFACES).toContain(s)
    }
  })

  it('profiles 三档齐全', () => {
    expect(GATE_PROFILES).toEqual(['smoke', 'v3-default', 'stress-local'])
  })

  it('makeReportId 确定性前缀 + profile', () => {
    const id = makeReportId('my-change', 'smoke', new Date('2026-08-16T00:00:00.000Z'))
    expect(id.startsWith('perf-my-change-smoke-')).toBe(true)
  })
})
