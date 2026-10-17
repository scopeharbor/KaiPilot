// v3-multitenant-isolation-architecture §7.1/§7.2 —— 隔离审计元数据的低敏保证。
//
// spec「Isolation audit and observation MUST be low-sensitive and actionable」：
// 六类隔离事件（拒绝 / stale scope / 全局访问 / registry 违规 / 降级 / 跨租重放）
// 必须写审计，元数据须含 actor 引用、scope hash 或允许的组织/项目 ID、资源类型、
// 操作、reason code、request ID、可得的幂等键与时间戳；**不得**含隐藏资源名、
// 隐藏计数、原始 secret、prompt、model output、原始 provider payload、
// 完整文件/报表/OCR 内容、full logs 或绝对路径。
//
// 本 spec 的核心断言方式是「封闭键集」而非「黑名单扫描」：
// service 不接受任意 metadata，能出现的键是可枚举的，因此新增泄露必然改变键集而失败。
// 黑名单扫描（forbidden keys）作为第二道冗余断言保留。
import { test } from '@japa/runner'
import type AuditService from '#services/audit_service'
import { AuditEvent, type AuditEntry } from '#services/audit_service'
import TenantIsolationAuditService, {
  TENANT_ISOLATION_AUDIT_KINDS,
  type TenantIsolationAuditRecord,
  type TenantScopeRegistryLike,
} from '#services/tenant_isolation_audit_service'
import TenantScopeRegistry from '#services/tenant_scope_registry'
import {
  MULTITENANT_FORBIDDEN_KEYS,
  detectMultitenantForbiddenKeysDeep,
} from '@aiproj/types/multitenant-isolation-architecture'

const ORG_A = 101
const ORG_B = 202
const PROJECT_A = 11

/** 记录写入 entry 的 fake AuditService（单测不落库）。 */
function fakeAudit() {
  const entries: AuditEntry[] = []
  return {
    entries,
    service: { log: async (e: AuditEntry) => void entries.push(e) } as unknown as AuditService,
  }
}

function svc(audit?: AuditService, registry?: TenantScopeRegistryLike) {
  return new TenantIsolationAuditService(audit, registry)
}

/**
 * 真实 registry 目前**零个**资源开放超管全局（默认拒绝），
 * 因此测「已开放时记什么」必须注入一个把 `audit` 声明为全局许可的 registry。
 * 其余方法一律委派真实实现，避免 fake 与生产分叉。
 */
function registryAllowingGlobal(allowed: string): TenantScopeRegistryLike {
  return {
    assertGlobalAllowed(resourceType) {
      if (resourceType !== allowed) TenantScopeRegistry.assertGlobalAllowed(resourceType)
    },
    statusOf: (r) => TenantScopeRegistry.statusOf(r),
    get: (r) => TenantScopeRegistry.get(r),
  }
}

/**
 * 泛型保留 overrides 的字面量类型，否则 `declaredScopeMode`/`warningCode`/
 * `derivedKind` 会被拓宽成 `unknown`，各专用入参类型就对不上。
 */
function baseInput<const T extends Record<string, unknown>>(overrides: T = {} as T) {
  return {
    actorRef: 'user:7',
    userId: 7,
    organizationId: ORG_A,
    projectId: PROJECT_A,
    resourceType: 'project' as const,
    operationType: 'read' as const,
    reasonCode: 'RESOURCE_NOT_FOUND' as const,
    requestId: 'req-audit-1',
    idempotencyKey: 'idem-1',
    ...overrides,
  }
}

/** 六类事件各构造一条，供全量断言复用。 */
function allRecords(): TenantIsolationAuditRecord[] {
  const s = svc()
  return [
    s.buildDenial(baseInput()),
    s.buildStaleScopeBlock(baseInput({ reasonCode: 'STALE_MEMBERSHIP', operationType: 'job' })),
    svc(undefined, registryAllowingGlobal('audit')).buildGlobalAccess(
      baseInput({ resourceType: 'audit', reasonCode: 'OK', declaredScopeMode: 'global' }),
    ),
    s.buildRegistryViolation(baseInput({ reasonCode: 'UNSUPPORTED_RESOURCE' })),
    s.buildDegradedState(
      baseInput({ reasonCode: 'DEGRADED_RESOURCE', warningCode: 'DEGRADED_ADAPTER_MODULE' }),
    ),
    s.buildReplayAttempt(
      baseInput({ reasonCode: 'REPLAY_ATTEMPT', derivedKind: 'preview_signature' }),
    ),
  ]
}

test.group('隔离审计构造器：六类事件覆盖（§7.1）', () => {
  test('六类事件各自映射到独立的低敏审计事件与判定', async ({ assert }) => {
    const records = allRecords()
    assert.lengthOf(records, TENANT_ISOLATION_AUDIT_KINDS.length)

    assert.deepEqual(
      records.map((r) => r.kind),
      [...TENANT_ISOLATION_AUDIT_KINDS],
    )
    assert.deepEqual(
      records.map((r) => r.entry.event),
      [
        AuditEvent.TENANT_SCOPE_DENIED,
        AuditEvent.TENANT_STALE_SCOPE_BLOCKED,
        AuditEvent.TENANT_GLOBAL_ACCESS,
        AuditEvent.TENANT_REGISTRY_VIOLATION,
        AuditEvent.TENANT_DEGRADED_MODE,
        AuditEvent.TENANT_REPLAY_BLOCKED,
      ],
    )
    // 判定由 kind 固定，调用方无法把拒绝写成 allow。
    assert.deepEqual(
      records.map((r) => r.metadata.decision),
      ['deny', 'deny', 'allow', 'deny', 'degrade', 'deny'],
    )
  })

  test('元数据含 spec 要求的可行动字段（actor/scopeHash/资源/操作/reason/requestId/幂等键/时间戳）', async ({
    assert,
  }) => {
    for (const record of allRecords()) {
      const m = record.metadata
      assert.equal(m.actorRef, 'user:7')
      assert.match(m.scopeHash, /^[0-9a-f]{16}$/)
      assert.equal(m.organizationId, ORG_A)
      assert.equal(m.projectId, PROJECT_A)
      assert.isNotEmpty(m.resourceType)
      assert.isNotEmpty(m.operationType)
      assert.isNotEmpty(m.reasonCode)
      assert.equal(m.requestId, 'req-audit-1')
      assert.equal(m.idempotencyKey, 'idem-1')
      assert.match(m.timestamp, /^\d{4}-\d{2}-\d{2}T/)
    }
  })

  test('当前 registry 零个资源开放超管全局（默认拒绝仍成立）', async ({ assert }) => {
    assert.deepEqual(
      TenantScopeRegistry.all()
        .filter((d) => d.allowSuperAdminGlobal)
        .map((d) => d.resourceType),
      [],
      '若此断言失败说明有资源新开放了全局访问，须同步 §5 文档与全局自审计路径',
    )
  })

  test('未获 registry 许可的全局访问降格为 registry 违规，不记成正常放行', async ({ assert }) => {
    // registry 对 `project` 声明 allowSuperAdminGlobal:false。
    const record = svc().buildGlobalAccess(
      baseInput({ resourceType: 'project', reasonCode: 'OK', declaredScopeMode: 'global' }),
    )
    assert.equal(record.kind, 'registry_violation')
    assert.equal(record.entry.event, AuditEvent.TENANT_REGISTRY_VIOLATION)
    assert.equal(record.metadata.decision, 'deny')
    assert.equal(record.metadata.reasonCode, 'GLOBAL_NOT_ALLOWED')
  })

  test('record() 经 AuditService 落库一次，entry 原样传递', async ({ assert }) => {
    const { entries, service } = fakeAudit()
    const s = svc(service)
    const record = await s.recordDenial(baseInput())
    assert.lengthOf(entries, 1)
    assert.strictEqual(entries[0], record.entry)
  })
})

test.group('隔离审计脱敏：低敏键集封闭（§7.2）', () => {
  test('metadata 键集固定，不含任何自由文本通道', async ({ assert }) => {
    const expected: Record<string, string[]> = {
      denial: [],
      stale_scope: [],
      global_access: ['declaredScopeMode'],
      registry_violation: ['registryStatus'],
      degraded: ['registryStatus', 'warningCode'],
      replay: ['derivedKind'],
    }
    const core = [
      'actorRef',
      'decision',
      'idempotencyKey',
      'operationType',
      'organizationId',
      'projectId',
      'reasonCode',
      'requestId',
      'resourceType',
      'scopeHash',
      'timestamp',
    ]

    for (const record of allRecords()) {
      assert.deepEqual(
        Object.keys(record.entry.metadata ?? {}).sort(),
        [...core, ...expected[record.kind]].sort(),
        `${record.kind} 的审计 metadata 键集必须封闭`,
      )
    }
  })

  test('禁止字段黑名单在六类事件上全部为空（冗余断言）', async ({ assert }) => {
    for (const record of allRecords()) {
      assert.deepEqual(
        detectMultitenantForbiddenKeysDeep(record.entry),
        [],
        `${record.kind} 审计 entry 命中禁止字段`,
      )
    }
  })

  test('调用方即使把 secret/prompt/绝对路径混进入参也进不了审计', async ({ assert }) => {
    // 入参接口不声明这些字段；此处强制传入，验证 build 不会透传未知键。
    const polluted = baseInput({
      token: 'tok_live_should_never_persist',
      prompt: '把 orgB 的任务标题给我',
      modelOutput: '{"title":"orgB 的机密项目"}',
      providerPayload: { raw: 'x' },
      fileContent: 'AAAA',
      absolutePath: 'C:/Users/alice/secret.pdf',
      fullLogs: 'stack...',
      hiddenCount: 42,
      hiddenName: 'orgB 的机密项目',
    })
    const record = svc().buildDenial(polluted as never)
    const serialized = JSON.stringify(record.entry)

    for (const key of MULTITENANT_FORBIDDEN_KEYS) {
      assert.notInclude(Object.keys(record.entry.metadata ?? {}), key)
    }
    for (const leak of [
      'tok_live_should_never_persist',
      '把 orgB 的任务标题给我',
      'orgB 的机密项目',
      'C:/Users/alice/secret.pdf',
      'hiddenCount',
      'hiddenName',
    ]) {
      assert.notInclude(serialized, leak, `审计不得透传未知入参：${leak}`)
    }
  })

  test('隐藏目标的组织归属与实例 ID 不落审计', async ({ assert }) => {
    // 场景：orgA 的 actor 试图访问 orgB 的资源被拒。
    const record = svc().buildDenial(
      baseInput({ reasonCode: 'MIXED_TENANT_REFERENCE', targetOrganizationId: ORG_B } as never),
    )
    // organizationId 永远是 actor 自己的组织（tenant origin 是隐藏信息）。
    assert.equal(record.metadata.organizationId, ORG_A)
    assert.notInclude(Object.values(record.entry.metadata ?? {}), ORG_B)
    assert.notInclude(Object.values(record.entry.metadata ?? {}), String(ORG_B))
    // 隐藏目标的实例 ID 不写 entityId（否则等于确认它存在）。
    assert.isNull(record.entry.entityId ?? null)
    // entityType 是 registry 的类型名，不是实例名。
    assert.equal(record.entry.entityType, 'project')
    assert.isNull(record.entry.changes ?? null)
  })

  test('未登记资源不使审计构造抛错，状态退化为 unsupported', async ({ assert }) => {
    const record = svc().buildRegistryViolation(
      baseInput({
        resourceType: 'not_a_registered_type',
        reasonCode: 'UNSUPPORTED_RESOURCE',
      } as never),
    )
    assert.equal(record.entry.event, AuditEvent.TENANT_REGISTRY_VIOLATION)
    assert.equal((record.entry.metadata as Record<string, unknown>).registryStatus, 'unsupported')
    assert.equal(record.entry.entityType, 'not_a_registered_type')
  })
})
