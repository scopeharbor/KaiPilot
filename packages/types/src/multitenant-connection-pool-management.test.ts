// v3-multitenant-connection-pool-management — 共享契约单测。
// 覆盖：valid decisions、forbidden sensitive fields、system-scope declarations、fixture 序列化。
import { describe, it, expect } from 'vitest'
import {
  TCPM_POOL_KINDS,
  TCPM_POOL_DECISIONS,
  TCPM_DEGRADED_REASONS,
  TCPM_CIRCUIT_STATES,
  TCPM_FALLBACK_MODES,
  TCPM_METRICS_LABEL_POLICIES,
  TCPM_POOL_ERROR_CODES,
  TCPM_FORBIDDEN_POOL_LABELS,
  TCPM_TERMINAL_DECISIONS,
  isTcpmPoolKind,
  isTcpmPoolDecision,
  isTcpmDegradedReason,
  isTcpmCircuitState,
  isTcpmFallbackMode,
  isTcpmMetricsLabelPolicy,
  isTcpmPoolErrorCode,
  tcpmDetectForbiddenPoolLabels,
  tcpmHasForbiddenPoolLabels,
  tcpmRedactForbiddenPoolLabels,
  tcpmValidateMetricsLabel,
  tcpmResolveBudget,
  tcpmBuildLease,
  tcpmBuildMetricsLabel,
  tcpmBuildJobPoolMetadata,
  type TcpmPoolMetricsLabel,
} from './multitenant-connection-pool-management.js'
import {
  TCPM_SAMPLE_CATALOG_ENTRIES,
  TCPM_AI_CATALOG_ENTRY,
  TCPM_DB_CATALOG_ENTRY,
  buildOrgABudget,
  buildOrgAAcquireRequest,
  buildGrantedLease,
  buildSystemGlobalContext,
  MT_ORG_A_ID,
} from './multitenant-connection-pool-management-fixtures.js'
import { buildTenantScopeSnapshot } from './multitenant-isolation-architecture.js'

describe('连接池共享契约：枚举与类型守卫', () => {
  it('pool kind 覆盖所有连接资源形态', () => {
    expect(TCPM_POOL_KINDS).toContain('database')
    expect(TCPM_POOL_KINDS).toContain('cache')
    expect(TCPM_POOL_KINDS).toContain('provider')
    expect(TCPM_POOL_KINDS).toContain('job')
    expect(TCPM_POOL_KINDS).toContain('export')
    expect(TCPM_POOL_KINDS).toContain('local-only')
  })

  it('pool decision 覆盖 lease lifecycle 全部状态', () => {
    for (const d of [
      'granted',
      'queued',
      'released',
      'timeout',
      'rejected',
      'degraded',
      'circuit_open',
      'cancelled',
    ]) {
      expect(TCPM_POOL_DECISIONS).toContain(d as never)
    }
  })

  it('terminal decisions 不包含活跃态', () => {
    expect(TCPM_TERMINAL_DECISIONS).not.toContain('granted')
    expect(TCPM_TERMINAL_DECISIONS).not.toContain('queued')
  })

  it('类型守卫拒绝非法值', () => {
    expect(isTcpmPoolKind('database')).toBe(true)
    expect(isTcpmPoolKind('invalid')).toBe(false)
    expect(isTcpmPoolDecision('granted')).toBe(true)
    expect(isTcpmPoolDecision('invalid')).toBe(false)
    expect(isTcpmDegradedReason('fallback_local')).toBe(true)
    expect(isTcpmDegradedReason('invalid')).toBe(false)
    expect(isTcpmCircuitState('open')).toBe(true)
    expect(isTcpmCircuitState('invalid')).toBe(false)
    expect(isTcpmFallbackMode('fail_closed')).toBe(true)
    expect(isTcpmFallbackMode('invalid')).toBe(false)
    expect(isTcpmMetricsLabelPolicy('low_sensitive')).toBe(true)
    expect(isTcpmMetricsLabelPolicy('invalid')).toBe(false)
    expect(isTcpmPoolErrorCode('CONNECTION_POOL_EXHAUSTED')).toBe(true)
    expect(isTcpmPoolErrorCode('invalid')).toBe(false)
  })

  it('pool error codes 覆盖所有非泄露错误语义', () => {
    for (const c of TCPM_POOL_ERROR_CODES) {
      expect(c).toMatch(/^CONNECTION_POOL_/)
    }
  })
})

describe('连接池共享契约：禁止敏感字段检测', () => {
  it('forbidden labels 包含组织名/邮箱/token/连接串/完整 SQL/prompt/输出', () => {
    expect(TCPM_FORBIDDEN_POOL_LABELS).toContain('organizationName')
    expect(TCPM_FORBIDDEN_POOL_LABELS).toContain('userEmail')
    expect(TCPM_FORBIDDEN_POOL_LABELS).toContain('token')
    expect(TCPM_FORBIDDEN_POOL_LABELS).toContain('authorization')
    expect(TCPM_FORBIDDEN_POOL_LABELS).toContain('connectionString')
    expect(TCPM_FORBIDDEN_POOL_LABELS).toContain('fullSql')
    expect(TCPM_FORBIDDEN_POOL_LABELS).toContain('prompt')
    expect(TCPM_FORBIDDEN_POOL_LABELS).toContain('modelOutput')
    expect(TCPM_FORBIDDEN_POOL_LABELS).toContain('fullPayload')
  })

  it('forbidden labels 包含其他租户活跃数/队列细节（侧信道）', () => {
    expect(TCPM_FORBIDDEN_POOL_LABELS).toContain('otherTenantActive')
    expect(TCPM_FORBIDDEN_POOL_LABELS).toContain('globalActiveCount')
  })

  it('检测对象中的禁止字段（含嵌套）', () => {
    const obj = {
      scopeHash: 'abc123',
      poolKind: 'database',
      nested: { token: 'secret-value', organizationName: 'Acme Corp' },
    }
    const found = tcpmDetectForbiddenPoolLabels(obj)
    expect(found).toContain('nested.token')
    expect(found).toContain('nested.organizationName')
    expect(found).not.toContain('scopeHash')
  })

  it('tcpmHasForbiddenPoolLabels 返回布尔', () => {
    expect(tcpmHasForbiddenPoolLabels({ scopeHash: 'abc' })).toBe(false)
    expect(tcpmHasForbiddenPoolLabels({ token: 'x' })).toBe(true)
  })

  it('redact 递归删除禁止字段，保留合法字段', () => {
    const obj = {
      scopeHash: 'abc123',
      poolKind: 'database',
      token: 'secret',
      nested: { userEmail: 'a@b.com', decision: 'granted' },
    }
    const redacted = tcpmRedactForbiddenPoolLabels(obj)
    expect(redacted.scopeHash).toBe('abc123')
    expect(redacted.poolKind).toBe('database')
    expect(redacted).not.toHaveProperty('token')
    expect(redacted.nested).not.toHaveProperty('userEmail')
    expect(redacted.nested.decision).toBe('granted')
  })

  it('validate metrics label 拒绝含禁止字段的 label', () => {
    const goodLabel: TcpmPoolMetricsLabel = {
      scopeHash: 'abc123',
      poolKind: 'database',
      resourceKey: 'db:primary',
      operationKind: 'read',
      decision: 'granted',
      queueWaitMs: 0,
      durationMs: 10,
      timeoutMs: 30000,
      retryCount: 0,
      circuitState: 'closed',
      requestId: 'req-001',
      actorRef: 'user:1',
    }
    expect(tcpmValidateMetricsLabel(goodLabel)).toEqual([])

    const badLabel = { ...goodLabel, organizationName: 'Acme' } as unknown as TcpmPoolMetricsLabel
    expect(tcpmValidateMetricsLabel(badLabel)).toContain('organizationName')
  })
})

describe('连接池共享契约：budget 解析', () => {
  it('从 catalog + tenant 解析有效 budget，scope hash 低敏', () => {
    const budget = buildOrgABudget(TCPM_DB_CATALOG_ENTRY)
    expect(budget.resourceKey).toBe('db:primary')
    expect(budget.poolKind).toBe('database')
    expect(budget.tenantLimit).toBe(5)
    expect(budget.globalLimit).toBe(10)
    expect(budget.scopeHash).toMatch(/^[0-9a-f]+$/)
    expect(budget.organizationId).toBe(MT_ORG_A_ID)
    expect(budget.isSystemScope).toBe(false)
  })

  it('system_global scope 解析为 isSystemScope=true', () => {
    const budget = tcpmResolveBudget(TCPM_DB_CATALOG_ENTRY, buildSystemGlobalContext())
    expect(budget.isSystemScope).toBe(true)
  })

  it('budget 不信任客户端 organizationId（来自 tenant context）', () => {
    const req = buildOrgAAcquireRequest('db:primary')
    const budget = tcpmResolveBudget(TCPM_DB_CATALOG_ENTRY, req.tenant)
    expect(budget.organizationId).toBe(req.tenant.organizationId)
  })

  it('env overrides 覆盖 catalog 默认值', () => {
    const budget = buildOrgABudget(TCPM_DB_CATALOG_ENTRY, {
      tenantLimit: 99,
      globalLimit: 100,
    })
    expect(budget.tenantLimit).toBe(99)
    expect(budget.globalLimit).toBe(100)
  })
})

describe('连接池共享契约：lease 构造与 metrics label', () => {
  it('lease 绑定 pool/resource/scope，不含敏感字段', () => {
    const budget = buildOrgABudget(TCPM_AI_CATALOG_ENTRY)
    const lease = buildGrantedLease({ budget, operationKind: 'ai_context' })
    expect(lease.resourceKey).toBe('ai:gateway')
    expect(lease.poolKind).toBe('provider')
    expect(lease.scopeHash).toBe(budget.scopeHash)
    expect(lease.operationKind).toBe('ai_context')
    expect(lease.degraded).toBe(false)
    expect(tcpmHasForbiddenPoolLabels(lease)).toBe(false)
  })

  it('metrics label 从 lease + 决策构造，剔除内部 organizationId', () => {
    const budget = buildOrgABudget(TCPM_AI_CATALOG_ENTRY)
    const lease = buildGrantedLease({ budget })
    const label = tcpmBuildMetricsLabel({
      lease,
      budget,
      decision: 'granted',
      durationMs: 42,
      retryCount: 0,
      circuitState: 'closed',
      queueWaitMs: 0,
      timeoutMs: 60000,
      actorRef: 'user:1',
    })
    expect(label.scopeHash).toBe(budget.scopeHash)
    expect(label.decision).toBe('granted')
    expect(label.durationMs).toBe(42)
    expect(label).not.toHaveProperty('organizationId')
    expect(tcpmValidateMetricsLabel(label)).toEqual([])
  })

  it('lease 为 null 的拒绝路径仍能带上低敏 operationKind/requestId 与 errorCode', () => {
    const budget = buildOrgABudget(TCPM_AI_CATALOG_ENTRY)
    const label = tcpmBuildMetricsLabel({
      lease: null,
      budget,
      decision: 'rejected',
      durationMs: 1,
      retryCount: 0,
      circuitState: 'closed',
      queueWaitMs: 0,
      timeoutMs: 3000,
      actorRef: 'user:1',
      operationKind: 'ai_context',
      requestId: 'req-1',
      errorCode: 'CONNECTION_POOL_EXHAUSTED',
    })
    expect(label.operationKind).toBe('ai_context')
    expect(label.requestId).toBe('req-1')
    expect(label.errorCode).toBe('CONNECTION_POOL_EXHAUSTED')
    // errorCode 是枚举而非自由文本，本身不构成敏感信息
    expect(tcpmValidateMetricsLabel(label)).toEqual([])
  })

  it('system maintenance 标记进 label（放行/拒绝都要能自审计）', () => {
    const budget = buildOrgABudget(TCPM_AI_CATALOG_ENTRY)
    const denied = tcpmBuildMetricsLabel({
      lease: null,
      budget,
      decision: 'rejected',
      durationMs: 0,
      retryCount: 0,
      circuitState: 'closed',
      queueWaitMs: 0,
      timeoutMs: 3000,
      actorRef: 'system',
      errorCode: 'CONNECTION_POOL_SYSTEM_SCOPE_DENIED',
      isSystemScope: true,
    })
    expect(denied.isSystemScope).toBe(true)
    expect(denied.errorCode).toBe('CONNECTION_POOL_SYSTEM_SCOPE_DENIED')
    expect(tcpmValidateMetricsLabel(denied)).toEqual([])

    // 未显式传入时回落 budget 的 scope mode 推导值
    const normal = tcpmBuildMetricsLabel({
      lease: null,
      budget,
      decision: 'queued',
      durationMs: 0,
      retryCount: 0,
      circuitState: 'closed',
      queueWaitMs: 0,
      timeoutMs: 3000,
      actorRef: 'user:1',
    })
    expect(normal.isSystemScope).toBe(budget.isSystemScope)
    expect(normal.errorCode).toBeNull()
  })
})

describe('连接池共享契约：job pool metadata', () => {
  it('job metadata 含 scope snapshot + pool resource keys + permission hash', () => {
    const snapshot = buildTenantScopeSnapshot({
      actorRef: 'user:1',
      organizationId: MT_ORG_A_ID,
      scopeMode: 'organization_scoped',
      sourceRefs: ['res:hash:1'],
      permissionSnapshotHash: 'permhash',
      idempotencyKey: 'idem-001',
      requestId: 'req-001',
    })
    const meta = tcpmBuildJobPoolMetadata({
      scopeSnapshot: snapshot,
      requestId: 'req-001',
      idempotencyKey: 'idem-001',
      poolResourceKeys: ['db:primary', 'compiler:run'],
      roleVersion: 3,
      organizationId: MT_ORG_A_ID,
      scopeMode: 'organization_scoped',
    })
    expect(meta.poolResourceKeys).toEqual(['db:primary', 'compiler:run'])
    expect(meta.requestId).toBe('req-001')
    expect(meta.permissionSnapshotHash).toMatch(/^[0-9a-f]+$/)
    expect(meta.scopeSnapshot.organizationId).toBe(MT_ORG_A_ID)
  })

  it('job metadata 不含 raw JWT/secret/provider payload', () => {
    const snapshot = buildTenantScopeSnapshot({
      actorRef: 'user:1',
      organizationId: MT_ORG_A_ID,
      scopeMode: 'organization_scoped',
      sourceRefs: [],
      permissionSnapshotHash: 'permhash',
      idempotencyKey: 'idem-001',
      requestId: 'req-001',
    })
    const meta = tcpmBuildJobPoolMetadata({
      scopeSnapshot: snapshot,
      requestId: 'req-001',
      idempotencyKey: 'idem-001',
      poolResourceKeys: ['db:primary'],
      roleVersion: 1,
      organizationId: MT_ORG_A_ID,
      scopeMode: 'organization_scoped',
    })
    expect(tcpmHasForbiddenPoolLabels(meta)).toBe(false)
  })
})

describe('连接池共享契约：fixture 序列化与 catalog 完整性', () => {
  it('sample catalog entries 全部有合法 pool kind 与 fixture name', () => {
    for (const entry of TCPM_SAMPLE_CATALOG_ENTRIES) {
      expect(isTcpmPoolKind(entry.poolKind)).toBe(true)
      expect(entry.fixtureName.length).toBeGreaterThan(0)
      expect(entry.resourceKey.length).toBeGreaterThan(0)
      expect(entry.adapterName.length).toBeGreaterThan(0)
      expect(entry.globalLimit).toBeGreaterThan(0)
      expect(entry.defaultTenantLimit).toBeGreaterThan(0)
      expect(isTcpmFallbackMode(entry.fallbackMode)).toBe(true)
      expect(isTcpmMetricsLabelPolicy(entry.metricsLabelPolicy)).toBe(true)
    }
  })

  it('sample catalog entries 资源键唯一', () => {
    const keys = TCPM_SAMPLE_CATALOG_ENTRIES.map((e) => e.resourceKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('fixture 对象可 JSON 序列化往返（无循环引用）', () => {
    for (const entry of TCPM_SAMPLE_CATALOG_ENTRIES) {
      const json = JSON.stringify(entry)
      const parsed = JSON.parse(json)
      expect(parsed.resourceKey).toBe(entry.resourceKey)
    }
  })

  it('高风险 catalog entries 默认 systemScopeAllowed=false', () => {
    for (const entry of TCPM_SAMPLE_CATALOG_ENTRIES) {
      if (entry.poolKind !== 'local-only') {
        expect(entry.systemScopeAllowed).toBe(false)
      }
    }
  })
})
