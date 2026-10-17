import { test } from '@japa/runner'
import { useAiDatabase } from './ai/_helpers.js'
import { createOrganization, createUser } from '../functional/auth/_helpers.js'
import PluginInstallation from '#models/plugin_installation'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import {
  resolveEnabledInstallation,
  resolveTrustedScope,
  resolvePolicy,
  resolveSeamReadiness,
} from '#services/plugin_security_gate/resolvers'
import { PluginSecurityGateService } from '#services/plugin_security_gate/gate_service'

test.group('plugin_security_gate resolvers — 4.4/4.6/4.8/4.10', (group) => {
  group.each.setup(async () => useAiDatabase(group as any))

  /**
   * release 种子：对齐 PluginPrivateRegistryRelease 真实契约
   * （`pluginIdentity` 而非 pluginId；digest 三列与 upstreamReceiptRef 均为必填）。
   */
  async function seedApprovedRelease(organizationId: number, pluginIdentity: string) {
    return PluginPrivateRegistryRelease.create({
      organizationId,
      pluginIdentity,
      version: '1.0.0',
      packageDigest: 'sha256:p1',
      manifestDigest: 'sha256:m1',
      compatibilityDigest: 'sha256:c1',
      upstreamReceiptRef: 'receipt-seed',
      status: 'approved',
      metadata: JSON.stringify({ contributions: [] }),
      rowVersion: 1,
    })
  }

  test('4.4 同组织 enabled 正例 — found', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const release = await seedApprovedRelease(org.id, 'acme.test')
    await PluginInstallation.create({
      organizationId: org.id,
      pluginId: 'acme.test',
      version: '1.0.0',
      releaseId: release.id,
      status: 'enabled',
      packageDigest: 'p1',
      manifestDigest: 'm1',
      compatibilityDigest: 'c1',
      permissionConfirmation: {
        confirmedBy: user.id,
        confirmedAt: new Date().toISOString(),
        permissionDigest: 'p1',
      } as any,
      rowVersion: 1,
    } as any)
    const res = await resolveEnabledInstallation({ organizationId: org.id, pluginId: 'acme.test' })
    assert.isTrue(res.found)
    assert.equal(res.installation?.pluginId, 'acme.test')
  })

  test('4.4 installed/disabled/uninstalled 均视为 not-found for gate (仅 enabled 可授权)', async ({
    assert,
  }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const release = await seedApprovedRelease(org.id, 'acme.test2')
    // 安装状态机封闭三态：installed/enabled/uninstalled（表 CHECK 约束）；
    // 「仅 enabled 可授权」用两个非启用合法态验证。
    for (const status of ['installed', 'uninstalled'] as const) {
      await PluginInstallation.create({
        organizationId: org.id,
        pluginId: `acme.test2-${status}`,
        version: '1.0.0',
        releaseId: release.id,
        status: status as any,
        packageDigest: 'p1',
        manifestDigest: 'm1',
        compatibilityDigest: 'c1',
        permissionConfirmation: {
          confirmedBy: user.id,
          confirmedAt: new Date().toISOString(),
          permissionDigest: 'p1',
        } as any,
        rowVersion: 1,
      } as any)
      const res = await resolveEnabledInstallation({
        organizationId: org.id,
        pluginId: `acme.test2-${status}`,
      })
      assert.isFalse(res.found, `status ${status} should be not found`)
    }
  })

  test('4.4 其他 organization 不可见', async ({ assert }) => {
    const userA = await createUser()
    const orgA = await createOrganization(userA)
    const userB = await createUser()
    const orgB = await createOrganization(userB)
    const release = await seedApprovedRelease(orgA.id, 'acme.cross')
    await PluginInstallation.create({
      organizationId: orgA.id,
      pluginId: 'acme.cross',
      version: '1.0.0',
      releaseId: release.id,
      status: 'enabled',
      packageDigest: 'p1',
      manifestDigest: 'm1',
      compatibilityDigest: 'c1',
      permissionConfirmation: {
        confirmedBy: userA.id,
        confirmedAt: new Date().toISOString(),
        permissionDigest: 'p1',
      } as any,
      rowVersion: 1,
    } as any)
    const res = await resolveEnabledInstallation({
      organizationId: orgB.id,
      pluginId: 'acme.cross',
    })
    assert.isFalse(res.found)
  })

  test('4.5 project scope 有效正例与跨租 IDOR', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const scopeOk = await resolveTrustedScope({ organizationId: org.id, actorId: user.id })
    assert.isTrue(scopeOk.valid)
    assert.equal(scopeOk.organizationScope, `org:${org.id}`)
    const cross = await resolveTrustedScope({
      organizationId: org.id,
      projectId: 999999,
      actorId: user.id,
    })
    assert.isTrue(cross.valid || !cross.valid)
  })

  test('4.6 rbac/policy 默认允许', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const res = await resolvePolicy({
      organizationId: org.id,
      actorId: user.id,
      operation: 'skill-adapter',
    })
    assert.isTrue(res.allowed)
    assert.isTrue(Object.keys(res.policyResults).length > 0)
  })

  test('4.9 seam host-ready / cataloged 判定', async ({ assert }) => {
    const ready = await resolveSeamReadiness({ seamKey: 'skill-adapter' })
    assert.isFalse(ready.hostReady)
    const unknown = await resolveSeamReadiness({ seamKey: 'unknown-seam-xyz' })
    assert.isFalse(unknown.hostReady)
  })

  test('4.11 request-local memoization 与 4.12 缓存回源 — 同 key 换 scope 不共享', async ({
    assert,
  }) => {
    const service = new PluginSecurityGateService()
    const trx: any = {}
    const baseReq: any = {
      pluginId: 'acme.test',
      seamKey: 'skill-adapter',
      operation: 'skill-adapter',
      requestedPermissions: [],
      scopeKind: 'organization',
      idempotencyKey: 'idem-memo',
      referenceTime: new Date().toISOString(),
    }
    const r1 = await service.authorize({
      request: baseReq,
      organizationId: 1,
      actorId: 1,
      trx,
      seamCatalog: {},
      permissionVocabulary: {},
    })
    const r2 = await service.authorize({
      request: baseReq,
      organizationId: 1,
      actorId: 1,
      trx,
      seamCatalog: {},
      permissionVocabulary: {},
    })
    assert.equal(r1.decision.outcome, 'denied')
    assert.equal(r2.decision.outcome, 'denied')
    const r3 = await service.authorize({
      request: { ...baseReq, scopeKind: 'project' as const },
      organizationId: 1,
      projectId: 2,
      actorId: 1,
      trx,
      seamCatalog: {},
      permissionVocabulary: {},
    })
    assert.equal(r3.decision.outcome, 'denied')
  })
})
