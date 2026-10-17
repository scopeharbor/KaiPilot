// v3-multitenant-tenant-identification §6.4 —— super admin scope mode 测试。
//
// spec 场景覆盖：
//   - 「Super admin tenant mode uses concrete organization」：管理员做普通业务操作时
//     必须有具体组织 scope，不默认获得跨租户业务数据可见性；
//   - 「Global low-sensitive mode is audited」：许可的全局低敏操作写审计；
//   - §6.2 八个业务域逐域断言；§6.3 allow-list 之外的能力被拒。
//
// 全程本地 SQLite + fixture，无外部 provider。
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import Project from '#models/project'
import TokenService from '#services/token_service'
import TenantResolutionService from '#services/tenant_resolution_service'
import TenantScopeModeService, {
  GLOBAL_LOW_SENSITIVE_CAPABILITIES,
  SYSTEM_MAINTENANCE_CAPABILITIES,
  TENANT_SCOPED_BUSINESS_DOMAINS,
} from '#services/tenant_scope_mode_service'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import { buildEffectiveTenantContext } from '@aiproj/types/multitenant-tenant-identification'
import { createOrganization, createUser, uniqueEmail, useAuthDatabase } from './auth/_helpers.js'

function superAdminGlobalContext(actorRef = 'user:1') {
  return buildEffectiveTenantContext({
    actorRef,
    organizationId: null,
    scopeMode: 'global-low-sensitive',
    selectionSource: 'super_admin_mode',
    resolutionReason: 'SUPER_ADMIN_GLOBAL_LOW_SENSITIVE',
    isSuperAdmin: true,
  })
}

function superAdminTenantContext(organizationId: number, actorRef = 'user:1') {
  return buildEffectiveTenantContext({
    actorRef,
    organizationId,
    scopeMode: 'tenant',
    selectionSource: 'auth_token',
    resolutionReason: 'SUPER_ADMIN_TENANT_SCOPE',
    isSuperAdmin: true,
  })
}

test.group('super admin scope mode 解析（§6.1）', (group) => {
  useAuthDatabase(group)

  test('不请求能力 → 默认 tenant 模式且要求具体组织', ({ assert }) => {
    const service = new TenantScopeModeService()
    const decision = service.resolveScopeMode({ decision: superAdminGlobalContext() })
    assert.equal(decision.scopeMode, 'tenant')
    assert.isTrue(decision.requiresConcreteOrganization)
    assert.isNull(decision.capability)
  })

  test('allow-list 内能力 → global-low-sensitive / system-maintenance', ({ assert }) => {
    const service = new TenantScopeModeService()
    for (const capability of GLOBAL_LOW_SENSITIVE_CAPABILITIES) {
      const d = service.resolveScopeMode({
        decision: superAdminGlobalContext(),
        requestedCapability: capability,
      })
      assert.equal(d.scopeMode, 'global-low-sensitive')
      assert.isFalse(d.requiresConcreteOrganization)
    }
    for (const capability of SYSTEM_MAINTENANCE_CAPABILITIES) {
      const d = service.resolveScopeMode({
        decision: superAdminGlobalContext(),
        requestedCapability: capability,
      })
      assert.equal(d.scopeMode, 'system-maintenance')
    }
  })

  test('allow-list 外能力 → 回落 tenant（fail closed 默认）', ({ assert }) => {
    const service = new TenantScopeModeService()
    const d = service.resolveScopeMode({
      decision: superAdminGlobalContext(),
      requestedCapability: 'project.list_all_organizations',
    })
    assert.equal(d.scopeMode, 'tenant')
    assert.isTrue(d.requiresConcreteOrganization)
  })

  test('非 super admin 请求全局能力 → 仍为 tenant 模式', ({ assert }) => {
    const service = new TenantScopeModeService()
    const normal = buildEffectiveTenantContext({
      actorRef: 'user:9',
      organizationId: 7,
      selectionSource: 'auth_token',
      resolutionReason: 'RESOLVED',
    })
    const d = service.resolveScopeMode({
      decision: normal,
      requestedCapability: GLOBAL_LOW_SENSITIVE_CAPABILITIES[0],
    })
    assert.equal(d.scopeMode, 'tenant')
    assert.isNull(d.capability)
  })
})

test.group('super admin 普通业务操作必须具体组织（§6.2/§6.4）', (group) => {
  useAuthDatabase(group)

  test('八个业务域逐域要求具体组织：无组织的 super admin 一律被拒', async ({ assert }) => {
    const service = new TenantScopeModeService()
    for (const domain of TENANT_SCOPED_BUSINESS_DOMAINS) {
      let thrown: unknown = null
      try {
        await service.assertConcreteTenantScope({
          decision: superAdminGlobalContext(),
          domain,
          operation: 'read',
          requestId: `req-${domain}`,
        })
      } catch (error) {
        thrown = error
      }
      assert.instanceOf(thrown, ResourceNotFoundException, `业务域 ${domain} 未要求具体组织`)
    }
  })

  test('organizationId 为 0（历史隐式全局值）同样被拒', async ({ assert }) => {
    const service = new TenantScopeModeService()
    const zeroOrg = buildEffectiveTenantContext({
      actorRef: 'user:1',
      organizationId: 0,
      selectionSource: 'auth_token',
      resolutionReason: 'SUPER_ADMIN_TENANT_SCOPE',
      isSuperAdmin: true,
    })
    let thrown: unknown = null
    try {
      await service.assertConcreteTenantScope({
        decision: zeroOrg,
        domain: 'project',
        operation: 'read',
        requestId: 'req-zero',
      })
    } catch (error) {
      thrown = error
    }
    assert.instanceOf(thrown, ResourceNotFoundException)
  })

  test('带具体组织的 super admin 通过并返回该组织', async ({ assert }) => {
    const service = new TenantScopeModeService()
    const organizationId = await service.assertConcreteTenantScope({
      decision: superAdminTenantContext(42),
      domain: 'ai',
      operation: 'draft',
      requestId: 'req-ok',
    })
    assert.equal(organizationId, 42)
  })

  test('被拒的业务操作写低敏审计且不含目标组织', async ({ assert }) => {
    const service = new TenantScopeModeService()
    try {
      await service.assertConcreteTenantScope({
        decision: superAdminGlobalContext('user:7'),
        domain: 'export',
        operation: 'create',
        requestId: 'req-audit',
      })
    } catch {
      /* 预期抛出 */
    }

    const logs = await db.from('audit_logs').orderBy('id', 'desc').limit(10)
    const denied = logs.find((l) => {
      const meta = typeof l.metadata === 'string' ? l.metadata : JSON.stringify(l.metadata ?? {})
      return meta.includes('export.create')
    })
    assert.isDefined(denied, '被拒的全局业务操作必须留低敏审计')
    const meta = JSON.parse(
      typeof denied.metadata === 'string' ? denied.metadata : JSON.stringify(denied.metadata),
    )
    assert.equal(meta.kind, 'denied')
    assert.equal(meta.resolutionReason, 'NO_ACTIVE_ORGANIZATION')
    assert.isNull(meta.organizationId)
  })
})

test.group('全局低敏模式 allow-list 与审计（§6.3）', (group) => {
  useAuthDatabase(group)

  test('许可能力 → 通过并写 global_mode 审计', async ({ assert }) => {
    const service = new TenantScopeModeService()
    await service.assertGlobalMode({
      decision: superAdminGlobalContext('user:5'),
      capability: GLOBAL_LOW_SENSITIVE_CAPABILITIES[0],
      scopeMode: 'global-low-sensitive',
      operation: 'read',
      requestId: 'req-global',
      userId: 5,
    })

    const logs = await db.from('audit_logs').orderBy('id', 'desc').limit(5)
    const recorded = logs.find((l) => {
      const meta = typeof l.metadata === 'string' ? l.metadata : JSON.stringify(l.metadata ?? {})
      return meta.includes(GLOBAL_LOW_SENSITIVE_CAPABILITIES[0])
    })
    assert.isDefined(recorded, '许可的全局低敏访问必须自审计')
    const meta = JSON.parse(
      typeof recorded.metadata === 'string' ? recorded.metadata : JSON.stringify(recorded.metadata),
    )
    assert.equal(meta.kind, 'global_mode')
    assert.equal(meta.scopeMode, 'global-low-sensitive')
    assert.equal(meta.resolutionReason, 'SUPER_ADMIN_GLOBAL_LOW_SENSITIVE')
    assert.equal(meta.actorRef, 'user:5')
    assert.isNotEmpty(meta.requestId)
    assert.isNotEmpty(meta.timestamp)
    // 全局模式不绑定具体组织。
    assert.isNull(meta.organizationId)
  })

  test('未许可能力 → 403 且写 GLOBAL_NOT_ALLOWED 审计', async ({ assert }) => {
    const service = new TenantScopeModeService()
    let thrown: unknown = null
    try {
      await service.assertGlobalMode({
        decision: superAdminGlobalContext('user:5'),
        capability: 'project.list_all_organizations',
        scopeMode: 'global-low-sensitive',
        operation: 'read',
        requestId: 'req-bad',
      })
    } catch (error) {
      thrown = error
    }
    assert.instanceOf(thrown, PermissionDeniedException)

    const logs = await db.from('audit_logs').orderBy('id', 'desc').limit(5)
    const denied = logs.find((l) => {
      const meta = typeof l.metadata === 'string' ? l.metadata : JSON.stringify(l.metadata ?? {})
      return meta.includes('project.list_all_organizations')
    })
    assert.isDefined(denied)
    const meta = JSON.parse(
      typeof denied.metadata === 'string' ? denied.metadata : JSON.stringify(denied.metadata),
    )
    assert.equal(meta.resolutionReason, 'GLOBAL_NOT_ALLOWED')
  })

  test('非 super admin 请求许可能力 → 403（全局视图不对普通角色开放）', async ({ assert }) => {
    const service = new TenantScopeModeService()
    const normal = buildEffectiveTenantContext({
      actorRef: 'user:9',
      organizationId: 7,
      selectionSource: 'auth_token',
      resolutionReason: 'RESOLVED',
    })
    let thrown: unknown = null
    try {
      await service.assertGlobalMode({
        decision: normal,
        capability: GLOBAL_LOW_SENSITIVE_CAPABILITIES[0],
        scopeMode: 'global-low-sensitive',
        operation: 'read',
        requestId: 'req-normal',
      })
    } catch (error) {
      thrown = error
    }
    assert.instanceOf(thrown, PermissionDeniedException)
  })

  test('运维模式能力与全局低敏 allow-list 不互通', async ({ assert }) => {
    const service = new TenantScopeModeService()
    let thrown: unknown = null
    try {
      // 用 system-maintenance 模式请求一个只在全局低敏清单里的能力。
      await service.assertGlobalMode({
        decision: superAdminGlobalContext(),
        capability: GLOBAL_LOW_SENSITIVE_CAPABILITIES[0],
        scopeMode: 'system-maintenance',
        operation: 'read',
        requestId: 'req-mix',
      })
    } catch (error) {
      thrown = error
    }
    assert.instanceOf(thrown, PermissionDeniedException, '两个 allow-list 不得互相顶替')
  })
})

test.group('super admin 端到端：不默认跨租户业务可见（§6.4）', (group) => {
  useAuthDatabase(group)

  test('super admin 带组织 A 的 token 读组织 B 的项目 → 非泄露 404', async ({ client, assert }) => {
    const tokenSvc = await app.container.make(TokenService)
    const ownerA = await createUser({ email: uniqueEmail('sa-owna') })
    const orgA = await createOrganization(ownerA)
    const ownerB = await createUser({ email: uniqueEmail('sa-ownb') })
    const orgB = await createOrganization(ownerB)
    const projectB = await Project.create({
      organizationId: Number(orgB.id),
      name: '共享名称-项目',
      code: `PB${Date.now()}`,
      createdBy: ownerB.id,
    })

    const admin = await createUser({ email: uniqueEmail('sa'), isSuperAdmin: true })
    const token = await tokenSvc.generateAccessToken({
      sub: admin.id,
      organizationId: Number(orgA.id),
      roleVersion: 0,
      permissions: [],
    })

    const res = await client
      .get(`/api/v1/projects/${projectB.id}`)
      .header('Authorization', `Bearer ${token}`)

    // 关键断言：super admin 也不能凭"我是管理员"读到他组织业务数据。
    assert.notEqual(res.status(), 200, 'super admin 不得默认获得跨租户业务数据可见性')
    assert.notInclude(JSON.stringify(res.body()), '共享名称-项目')
  })

  test('super admin 解析出的 scope mode 是 tenant（不是 global）', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('sa-own') })
    const org = await createOrganization(owner)
    const admin = await createUser({ email: uniqueEmail('sa'), isSuperAdmin: true })

    const resolution = new TenantResolutionService()
    const { context } = await resolution.resolve({
      payload: {
        sub: admin.id,
        organizationId: Number(org.id),
        roleVersion: admin.roleVersion,
        permissions: [],
      },
      user: admin,
    })

    assert.equal(context.scopeMode, 'tenant')
    assert.equal(context.resolutionReason, 'SUPER_ADMIN_TENANT_SCOPE')
    assert.equal(context.organizationId, Number(org.id))
  })
})
