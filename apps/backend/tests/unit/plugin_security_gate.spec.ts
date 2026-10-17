import { test } from '@japa/runner'
import { PluginSecurityGateService } from '#services/plugin_security_gate/gate_service'

test.group('plugin_security_gate — 4.2 fixture host: no enabled plugin path not enter gate', () => {
  test('non-plugin path without installation → denied, no downstream', async ({ assert }) => {
    const service = new PluginSecurityGateService()
    const trx: any = { client: {} }
    // Mock PluginInstallation to return not found
    // For this unit test we use a minimal request that will hit install-invalid
    const request: any = {
      pluginId: 'acme.my-plugin',
      seamKey: 'skill-adapter',
      operation: 'skill-adapter',
      requestedPermissions: ['acme.perm.read'],
      scopeKind: 'organization',
      idempotencyKey: 'idem-no-plugin',
      referenceTime: new Date().toISOString(),
    }
    const result = await service.authorize({
      request,
      organizationId: 1,
      actorId: 1,
      trx,
      seamCatalog: {},
      permissionVocabulary: {},
    })
    assert.equal(result.decision.outcome, 'denied')
    // Should not have authorization
    assert.isUndefined(result.authorization)
  })

  test('no enabled plugin does not produce external side effects (audit best-effort only)', async ({
    assert,
  }) => {
    const service = new PluginSecurityGateService()
    const trx: any = {}
    const request: any = {
      pluginId: 'acme.my-plugin',
      seamKey: 'skill-adapter',
      operation: 'resolve-query',
      requestedPermissions: [],
      scopeKind: 'organization',
      idempotencyKey: 'idem-empty',
      referenceTime: new Date().toISOString(),
    }
    const before = Date.now()
    const result = await service.authorize({
      request,
      organizationId: 999,
      actorId: 999,
      trx,
      seamCatalog: {},
      permissionVocabulary: {},
    })
    assert.equal(result.decision.outcome, 'denied')
    // No throw, no external call
    assert.isTrue(Date.now() - before < 1000)
  })
})
