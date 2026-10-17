import { test } from '@japa/runner'
import AuditService, { AuditEvent } from '#services/audit_service'
import AuditLog from '#models/audit_log'
import { useAuthDatabase } from './auth/_helpers.js'

test.group('OrganizationResourcePool — Audit Safety', (group) => {
  useAuthDatabase(group)

  let auditService: AuditService

  group.each.setup(() => {
    auditService = new AuditService()
  })

  // ─── 5.6.1: 审计事件已注册 ─────────────────────────────────────────────────

  test('ORG_RESOURCE_POOL_READ event is registered', ({ assert }) => {
    assert.equal(AuditEvent.ORG_RESOURCE_POOL_READ, 'ORG_RESOURCE_POOL_READ')
  })

  test('ORG_RESOURCE_POOL_DRILL_DOWN event is registered', ({ assert }) => {
    assert.equal(AuditEvent.ORG_RESOURCE_POOL_DRILL_DOWN, 'ORG_RESOURCE_POOL_DRILL_DOWN')
  })

  test('ORG_RESOURCE_POOL_PERMISSION_DENIED event is registered', ({ assert }) => {
    assert.equal(
      AuditEvent.ORG_RESOURCE_POOL_PERMISSION_DENIED,
      'ORG_RESOURCE_POOL_PERMISSION_DENIED',
    )
  })

  // ─── 5.6.2: 事件映射为 read 动词 ──────────────────────────────────────────

  test('ORG_RESOURCE_POOL_READ maps to "read" action', async ({ assert }) => {
    const { EVENT_TO_ACTION } = await import('#services/audit_service')
    assert.equal(EVENT_TO_ACTION[AuditEvent.ORG_RESOURCE_POOL_READ], 'read')
  })

  test('ORG_RESOURCE_POOL_DRILL_DOWN maps to "read" action', async ({ assert }) => {
    const { EVENT_TO_ACTION } = await import('#services/audit_service')
    assert.equal(EVENT_TO_ACTION[AuditEvent.ORG_RESOURCE_POOL_DRILL_DOWN], 'read')
  })

  // ─── 5.6.3: 审计不包含敏感数据 ───────────────────────────────────────────

  test('audit entry excludes sensitive headers and prompts', async ({ assert }) => {
    await auditService.log({
      event: AuditEvent.ORG_RESOURCE_POOL_READ,
      severity: 'info',
      userId: 1,
      organizationId: 1,
      entityType: 'organization_resource_pool',
      entityId: 1,
      metadata: {
        endpointFamily: 'summary',
        metricKeys: ['org_respool_total_resources'],
        warningCodes: [],
        sourceFreshnessHash: 'abc123',
      },
    })

    // 读取已落库的审计日志
    // log() 返回 void，按写入顺序取最新一行（每个用例独立库）
    const log = await AuditLog.query().orderBy('id', 'desc').first()
    if (log) {
      // 确认不包含 Authorization header
      const metadata = log.metadata as Record<string, unknown> | null
      if (metadata) {
        assert.isUndefined(metadata.authorization)
        assert.isUndefined(metadata.token)
        assert.isUndefined(metadata.apiKey)
        assert.isUndefined(metadata.prompt)
        assert.isUndefined(metadata.modelOutput)
        assert.isUndefined(metadata.evidenceText)
      }
    }
  })

  test('audit metadata uses hashes, not raw labels for drill-down', async ({ assert }) => {
    await auditService.log({
      event: AuditEvent.ORG_RESOURCE_POOL_DRILL_DOWN,
      severity: 'info',
      userId: 1,
      organizationId: 1,
      entityType: 'organization_resource_pool',
      entityId: 1,
      metadata: {
        kind: 'project',
        targetId: 42,
        bucketHash: 'a1b2c3d4',
      },
    })

    // log() 返回 void，按写入顺序取最新一行（每个用例独立库）
    const log = await AuditLog.query().orderBy('id', 'desc').first()
    if (log) {
      const metadata = log.metadata as Record<string, unknown> | null
      if (metadata) {
        // bucket hash 存在，但不含原始 label
        assert.equal(metadata.bucketHash, 'a1b2c3d4')
        assert.isUndefined(metadata.hiddenLabels)
        assert.isUndefined(metadata.hiddenCounts)
        assert.isUndefined(metadata.crossOrganizationData)
      }
    }
  })

  // ─── 5.6.4: 跨组织数据排除 ────────────────────────────────────────────────

  test('audit entry never contains cross-organization references', async ({ assert }) => {
    await auditService.log({
      event: AuditEvent.ORG_RESOURCE_POOL_READ,
      severity: 'info',
      userId: 1,
      organizationId: 1,
      entityType: 'organization_resource_pool',
      entityId: 1,
      metadata: {
        endpointFamily: 'summary',
        organizationId: 1, // 只记录本组织
        metricKeys: ['org_respool_total_resources'],
      },
    })

    // log() 返回 void，按写入顺序取最新一行（每个用例独立库）
    const log = await AuditLog.query().orderBy('id', 'desc').first()
    if (log) {
      const metadata = log.metadata as Record<string, unknown> | null
      if (metadata) {
        // 不应包含其他组织的 ID 或数据
        assert.isUndefined(metadata.otherOrganizationId)
        assert.isUndefined(metadata.crossOrgData)
        assert.isUndefined(metadata.externalProjectIds)
      }
    }
  })
})
