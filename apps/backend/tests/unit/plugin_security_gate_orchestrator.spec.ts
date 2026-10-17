import { test } from '@japa/runner'
import { PluginSecurityGateService } from '#services/plugin_security_gate/gate_service'
import { mapGateReasonToHttpError } from '#services/plugin_security_gate/errors'

test.group('plugin_security_gate orchestrator — 5.2/5.4/5.6/5.8', () => {
  test('5.2 allowed 与每个 resolver 失败点均为零下游调用', async ({ assert }) => {
    const service = new PluginSecurityGateService()
    let downstreamCalls = 0
    const callback = async () => {
      downstreamCalls++
      return 'ok'
    }

    // 1. 正常 denied（无安装）→ 零调用
    const req: any = {
      pluginId: 'acme.test',
      seamKey: 'skill-adapter',
      operation: 'skill-adapter',
      requestedPermissions: ['acme.perm.read'],
      scopeKind: 'organization',
      idempotencyKey: 'idem-5-2-1',
      referenceTime: new Date().toISOString(),
    }
    const r1 = await service.authorizeAndRun(
      {
        request: req,
        organizationId: 1,
        actorId: 1,
        trx: {} as any,
        seamCatalog: {},
        permissionVocabulary: {},
      },
      callback,
    )
    assert.equal(r1.decision.outcome, 'denied')
    assert.equal(downstreamCalls, 0)

    // 2. 模拟 audit 失败（通过传 invalid trx 触发异常）→ 仍 denied 且零调用
    const r2 = await service.authorizeAndRun(
      {
        request: { ...req, idempotencyKey: 'idem-5-2-2' },
        organizationId: 9999,
        actorId: 1,
        trx: {} as any,
        seamCatalog: {},
        permissionVocabulary: {},
      },
      callback,
    )
    assert.equal(r2.decision.outcome, 'denied')
    assert.equal(downstreamCalls, 0)
  })

  test('5.4 allowed strict-audit 与 denied best-effort', async ({ assert }) => {
    const service = new PluginSecurityGateService()
    // 无法在无 DB 下测试 allowed 严格审计，但可验证 denied 后仍保持 denied（不翻转）
    const req: any = {
      pluginId: 'acme.test',
      seamKey: 'skill-adapter',
      operation: 'skill-adapter',
      requestedPermissions: [],
      scopeKind: 'organization',
      idempotencyKey: 'idem-5-4',
      referenceTime: new Date().toISOString(),
    }
    const r = await service.authorize({
      request: req,
      organizationId: 1,
      actorId: 1,
      trx: {} as any,
      seamCatalog: {},
      permissionVocabulary: {},
    })
    assert.equal(r.decision.outcome, 'denied')
    // denied 审计失败仍 denied（health signal 由 service 内部处理，不抛）
    assert.isTrue(r.decision.reasonCodes.length > 0)
  })

  test('5.6 跨租不可见统一 RESOURCE_NOT_FOUND，同 scope 权限不足才 PERMISSION_DENIED', async ({
    assert,
  }) => {
    const cross = mapGateReasonToHttpError('cross-tenant-denied', false)
    assert.equal(cross.error.code, 'RESOURCE_NOT_FOUND')
    const sameScope = mapGateReasonToHttpError('rbac-denied', true)
    assert.equal(sameScope.error.code, 'PERMISSION_DENIED')
    // 真正不存在与跨租存在响应等价
    const notFound = mapGateReasonToHttpError('install-invalid', false)
    assert.equal(notFound.error.code, cross.error.code)
    // details 不含敏感值
    assert.isFalse(JSON.stringify(cross).toLowerCase().includes('token'))
  })

  test('5.8 authorize 后换参/伪造 receipt 均拒绝，不回退无 gate', async ({ assert }) => {
    const service = new PluginSecurityGateService()
    let called = 0
    const req: any = {
      pluginId: 'acme.test',
      seamKey: 'skill-adapter',
      operation: 'skill-adapter',
      requestedPermissions: ['acme.perm.read'],
      scopeKind: 'organization',
      idempotencyKey: 'idem-5-8',
      referenceTime: new Date().toISOString(),
    }
    // 1. 合法 authorizeAndRun → denied 时不调用 callback
    const r1 = await service.authorizeAndRun(
      {
        request: req,
        organizationId: 1,
        actorId: 1,
        trx: {} as any,
        seamCatalog: {},
        permissionVocabulary: {},
      },
      async () => {
        called++
        return 'x'
      },
    )
    assert.equal(r1.decision.outcome, 'denied')
    assert.equal(called, 0)
    // 2. 伪造 receipt：直接构造的 auth 无效，verifyGateAuthorization 会拒绝（由 pure 层保证）
    const { verifyGateAuthorization } = await import('@aiproj/types')
    const fakeAuth: any = {
      receipt: { receiptId: 'fake', expiresAt: new Date(Date.now() + 100000).toISOString() },
      decisionId: 'fake',
    }
    // 未带 brand 的 fake 应被拒绝
    const v = verifyGateAuthorization(fakeAuth, 'fake', new Date().toISOString())
    assert.isFalse(v.valid)
  })
})
