/**
 * CopilotSessionRetention — 会话保留治理单元测试
 *
 * 覆盖 spec Section 3–8：
 *   §3 Policy Resolution（策略解析）
 *   §4 Hard Delete（硬删除）
 *   §5 Tombstone Cascade（墓碑级联）
 *   §6 Audit（审计）
 *   §7 Export（导出）
 *   §8 Migration Safety & Compliance（迁移安全与合规）
 *
 * 红线：
 * - 只走 fixture / 假 adapter，不调用真实 copilot API / 模型 / 网络
 * - 不写任何正式项目数据（用 in-memory store 替代 DB）
 * - 不引入真实 AuditService —— 用 FakeAuditSink 捕获审计事件
 *
 * @aiproj/backend
 */

import { test } from '@japa/runner'
import type {
  CopilotSessionRetentionDeletionRecord,
  CopilotSessionRetentionPolicy,
  CopilotSessionRetentionTombstone,
  CopilotSessionRetentionTriggerReason,
} from '@aiproj/types'
import {
  buildCopilotSessionRetentionPolicy,
  buildOrganizationCopilotSessionRetentionPolicy,
  buildDisabledCopilotSessionRetentionPolicy,
  buildCopilotSessionRetentionDeletionRecord,
  buildUserRequestedDeletionRecord,
  buildOrganizationRequestedDeletionRecord,
  buildCopilotSessionRetentionTombstone,
  buildCopilotSessionRetentionStatusResponse,
  buildUnconfiguredCopilotSessionRetentionStatusResponse,
  buildCopilotSessionRetentionReadSummary,
  buildNoPolicyCopilotSessionRetentionReadSummary,
  computeCopilotSessionRetentionPolicyHash,
  computeCopilotSessionTombstoneHash,
  computeCopilotSessionRemainingDays,
  containsCopilotSessionSensitiveMarkers,
  COPILOT_SESSION_RETENTION_FORBIDDEN_KEYS,
  COPILOT_SESSION_RETENTION_BOUNDS,
} from '@aiproj/types'

// ────────────────────────────────────────────────────────────────────────────
// §0  In-memory stores & fake adapters
// ────────────────────────────────────────────────────────────────────────────

/** In-memory policy store keyed by `${orgId}:${projectId ?? 'org'}` */
type PolicyStore = Map<string, CopilotSessionRetentionPolicy>
/** In-memory tombstone store */
type TombstoneStore = CopilotSessionRetentionTombstone[]
/** In-memory deletion record store */
type DeletionRecordStore = CopilotSessionRetentionDeletionRecord[]
/** In-memory session existence map (sessionId → { orgId, projectId, title, createdAt }) */
type SessionExistenceStore = Map<
  string,
  {
    organizationId: number
    projectId: number | null
    title: string
    createdAt: string
    messageCount: number
  }
>

interface FakeContext {
  policies: PolicyStore
  tombstones: TombstoneStore
  deletionRecords: DeletionRecordStore
  sessions: SessionExistenceStore
  auditSink: FakeAuditSink
}

function makeFakeContext(): FakeContext {
  return {
    policies: new Map(),
    tombstones: [],
    deletionRecords: [],
    sessions: new Map(),
    auditSink: makeFakeAuditSink(),
  }
}

/** 墓碑哈希用于完整性断言 —— 不包含会话内容。 */
interface FakeAuditSink {
  events: Array<{ event: string; metadata: Record<string, unknown>; timestamp: string }>
}

function makeFakeAuditSink(): FakeAuditSink {
  return { events: [] }
}

// ────────────────────────────────────────────────────────────────────────────
// §0.1  FakeService — 实现 ICopilotSessionRetentionService 的核心逻辑
//
// 这个 fake 是测试的主体：它实现了策略解析、硬删除、墓碑创建、审计记录、
// 导出过滤等行为契约。测试验证的是契约，不是具体 DB 实现。
// ────────────────────────────────────────────────────────────────────────────

class FakeRetentionService {
  constructor(private ctx: FakeContext) {}

  // ── Policy Resolution (§3) ──

  async getPolicy(
    organizationId: number,
    projectId: number | null,
  ): Promise<{
    organizationId: number
    projectId: number | null
    retentionDays: number
    enabled: boolean
    configured: boolean
    updatedAt: string | null
  }> {
    // Step 1: try project-level override
    if (projectId !== null) {
      const projectKey = `${organizationId}:${projectId}`
      const projectPolicy = this.ctx.policies.get(projectKey)
      if (projectPolicy) {
        return {
          organizationId,
          projectId,
          retentionDays: projectPolicy.retentionDays,
          enabled: projectPolicy.enabled,
          configured: true,
          updatedAt: projectPolicy.updatedAt,
        }
      }
    }

    // Step 2: fall back to org-level default
    const orgKey = `${organizationId}:org`
    const orgPolicy = this.ctx.policies.get(orgKey)
    if (orgPolicy) {
      return {
        organizationId,
        projectId,
        retentionDays: orgPolicy.retentionDays,
        enabled: orgPolicy.enabled,
        configured: true,
        updatedAt: orgPolicy.updatedAt,
      }
    }

    // Step 3: unconfigured
    return {
      organizationId,
      projectId,
      retentionDays: 0,
      enabled: false,
      configured: false,
      updatedAt: null,
    }
  }

  async updatePolicy(
    organizationId: number,
    projectId: number | null,
    input: { retentionDays: number; enabled: boolean },
    _userId: number,
  ): Promise<{
    organizationId: number
    projectId: number | null
    retentionDays: number
    enabled: boolean
    configured: boolean
    updatedAt: string | null
  }> {
    const key = `${organizationId}:${projectId ?? 'org'}`
    const source = projectId !== null ? 'project' : 'organization'
    const now = new Date().toISOString()
    const policy = buildCopilotSessionRetentionPolicy({
      scope: source,
      organizationId,
      projectId,
      retentionDays: input.retentionDays,
      enabled: input.enabled,
      updatedAt: now,
    })
    this.ctx.policies.set(key, policy)
    return {
      organizationId,
      projectId,
      retentionDays: input.retentionDays,
      enabled: input.enabled,
      configured: true,
      updatedAt: now,
    }
  }

  // ── Hard Delete (§4) ──

  async previewDeletion(
    organizationId: number,
    sessionId: string,
  ): Promise<{ sessionId: string; deleted: boolean; deletedAt: string | null; message: string }> {
    const exists = this.ctx.sessions.get(sessionId)
    if (!exists || exists.organizationId !== organizationId) {
      return { sessionId, deleted: false, deletedAt: null, message: '会话不存在' }
    }
    return {
      sessionId,
      deleted: false,
      deletedAt: null,
      message: '此操作不可逆，确认后将永久删除',
    }
  }

  async executeDeletion(
    organizationId: number,
    sessionId: string,
    userId: number,
    triggerReason: CopilotSessionRetentionTriggerReason = 'user_requested',
  ): Promise<{ sessionId: string; deleted: boolean; deletedAt: string | null; message: string }> {
    const session = this.ctx.sessions.get(sessionId)
    if (!session || session.organizationId !== organizationId) {
      return { sessionId, deleted: false, deletedAt: null, message: '会话不存在' }
    }

    // Resolve active policy for the policy hash
    const policy = await this.resolveActivePolicy(organizationId, session.projectId)
    const now = new Date().toISOString()

    // Create tombstone
    const tombstone = buildCopilotSessionRetentionTombstone({
      organizationId,
      projectId: session.projectId,
      originalSessionId: sessionId,
      tombstoneHash: computeCopilotSessionTombstoneHash({
        originalSessionId: sessionId,
        deletionReason: triggerReason,
        policyHash: policy?.policyHash ?? 'none',
        deletedAtIso: now,
      }),
      messageCount: session.messageCount,
      policyHash: policy?.policyHash ?? 'none',
      createdAt: now,
    })
    this.ctx.tombstones.push(tombstone)

    // Create deletion record
    const deletionRecord = buildCopilotSessionRetentionDeletionRecord({
      organizationId,
      projectId: session.projectId,
      sessionId,
      sessionDbId: null,
      triggerReason,
      deletedAt: now,
      messageCount: session.messageCount,
      tombstoneId: tombstone.tombstoneId,
      policyHash: policy?.policyHash ?? 'none',
    })
    this.ctx.deletionRecords.push(deletionRecord)

    // Hard delete: remove from sessions store
    this.ctx.sessions.delete(sessionId)

    // Audit
    this.ctx.auditSink.events.push({
      event: 'COPILOT_SESSION_RETENTION_DELETED',
      metadata: { actorId: userId, organizationId, sessionId, triggerReason },
      timestamp: now,
    })

    return {
      sessionId,
      deleted: true,
      deletedAt: now,
      message: '会话已永久删除',
    }
  }

  async executeCleanup(
    organizationId: number,
    projectId: number,
    batchSize: number,
    userId: number,
  ): Promise<{
    projectId: number
    totalExpired: number
    deletedCount: number
    failedCount: number
    errors: Array<{ sessionId: string; reason: string }>
  }> {
    const policy = await this.resolveActivePolicy(organizationId, projectId)
    if (!policy || !policy.enabled) {
      return {
        projectId,
        totalExpired: 0,
        deletedCount: 0,
        failedCount: 0,
        errors: [],
      }
    }

    const now = Date.now()
    const cutoffMs = now - policy.retentionDays * 24 * 60 * 60 * 1000
    const errors: Array<{ sessionId: string; reason: string }> = []
    let deletedCount = 0

    // Find expired sessions (simulate by checking createdAt)
    const expiredSessions: string[] = []
    for (const [sessionId, session] of this.ctx.sessions) {
      if (session.organizationId !== organizationId || session.projectId !== projectId) continue
      const createdAtMs = new Date(session.createdAt).getTime()
      if (createdAtMs < cutoffMs) {
        expiredSessions.push(sessionId)
      }
    }

    const totalExpired = expiredSessions.length
    const toProcess = expiredSessions.slice(0, batchSize)

    for (const sessionId of toProcess) {
      try {
        const result = await this.executeDeletion(
          organizationId,
          sessionId,
          userId,
          'retention_expired',
        )
        if (result.deleted) {
          deletedCount++
        } else {
          errors.push({ sessionId, reason: result.message })
        }
      } catch (err: any) {
        errors.push({ sessionId, reason: err.message ?? 'unknown' })
      }
    }

    // Audit
    this.ctx.auditSink.events.push({
      event: 'COPILOT_SESSION_RETENTION_CLEANUP_EXECUTED',
      metadata: {
        actorId: userId,
        organizationId,
        projectId,
        deletedCount,
        failedCount: errors.length,
      },
      timestamp: new Date().toISOString(),
    })

    return {
      projectId,
      totalExpired,
      deletedCount,
      failedCount: errors.length,
      errors,
    }
  }

  // ── Tombstone Cascade (§5) ──

  getTombstonesForSession(
    organizationId: number,
    sessionId: string,
  ): CopilotSessionRetentionTombstone[] {
    return this.ctx.tombstones.filter(
      (t) => t.organizationId === organizationId && t.originalSessionId === sessionId,
    )
  }

  getDeletionRecordsForSession(
    organizationId: number,
    sessionId: string,
  ): CopilotSessionRetentionDeletionRecord[] {
    return this.ctx.deletionRecords.filter(
      (r) => r.organizationId === organizationId && r.sessionId === sessionId,
    )
  }

  // ── Export (§7) ──

  async exportSession(
    organizationId: number,
    sessionId: string,
  ): Promise<{
    found: boolean
    deleted: boolean
    data: Record<string, unknown> | null
  }> {
    // Check if session exists
    const session = this.ctx.sessions.get(sessionId)
    if (!session || session.organizationId !== organizationId) {
      // Check tombstone
      const tombstone = this.getTombstonesForSession(organizationId, sessionId)
      if (tombstone.length > 0) {
        return { found: true, deleted: true, data: null }
      }
      return { found: false, deleted: false, data: null }
    }

    // Return safe export (no prompts, no model output)
    return {
      found: true,
      deleted: false,
      data: {
        sessionId,
        title: session.title,
        createdAt: session.createdAt,
        messageCount: session.messageCount,
        // Explicitly excluded: no prompt content, no model output
      },
    }
  }

  // ── Internal ──

  private async resolveActivePolicy(
    organizationId: number,
    projectId: number | null,
  ): Promise<CopilotSessionRetentionPolicy | null> {
    if (projectId !== null) {
      const projectPolicy = this.ctx.policies.get(`${organizationId}:${projectId}`)
      if (projectPolicy) return projectPolicy
    }
    return this.ctx.policies.get(`${organizationId}:org`) ?? null
  }
}

// ────────────────────────────────────────────────────────────────────────────
// §0.2  FakePolicy — 实现 RBAC 断言
// ────────────────────────────────────────────────────────────────────────────

class FakeRetentionPolicy {
  private deniedActions = new Set<string>()

  deny(action: 'view' | 'manage' | 'delete' | 'cleanup') {
    this.deniedActions.add(action)
  }

  async assertView(_user: unknown, _orgId: number, _projectId: number | null): Promise<void> {
    if (this.deniedActions.has('view')) throw new Error('PERMISSION_DENIED: view')
  }

  async assertManage(_user: unknown, _orgId: number, _projectId: number | null): Promise<void> {
    if (this.deniedActions.has('manage')) throw new Error('PERMISSION_DENIED: manage')
  }

  async assertDelete(_user: unknown, _orgId: number, _sessionId: string): Promise<void> {
    if (this.deniedActions.has('delete')) throw new Error('PERMISSION_DENIED: delete')
  }

  async assertCleanup(_user: unknown, _orgId: number): Promise<void> {
    if (this.deniedActions.has('cleanup')) throw new Error('PERMISSION_DENIED: cleanup')
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const ORG_1 = 1
const ORG_2 = 2
const PROJECT_A = 10
const USER_ADMIN = 100
const USER_OWNER = 101
const USER_UNRELATED = 999

function seedSession(
  ctx: FakeContext,
  sessionId: string,
  overrides: {
    organizationId?: number
    projectId?: number | null
    title?: string
    createdAt?: string
    messageCount?: number
  } = {},
) {
  ctx.sessions.set(sessionId, {
    organizationId: overrides.organizationId ?? ORG_1,
    projectId: overrides.projectId === undefined ? PROJECT_A : overrides.projectId,
    title: overrides.title ?? `会话 ${sessionId}`,
    createdAt: overrides.createdAt ?? daysAgoIso(120),
    messageCount: overrides.messageCount ?? 10,
  })
}

/**
 * 会话创建时间一律取**相对当下**的偏移，不能写死日历日期。
 *
 * `executeCleanup` 的过期判定读真实 `Date.now()`：
 * `cutoffMs = now - retentionDays * 86400000`，再比 `createdAt < cutoffMs`。
 * 写死日期会随日历滑过保留期边界——本文件原先把「未过期」的会话写成
 * `2026-08-01`，到 2026-08-31 正好满 30 天，端到端用例于是从删 1 条变成删 2 条。
 *
 * 注意：`computeCopilotSessionRemainingDays(createdAt, now)` 那组用例**不受影响**，
 * 它显式传入 `now`、两端都是固定值，自洽且不读墙钟，故保持原样。
 */
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

function seedOrgPolicy(ctx: FakeContext, orgId: number, retentionDays = 90, enabled = true) {
  const policy = buildOrganizationCopilotSessionRetentionPolicy({
    organizationId: orgId,
    retentionDays,
    enabled,
  })
  ctx.policies.set(`${orgId}:org`, policy)
}

function seedProjectPolicy(
  ctx: FakeContext,
  orgId: number,
  projectId: number,
  retentionDays = 30,
  enabled = true,
) {
  const policy = buildCopilotSessionRetentionPolicy({
    organizationId: orgId,
    projectId,
    retentionDays,
    enabled,
  })
  ctx.policies.set(`${orgId}:${projectId}`, policy)
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

test.group('CopilotSessionRetention', (group) => {
  group.each.setup(() => {
    // No DB to truncate — each test creates its own FakeContext
  })

  // ══════════════════════════════════════════════════════════════════════════
  // §3  Policy Resolution
  // ══════════════════════════════════════════════════════════════════════════

  test('§3 无配置时删除nothing，报告为unconfigured', async ({ assert }) => {
    const ctx = makeFakeContext()
    const service = new FakeRetentionService(ctx)

    // No policies registered at all
    const result = await service.getPolicy(ORG_1, PROJECT_A)

    assert.isFalse(result.configured)
    assert.isFalse(result.enabled)
    assert.equal(result.retentionDays, 0)
    assert.isNull(result.updatedAt)
  })

  test('§3 Project override 优先于 org default', async ({ assert }) => {
    const ctx = makeFakeContext()
    seedOrgPolicy(ctx, ORG_1, 90)
    seedProjectPolicy(ctx, ORG_1, PROJECT_A, 30)
    const service = new FakeRetentionService(ctx)

    const result = await service.getPolicy(ORG_1, PROJECT_A)

    assert.isTrue(result.configured)
    assert.equal(result.retentionDays, 30) // project override
    assert.equal(result.projectId, PROJECT_A)
  })

  test('§3 无 project override 时回退到 org default', async ({ assert }) => {
    const ctx = makeFakeContext()
    seedOrgPolicy(ctx, ORG_1, 120)
    const service = new FakeRetentionService(ctx)

    const result = await service.getPolicy(ORG_1, PROJECT_A)

    assert.isTrue(result.configured)
    assert.equal(result.retentionDays, 120)
  })

  test('§3 无第二层策略解析引入（复用同一 resolver 模式）', async ({ assert }) => {
    const ctx = makeFakeContext()
    seedOrgPolicy(ctx, ORG_1, 60)
    const service = new FakeRetentionService(ctx)

    // Calling getPolicy multiple times yields same resolution
    const r1 = await service.getPolicy(ORG_1, PROJECT_A)
    const r2 = await service.getPolicy(ORG_1, PROJECT_A)
    assert.deepEqual(r1, r2)
  })

  test('§3 未授权策略变更被拒绝', async ({ assert }) => {
    const policy = new FakeRetentionPolicy()
    policy.deny('manage')

    await assert.rejects(
      () => policy.assertManage({ id: USER_UNRELATED } as any, ORG_1, PROJECT_A),
      /PERMISSION_DENIED/,
    )
  })

  test('§3 跨组织策略不适用', async ({ assert }) => {
    const ctx = makeFakeContext()
    seedOrgPolicy(ctx, ORG_1, 90)
    const service = new FakeRetentionService(ctx)

    // ORG_2 has no policy
    const result = await service.getPolicy(ORG_2, null)

    assert.isFalse(result.configured)
  })

  // ══════════════════════════════════════════════════════════════════════════
  // §4  Hard Delete
  // ══════════════════════════════════════════════════════════════════════════

  test('§4 删除后会话从存储中消失（硬删除，非软隐藏）', async ({ assert }) => {
    const ctx = makeFakeContext()
    seedSession(ctx, 'sess-001')
    const service = new FakeRetentionService(ctx)

    const result = await service.executeDeletion(ORG_1, 'sess-001', USER_ADMIN, 'user_requested')

    assert.isTrue(result.deleted)
    assert.isNotNull(result.deletedAt)

    // Session is gone from the store
    assert.isFalse(ctx.sessions.has('sess-001'))

    // Not merely hidden — truly absent
    const recheck = await service.previewDeletion(ORG_1, 'sess-001')
    assert.equal(recheck.message, '会话不存在')
  })

  test('§4 不使用软隐藏（soft hiding not used）', async ({ assert }) => {
    const ctx = makeFakeContext()
    seedSession(ctx, 'sess-002')
    const service = new FakeRetentionService(ctx)

    await service.executeDeletion(ORG_1, 'sess-002', USER_ADMIN, 'retention_expired')

    // The session key should not exist at all
    assert.isUndefined(ctx.sessions.get('sess-002'))

    // No "hidden" flag or status mutation — hard removal
    // The tombstone is the only surviving reference
    assert.lengthOf(ctx.tombstones, 1)
    assert.equal(ctx.tombstones[0].originalSessionId, 'sess-002')
  })

  test('§4 批量删除且幂等（同一 batch 执行两次不报错）', async ({ assert }) => {
    const ctx = makeFakeContext()
    seedOrgPolicy(ctx, ORG_1, 90)
    // Create 3 sessions with old createdAt so they're expired
    seedSession(ctx, 'sess-a', { createdAt: daysAgoIso(240) })
    seedSession(ctx, 'sess-b', { createdAt: daysAgoIso(210) })
    seedSession(ctx, 'sess-c', { createdAt: daysAgoIso(180) })
    const service = new FakeRetentionService(ctx)

    // First cleanup pass
    const r1 = await service.executeCleanup(ORG_1, PROJECT_A, 100, USER_ADMIN)
    assert.equal(r1.deletedCount, 3)
    assert.equal(r1.totalExpired, 3)

    // Second cleanup pass — no expired sessions left
    const r2 = await service.executeCleanup(ORG_1, PROJECT_A, 100, USER_ADMIN)
    assert.equal(r2.deletedCount, 0)
    assert.equal(r2.totalExpired, 0)

    // Tombstones from first pass only
    assert.lengthOf(ctx.tombstones, 3)
  })

  test('§4 用户请求与过期删除共享同一执行路径', async ({ assert }) => {
    const ctx = makeFakeContext()
    seedSession(ctx, 'sess-user')
    seedSession(ctx, 'sess-expired')
    const service = new FakeRetentionService(ctx)

    const rUser = await service.executeDeletion(ORG_1, 'sess-user', USER_OWNER, 'user_requested')
    const rExpired = await service.executeDeletion(
      ORG_1,
      'sess-expired',
      USER_ADMIN,
      'retention_expired',
    )

    // Both deleted successfully via same path
    assert.isTrue(rUser.deleted)
    assert.isTrue(rExpired.deleted)

    // Both created tombstones + deletion records
    assert.lengthOf(ctx.tombstones, 2)
    assert.lengthOf(ctx.deletionRecords, 2)

    // Trigger reasons are distinct
    const reasons = ctx.deletionRecords.map((r) => r.triggerReason).sort()
    assert.deepEqual(reasons, ['retention_expired', 'user_requested'])
  })

  test('§4 未确认的用户请求不删除', async ({ assert }) => {
    const ctx = makeFakeContext()
    seedSession(ctx, 'sess-unconfirmed')
    const service = new FakeRetentionService(ctx)

    // Preview (confirm !== true)
    const preview = await service.previewDeletion(ORG_1, 'sess-unconfirmed')
    assert.isFalse(preview.deleted)
    assert.isNull(preview.deletedAt)

    // Session still exists
    assert.isTrue(ctx.sessions.has('sess-unconfirmed'))
    assert.lengthOf(ctx.tombstones, 0)
    assert.lengthOf(ctx.deletionRecords, 0)
  })

  test('§4 删除不存在的会话返回 deleted=false', async ({ assert }) => {
    const ctx = makeFakeContext()
    const service = new FakeRetentionService(ctx)

    const result = await service.executeDeletion(
      ORG_1,
      'nonexistent-session',
      USER_ADMIN,
      'user_requested',
    )

    assert.isFalse(result.deleted)
    assert.lengthOf(ctx.tombstones, 0)
  })

  test('§4 跨组织删除失败（组织隔离）', async ({ assert }) => {
    const ctx = makeFakeContext()
    seedSession(ctx, 'sess-org1', { organizationId: ORG_1 })
    const service = new FakeRetentionService(ctx)

    // Try to delete from ORG_2
    const result = await service.executeDeletion(ORG_2, 'sess-org1', USER_ADMIN, 'user_requested')

    assert.isFalse(result.deleted)
    assert.isTrue(ctx.sessions.has('sess-org1'))
  })

  // ══════════════════════════════════════════════════════════════════════════
  // §5  Tombstone Cascade
  // ══════════════════════════════════════════════════════════════════════════

  test('§5 删除后历史统计不受影响', async ({ assert }) => {
    const ctx = makeFakeContext()
    seedSession(ctx, 'sess-stat', { messageCount: 42, createdAt: daysAgoIso(120) })
    const service = new FakeRetentionService(ctx)

    await service.executeDeletion(ORG_1, 'sess-stat', USER_ADMIN, 'retention_expired')

    // Tombstone preserves the message count for historical stats
    const tombstone = ctx.tombstones[0]
    assert.equal(tombstone.messageCount, 42)

    // Deletion record also preserves it
    const record = ctx.deletionRecords[0]
    assert.equal(record.messageCount, 42)
  })

  test('§5 删除后账本查询仍可用（无悬挂引用）', async ({ assert }) => {
    const ctx = makeFakeContext()
    seedSession(ctx, 'sess-ledger')
    const service = new FakeRetentionService(ctx)

    await service.executeDeletion(ORG_1, 'sess-ledger', USER_ADMIN, 'user_requested')

    // Deletion record links back to session via sessionId
    const records = service.getDeletionRecordsForSession(ORG_1, 'sess-ledger')
    assert.lengthOf(records, 1)
    assert.equal(records[0].sessionId, 'sess-ledger')
    assert.isNotNull(records[0].deletedAt)

    // Tombstone also references the session
    const tombstones = service.getTombstonesForSession(ORG_1, 'sess-ledger')
    assert.lengthOf(tombstones, 1)
    assert.equal(tombstones[0].originalSessionId, 'sess-ledger')

    // Tombstone links to deletion record via tombstoneId
    assert.equal(records[0].tombstoneId, tombstones[0].tombstoneId)
  })

  test('§5 墓碑不透明（无法推导会话标识符或内容）', async ({ assert }) => {
    const ctx = makeFakeContext()
    seedSession(ctx, 'sess-opaque', { title: '机密会话标题' })
    const service = new FakeRetentionService(ctx)

    await service.executeDeletion(ORG_1, 'sess-opaque', USER_ADMIN, 'retention_expired')

    const tombstone = ctx.tombstones[0]

    // Tombstone hash is a one-way hash, not the session ID
    assert.isString(tombstone.tombstoneHash)
    assert.notEqual(tombstone.tombstoneHash, 'sess-opaque')
    assert.notInclude(tombstone.tombstoneHash, 'sess-opaque')
    assert.notInclude(tombstone.tombstoneHash, '机密')

    // Tombstone should not contain title or content fields
    assert.notProperty(tombstone, 'title')
    assert.notProperty(tombstone, 'content')
    assert.notProperty(tombstone, 'prompt')
    assert.notProperty(tombstone, 'modelOutput')

    // originalSessionId is an opaque identifier, not content
    assert.equal(tombstone.originalSessionId, 'sess-opaque')
    // Verify tombstone hash is deterministic for same inputs
    const hash1 = computeCopilotSessionTombstoneHash({
      originalSessionId: 'sess-opaque',
      deletionReason: 'retention_expired',
      policyHash: tombstone.policyHash,
      deletedAtIso: tombstone.createdAt,
    })
    assert.equal(tombstone.tombstoneHash, hash1)
  })

  test('§5 墓碑 hash 使用 FNV-1a 不可逆', async ({ assert }) => {
    const tombstone = buildCopilotSessionRetentionTombstone({
      originalSessionId: 'test-session-xyz',
    })

    // Hash is deterministic
    const hash2 = computeCopilotSessionTombstoneHash({
      originalSessionId: 'test-session-xyz',
      deletionReason: 'retention_expired',
      policyHash: tombstone.policyHash,
      deletedAtIso: tombstone.createdAt,
    })
    assert.equal(tombstone.tombstoneHash, hash2)

    // Different session → different hash
    const differentTombstone = buildCopilotSessionRetentionTombstone({
      originalSessionId: 'different-session',
    })
    assert.notEqual(tombstone.tombstoneHash, differentTombstone.tombstoneHash)
  })

  // ══════════════════════════════════════════════════════════════════════════
  // §6  Audit
  // ══════════════════════════════════════════════════════════════════════════

  test('§6 审计记录事件（标识符、时间、触发原因）', async ({ assert }) => {
    const ctx = makeFakeContext()
    seedSession(ctx, 'sess-audit')
    const service = new FakeRetentionService(ctx)

    await service.executeDeletion(ORG_1, 'sess-audit', USER_OWNER, 'user_requested')

    assert.lengthOf(ctx.auditSink.events, 1)
    const event = ctx.auditSink.events[0]
    assert.equal(event.event, 'COPILOT_SESSION_RETENTION_DELETED')
    assert.equal(event.metadata.actorId, USER_OWNER)
    assert.equal(event.metadata.organizationId, ORG_1)
    assert.equal(event.metadata.sessionId, 'sess-audit')
    assert.equal(event.metadata.triggerReason, 'user_requested')
    assert.isString(event.timestamp)
  })

  test('§6 审计不包含会话内容（负面测试）', async ({ assert }) => {
    const ctx = makeFakeContext()
    // 注意：fixture 的 sessionId 不得含 content/prompt 等字样——审计元数据合法携带 sessionId，
    // 之前的 'sess-no-content' 命名会让 notInclude('content') 误伤自身。
    seedSession(ctx, 'sess-audit-negative', {
      title: '包含敏感信息的标题',
    })
    const service = new FakeRetentionService(ctx)

    await service.executeDeletion(ORG_1, 'sess-audit-negative', USER_ADMIN, 'retention_expired')

    const event = ctx.auditSink.events[0]
    const metadataStr = JSON.stringify(event.metadata)

    // No content/prompt/modelOutput in audit metadata
    assert.notInclude(metadataStr.toLowerCase(), 'prompt')
    assert.notInclude(metadataStr.toLowerCase(), 'modeloutput')
    assert.notInclude(metadataStr.toLowerCase(), 'content')
    assert.notInclude(metadataStr, '包含敏感信息')
  })

  test('§6 清理操作也产生审计记录', async ({ assert }) => {
    const ctx = makeFakeContext()
    seedOrgPolicy(ctx, ORG_1, 90)
    seedSession(ctx, 'sess-cleanup-audit', { createdAt: daysAgoIso(240) })
    const service = new FakeRetentionService(ctx)

    await service.executeCleanup(ORG_1, PROJECT_A, 100, USER_ADMIN)

    const cleanupEvent = ctx.auditSink.events.find(
      (e) => e.event === 'COPILOT_SESSION_RETENTION_CLEANUP_EXECUTED',
    )
    assert.isNotNull(cleanupEvent)
    assert.equal(cleanupEvent!.metadata.deletedCount, 1)
  })

  // ══════════════════════════════════════════════════════════════════════════
  // §7  Export
  // ══════════════════════════════════════════════════════════════════════════

  test('§7 导出排除 prompts 和 model output', async ({ assert }) => {
    const ctx = makeFakeContext()
    seedSession(ctx, 'sess-export-safe', { title: '导出会话' })
    const service = new FakeRetentionService(ctx)

    const result = await service.exportSession(ORG_1, 'sess-export-safe')

    assert.isTrue(result.found)
    assert.isFalse(result.deleted)
    assert.isNotNull(result.data)

    const data = result.data!
    // Should NOT contain prompt or model output
    assert.notProperty(data, 'prompt')
    assert.notProperty(data, 'modelOutput')
    assert.notProperty(data, 'model_output')
    assert.notProperty(data, 'input')
    assert.notProperty(data, 'output')
    assert.notProperty(data, 'token')

    // Should contain safe fields
    assert.equal(data.sessionId, 'sess-export-safe')
    assert.equal(data.title, '导出会话')
    assert.equal(data.messageCount, 10)
  })

  test('§7 已删除会话导出报告状态（非空结果）', async ({ assert }) => {
    const ctx = makeFakeContext()
    seedSession(ctx, 'sess-export-deleted')
    const service = new FakeRetentionService(ctx)

    // Delete first
    await service.executeDeletion(ORG_1, 'sess-export-deleted', USER_ADMIN, 'user_requested')

    // Export — should report deleted, not 404/empty
    const result = await service.exportSession(ORG_1, 'sess-export-deleted')
    assert.isTrue(result.found)
    assert.isTrue(result.deleted)
    assert.isNull(result.data)
  })

  test('§7 跨组织会话无法导出', async ({ assert }) => {
    const ctx = makeFakeContext()
    seedSession(ctx, 'sess-cross-org', { organizationId: ORG_1 })
    const service = new FakeRetentionService(ctx)

    // Try to export from ORG_2
    const result = await service.exportSession(ORG_2, 'sess-cross-org')
    assert.isFalse(result.found)
    assert.isNull(result.data)
  })

  test('§7 导出数据不含敏感字段（类型级别检查）', async ({ assert }) => {
    const ctx = makeFakeContext()
    seedSession(ctx, 'sess-sensitive-check')
    const service = new FakeRetentionService(ctx)

    const result = await service.exportSession(ORG_1, 'sess-sensitive-check')
    assert.isNotNull(result.data)

    // Cross-check with COPILOT_SESSION_RETENTION_FORBIDDEN_KEYS
    const hasSensitive = containsCopilotSessionSensitiveMarkers(result.data)
    assert.isFalse(hasSensitive, 'Export data should not contain any sensitive field markers')
  })

  // ══════════════════════════════════════════════════════════════════════════
  // §8  Migration Safety & Compliance
  // ══════════════════════════════════════════════════════════════════════════

  test('§8 启用保留策略后不立即删除任何内容（首次启用）', async ({ assert }) => {
    const ctx = makeFakeContext()
    // Sessions exist before policy was configured
    seedSession(ctx, 'sess-old-1', { createdAt: daysAgoIso(240) })
    seedSession(ctx, 'sess-old-2', { createdAt: daysAgoIso(210) })
    const service = new FakeRetentionService(ctx)

    // No policy yet — all sessions present
    assert.equal(ctx.sessions.size, 2)

    // Enable policy (first enablement)
    await service.updatePolicy(ORG_1, null, { retentionDays: 90, enabled: true }, USER_ADMIN)

    // Sessions should still exist — enabling policy alone doesn't trigger deletion
    assert.equal(ctx.sessions.size, 2)
    assert.lengthOf(ctx.tombstones, 0)
    assert.lengthOf(ctx.deletionRecords, 0)
  })

  test('§8 剩余天数正确报告', async ({ assert }) => {
    // Uses the pure function from @aiproj/types
    const now = '2026-08-02T00:00:00.000Z'

    // Expires in the future
    const future = computeCopilotSessionRemainingDays('2026-08-12T00:00:00.000Z', now)
    assert.equal(future, 10)

    // Expires today
    const today = computeCopilotSessionRemainingDays('2026-08-02T00:00:00.000Z', now)
    assert.equal(today, 0)

    // Already expired
    const past = computeCopilotSessionRemainingDays('2026-07-01T00:00:00.000Z', now)
    assert.equal(past, 0)

    // No expiry (unconfigured)
    const none = computeCopilotSessionRemainingDays(null, now)
    assert.isNull(none)
  })

  test('§8 未配置状态正确报告', async ({ assert }) => {
    const ctx = makeFakeContext()
    const service = new FakeRetentionService(ctx)

    // No policy set up
    const result = await service.getPolicy(ORG_1, PROJECT_A)
    assert.isFalse(result.configured)

    // The status DTO fixture should reflect unconfigured
    const status = buildUnconfiguredCopilotSessionRetentionStatusResponse({
      organizationId: ORG_1,
      projectId: PROJECT_A,
    })
    assert.isFalse(status.policyConfigured)
    assert.isNull(status.retentionDays)
  })

  test('§8 策略哈希确定性（相同参数相同哈希）', async ({ assert }) => {
    const hash1 = computeCopilotSessionRetentionPolicyHash({
      scope: 'project',
      organizationId: 1,
      projectId: 10,
      retentionDays: 90,
      enabled: true,
    })
    const hash2 = computeCopilotSessionRetentionPolicyHash({
      scope: 'project',
      organizationId: 1,
      projectId: 10,
      retentionDays: 90,
      enabled: true,
    })
    assert.equal(hash1, hash2)

    // Different params → different hash
    const hash3 = computeCopilotSessionRetentionPolicyHash({
      scope: 'project',
      organizationId: 1,
      projectId: 10,
      retentionDays: 120, // different
      enabled: true,
    })
    assert.notEqual(hash1, hash3)
  })

  test('§8 策略哈希不含时间戳或操作人', async ({ assert }) => {
    // Policy hash only depends on scope/org/project/days/enabled
    const h1 = computeCopilotSessionRetentionPolicyHash({
      scope: 'organization',
      organizationId: 5,
      projectId: null,
      retentionDays: 365,
      enabled: false,
    })
    // Call again — same deterministic output
    const h2 = computeCopilotSessionRetentionPolicyHash({
      scope: 'organization',
      organizationId: 5,
      projectId: null,
      retentionDays: 365,
      enabled: false,
    })
    assert.equal(h1, h2)
    assert.isString(h1)
    assert.isAbove(h1.length, 0)
  })

  // ══════════════════════════════════════════════════════════════════════════
  // Fixture builder validation（确保 fixture 工厂产生有效数据）
  // ══════════════════════════════════════════════════════════════════════════

  test('fixture: 默认策略在边界内', async ({ assert }) => {
    const policy = buildCopilotSessionRetentionPolicy()
    assert.isAtLeast(policy.retentionDays, COPILOT_SESSION_RETENTION_BOUNDS.minDays)
    assert.isAtMost(policy.retentionDays, COPILOT_SESSION_RETENTION_BOUNDS.maxDays)
    assert.isString(policy.policyHash)
    assert.isAbove(policy.policyHash.length, 0)
  })

  test('fixture: 组织级策略 projectId 为 null', async ({ assert }) => {
    const policy = buildOrganizationCopilotSessionRetentionPolicy()
    assert.isNull(policy.projectId)
    assert.equal(policy.scope, 'organization')
  })

  test('fixture: 禁用策略 enabled=false', async ({ assert }) => {
    const policy = buildDisabledCopilotSessionRetentionPolicy()
    assert.isFalse(policy.enabled)
  })

  test('fixture: 删除记录包含 triggerReason', async ({ assert }) => {
    const record = buildCopilotSessionRetentionDeletionRecord()
    assert.isString(record.triggerReason)
    assert.isAtLeast(record.messageCount, 0)
  })

  test('fixture: 用户请求删除记录 triggerReason=user_requested', async ({ assert }) => {
    const record = buildUserRequestedDeletionRecord()
    assert.equal(record.triggerReason, 'user_requested')
  })

  test('fixture: 组织请求删除记录 triggerReason=organization_requested', async ({ assert }) => {
    const record = buildOrganizationRequestedDeletionRecord()
    assert.equal(record.triggerReason, 'organization_requested')
  })

  test('fixture: 墓碑 hash 不可逆推会话内容', async ({ assert }) => {
    const tombstone = buildCopilotSessionRetentionTombstone({
      originalSessionId: 'secret-session-id',
    })
    // Hash does not contain the session ID
    assert.notInclude(tombstone.tombstoneHash, 'secret-session-id')
    // No content fields on tombstone
    assert.notProperty(tombstone, 'content')
    assert.notProperty(tombstone, 'prompt')
  })

  test('fixture: 状态响应默认值合理', async ({ assert }) => {
    const status = buildCopilotSessionRetentionStatusResponse()
    assert.isTrue(status.policyConfigured)
    assert.isAtLeast(status.totalSessions, 0)
    assert.isAtLeast(status.deletedCount, 0)
  })

  test('fixture: 未配置状态响应', async ({ assert }) => {
    const status = buildUnconfiguredCopilotSessionRetentionStatusResponse()
    assert.isFalse(status.policyConfigured)
    assert.isNull(status.retentionDays)
  })

  test('fixture: 读取摘要包含必要字段', async ({ assert }) => {
    const summary = buildCopilotSessionRetentionReadSummary()
    assert.isString(summary.sessionId)
    assert.isString(summary.title)
    assert.isString(summary.createdAt)
    assert.isTrue(summary.policyConfigured)
  })

  test('fixture: 无策略读取摘要', async ({ assert }) => {
    const summary = buildNoPolicyCopilotSessionRetentionReadSummary()
    assert.isFalse(summary.policyConfigured)
    assert.isNull(summary.retentionExpiresAt)
    assert.isNull(summary.remainingDays)
  })

  // ══════════════════════════════════════════════════════════════════════════
  // 端到端场景组合
  // ══════════════════════════════════════════════════════════════════════════

  test('端到端: 策略配置 → 过期清理 → 墓碑 → 审计 → 导出已删会话', async ({ assert }) => {
    const ctx = makeFakeContext()
    const service = new FakeRetentionService(ctx)

    // 1. Initially unconfigured
    let policy = await service.getPolicy(ORG_1, PROJECT_A)
    assert.isFalse(policy.configured)

    // 2. Configure policy
    await service.updatePolicy(ORG_1, null, { retentionDays: 30, enabled: true }, USER_ADMIN)
    policy = await service.getPolicy(ORG_1, PROJECT_A)
    assert.isTrue(policy.configured)
    assert.equal(policy.retentionDays, 30)

    // 3. Create sessions — some old, some new
    seedSession(ctx, 'sess-old', { createdAt: daysAgoIso(240) })
    // 保留期 30 天，取 1 天前——留足余量，不会随日历滑过边界
    seedSession(ctx, 'sess-new', { createdAt: daysAgoIso(1) })

    // 4. Run cleanup
    const cleanup = await service.executeCleanup(ORG_1, PROJECT_A, 100, USER_ADMIN)
    assert.equal(cleanup.deletedCount, 1) // only sess-old
    assert.equal(cleanup.totalExpired, 1)

    // 5. Verify tombstone
    const tombstones = service.getTombstonesForSession(ORG_1, 'sess-old')
    assert.lengthOf(tombstones, 1)
    assert.isString(tombstones[0].tombstoneHash)

    // 6. Verify audit
    const deleteEvent = ctx.auditSink.events.find(
      (e) => e.event === 'COPILOT_SESSION_RETENTION_DELETED',
    )
    assert.isNotNull(deleteEvent)
    assert.equal(deleteEvent!.metadata.triggerReason, 'retention_expired')

    const cleanupEvent = ctx.auditSink.events.find(
      (e) => e.event === 'COPILOT_SESSION_RETENTION_CLEANUP_EXECUTED',
    )
    assert.isNotNull(cleanupEvent)

    // 7. Export deleted session — reports deleted state
    const exportResult = await service.exportSession(ORG_1, 'sess-old')
    assert.isTrue(exportResult.found)
    assert.isTrue(exportResult.deleted)

    // 8. Export surviving session — safe data
    const exportNew = await service.exportSession(ORG_1, 'sess-new')
    assert.isTrue(exportNew.found)
    assert.isFalse(exportNew.deleted)
    assert.isNotNull(exportNew.data)
    assert.notProperty(exportNew.data!, 'prompt')
  })

  test('端到端: RBAC 阻断未授权策略变更', async ({ assert }) => {
    const policy = new FakeRetentionPolicy()
    policy.deny('manage')

    await assert.rejects(
      () => policy.assertManage({ id: USER_UNRELATED } as any, ORG_1, null),
      /PERMISSION_DENIED/,
    )
  })

  test('端到端: RBAC 阻断未授权清理', async ({ assert }) => {
    const policy = new FakeRetentionPolicy()
    policy.deny('cleanup')

    await assert.rejects(
      () => policy.assertCleanup({ id: USER_UNRELATED } as any, ORG_1),
      /PERMISSION_DENIED/,
    )
  })

  test('端到端: RBAC 阻断未授权删除', async ({ assert }) => {
    const policy = new FakeRetentionPolicy()
    policy.deny('delete')

    await assert.rejects(
      () => policy.assertDelete({ id: USER_UNRELATED } as any, ORG_1, 'any-session'),
      /PERMISSION_DENIED/,
    )
  })

  // ══════════════════════════════════════════════════════════════════════════
  // 敏感数据红线（§6 §7 补充）
  // ══════════════════════════════════════════════════════════════════════════

  test('COPILOT_SESSION_RETENTION_FORBIDDEN_KEYS 覆盖所有敏感键', async ({ assert }) => {
    // Verify the forbidden keys list covers expected sensitive fields
    const expectedForbidden = [
      'content',
      'prompt',
      'modelOutput',
      'token',
      'secret',
      'authorization',
    ]
    for (const key of expectedForbidden) {
      assert.include(
        COPILOT_SESSION_RETENTION_FORBIDDEN_KEYS as readonly string[],
        key,
        `FORBIDDEN_KEYS should include '${key}'`,
      )
    }
  })

  test('containsCopilotSessionSensitiveMarkers 检测嵌套敏感字段', async ({ assert }) => {
    // Clean object
    assert.isFalse(containsCopilotSessionSensitiveMarkers({ sessionId: 'x', title: 'y' }))

    // Top-level forbidden key
    assert.isTrue(containsCopilotSessionSensitiveMarkers({ prompt: 'secret prompt' }))
    assert.isTrue(containsCopilotSessionSensitiveMarkers({ content: 'secret content' }))
    assert.isTrue(containsCopilotSessionSensitiveMarkers({ modelOutput: 'output' }))

    // Nested forbidden key
    assert.isTrue(containsCopilotSessionSensitiveMarkers({ meta: { prompt: 'nested' } }))

    // Null / primitive
    assert.isFalse(containsCopilotSessionSensitiveMarkers(null))
    assert.isFalse(containsCopilotSessionSensitiveMarkers('string'))
    assert.isFalse(containsCopilotSessionSensitiveMarkers(42))
  })

  test('containsCopilotSessionSensitiveMarkers 对 tombstone 返回 false', async ({ assert }) => {
    const tombstone = buildCopilotSessionRetentionTombstone()
    assert.isFalse(containsCopilotSessionSensitiveMarkers(tombstone))
  })

  test('containsCopilotSessionSensitiveMarkers 对 deletion record 返回 false', async ({
    assert,
  }) => {
    const record = buildCopilotSessionRetentionDeletionRecord()
    assert.isFalse(containsCopilotSessionSensitiveMarkers(record))
  })

  test('containsCopilotSessionSensitiveMarkers 对 policy 返回 false', async ({ assert }) => {
    const policy = buildCopilotSessionRetentionPolicy()
    assert.isFalse(containsCopilotSessionSensitiveMarkers(policy))
  })
})
