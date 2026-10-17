// v3-multitenant-isolation-architecture §5.4/§5.5 —— 后台作业租户快照与执行前复核。
//
// 对应 spec 场景：
// - Job execution revalidates tenant scope（入队与执行之间的状态变化必须被拦截）
// - Stale job is blocked（membership/归属/权限变化 → 停止、只记低敏元数据、零副作用）
// - System job declares global maintenance（无 scope 作业必须显式登记且不读租户业务数据）
import { test } from '@japa/runner'
import { PermissionDeniedException } from '#exceptions/api_exception'
import TenantJobScopeService, {
  SYSTEM_GLOBAL_MAINTENANCE_JOBS,
} from '#services/tenant_job_scope_service'
import {
  detectMultitenantForbiddenKeysDeep,
  mtComputeOrganizationScopeHash,
  type TenantContext,
} from '@aiproj/types/multitenant-isolation-architecture'

const ORG_A = 101
const ORG_B = 202
const ROLE_VERSION = 3

function svc(): TenantJobScopeService {
  return new TenantJobScopeService()
}

function tenant(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    organizationId: ORG_A,
    projectId: null,
    scopeMode: 'organization_scoped',
    actorRef: 'user:7',
    isSuperAdmin: false,
    ...overrides,
  }
}

function snapshot(service = svc(), overrides: Partial<TenantContext> = {}) {
  return service.buildSnapshot({
    tenant: tenant(overrides),
    roleVersion: ROLE_VERSION,
    sourceRefs: ['res:project:1'],
    idempotencyKey: 'idem-1',
    requestId: 'req-1',
    resourceType: 'report',
    issuedAt: '2026-08-07T00:00:00.000Z',
  })
}

/** 入队时的成员关系（执行时若无变化则应放行）。 */
const FRESH_MEMBERSHIP = { organizationId: ORG_A, roleVersion: ROLE_VERSION, active: true }

test.group('TenantJobScopeService —— 快照构建与持久化（§5.4）', () => {
  test('快照只含低敏字段，且 scope hash 与 organizationId 自洽', ({ assert }) => {
    const s = snapshot()
    assert.equal(s.organizationId, ORG_A)
    assert.equal(s.organizationScopeHash, mtComputeOrganizationScopeHash(ORG_A))
    assert.deepEqual(detectMultitenantForbiddenKeysDeep(s), [])
    assert.equal(s.scopeMode, 'organization_scoped')
    assert.equal(s.resourceType, 'report')
    assert.isNotEmpty(s.permissionSnapshotHash)
  })

  test('serialize/parse 往返一致', ({ assert }) => {
    const service = svc()
    const s = snapshot(service)
    assert.deepEqual(service.parse(service.serialize(s)), s)
  })

  test('sourceRefs 含禁止字段（prompt/模型输出等）时拒绝构建', ({ assert }) => {
    const service = svc()
    assert.throws(
      () =>
        service.serialize({
          ...snapshot(service),
          // 模拟调用方把敏感负载塞进快照
          prompt: '不该出现的 prompt',
        } as never),
      /禁止字段/,
    )
  })

  test('损坏/缺字段/非法 scopeMode 的快照一律 fail closed', ({ assert }) => {
    const service = svc()
    const good = snapshot(service)
    const bads: unknown[] = [
      null,
      'not-json',
      '{}',
      JSON.stringify({ ...good, organizationId: 0 }),
      JSON.stringify({ ...good, scopeMode: 'anything' }),
      JSON.stringify({ ...good, sourceRefs: 'not-array' }),
      JSON.stringify({ ...good, idempotencyKey: '' }),
    ]
    for (const bad of bads) {
      assert.throws(() => service.parse(bad), /作业租户快照无效/)
    }
  })

  test('篡改 organizationId 后 scope hash 不再自洽，快照被拒（防止改组织复用作业）', ({
    assert,
  }) => {
    const service = svc()
    const tampered = JSON.stringify({ ...snapshot(service), organizationId: ORG_B })
    assert.throws(() => service.parse(tampered), /作业租户快照无效/)
  })
})

test.group('TenantJobScopeService —— 执行前复核（§5.5）', () => {
  test('状态未变：放行', ({ assert }) => {
    const service = svc()
    const verdict = service.revalidate({
      snapshot: snapshot(service),
      currentMembership: FRESH_MEMBERSHIP,
      currentResourceOwnerOrganizationId: ORG_A,
    })
    assert.equal(verdict.decision, 'allow')
    assert.equal(verdict.reasonCode, 'OK')
  })

  test('membership 过期或被移除 → STALE_MEMBERSHIP，零副作用', ({ assert }) => {
    const service = svc()
    const s = snapshot(service)
    for (const membership of [
      null,
      { organizationId: ORG_A, roleVersion: ROLE_VERSION, active: false },
    ]) {
      const verdict = service.revalidate({ snapshot: s, currentMembership: membership })
      assert.equal(verdict.decision, 'deny')
      assert.equal(verdict.reasonCode, 'STALE_MEMBERSHIP')
    }
  })

  test('actor 已切到别的组织 → ORGANIZATION_MISMATCH', ({ assert }) => {
    const service = svc()
    const verdict = service.revalidate({
      snapshot: snapshot(service),
      currentMembership: { organizationId: ORG_B, roleVersion: ROLE_VERSION, active: true },
    })
    assert.equal(verdict.decision, 'deny')
    assert.equal(verdict.reasonCode, 'ORGANIZATION_MISMATCH')
  })

  test('入队后权限变更（roleVersion 递增）→ STALE_SCOPE', ({ assert }) => {
    const service = svc()
    const verdict = service.revalidate({
      snapshot: snapshot(service),
      currentMembership: { organizationId: ORG_A, roleVersion: ROLE_VERSION + 1, active: true },
    })
    assert.equal(verdict.decision, 'deny')
    assert.equal(verdict.reasonCode, 'STALE_SCOPE')
  })

  test('目标资源归属变更 → RESOURCE_OWNERSHIP_CHANGED；不可见 → RESOURCE_NOT_FOUND', ({
    assert,
  }) => {
    const service = svc()
    const s = snapshot(service)
    assert.equal(
      service.revalidate({
        snapshot: s,
        currentMembership: FRESH_MEMBERSHIP,
        currentResourceOwnerOrganizationId: ORG_B,
      }).reasonCode,
      'RESOURCE_OWNERSHIP_CHANGED',
    )
    assert.equal(
      service.revalidate({
        snapshot: s,
        currentMembership: FRESH_MEMBERSHIP,
        currentResourceOwnerOrganizationId: null,
      }).reasonCode,
      'RESOURCE_NOT_FOUND',
    )
  })

  test('未绑定资源的作业（undefined）跳过归属复核，不误拒', ({ assert }) => {
    const service = svc()
    const verdict = service.revalidate({
      snapshot: snapshot(service),
      currentMembership: FRESH_MEMBERSHIP,
    })
    assert.equal(verdict.decision, 'allow')
  })

  test('幂等键已消费 → REPLAY_ATTEMPT（防重复副作用）', ({ assert }) => {
    const service = svc()
    const verdict = service.revalidate({
      snapshot: snapshot(service),
      currentMembership: FRESH_MEMBERSHIP,
      currentResourceOwnerOrganizationId: ORG_A,
      idempotencyConsumed: true,
    })
    assert.equal(verdict.decision, 'deny')
    assert.equal(verdict.reasonCode, 'REPLAY_ATTEMPT')
  })

  test('复核顺序 fail closed：membership 失效优先于资源归属判定', ({ assert }) => {
    const service = svc()
    // 同时存在 membership 失效与归属变更，必须先报 membership，
    // 避免在成员关系已失效时还去做资源存在性判定（存在性侧信道）。
    const verdict = service.revalidate({
      snapshot: snapshot(service),
      currentMembership: null,
      currentResourceOwnerOrganizationId: ORG_B,
    })
    assert.equal(verdict.reasonCode, 'STALE_MEMBERSHIP')
  })

  test('assertRevalidated：拒绝统一 PERMISSION_DENIED，message 不带 reason code', ({ assert }) => {
    const service = svc()
    const s = snapshot(service)
    const messages: string[] = []
    for (const input of [
      { snapshot: s, currentMembership: null },
      {
        snapshot: s,
        currentMembership: { organizationId: ORG_B, roleVersion: ROLE_VERSION, active: true },
      },
      {
        snapshot: s,
        currentMembership: FRESH_MEMBERSHIP,
        currentResourceOwnerOrganizationId: ORG_B,
      },
    ]) {
      try {
        service.assertRevalidated(input)
        messages.push('no-error')
      } catch (err) {
        assert.instanceOf(err, PermissionDeniedException)
        messages.push((err as Error).message)
      }
    }
    assert.equal(new Set(messages).size, 1, '不同拒绝原因对外必须同一 message')
    assert.notInclude(messages, 'no-error')
  })
})

test.group('TenantJobScopeService —— system-global 维护任务门禁（§5.5）', () => {
  test('未登记的无 scope 作业默认拒绝', ({ assert }) => {
    const service = svc()
    assert.isFalse(service.isSystemGlobalJob('report_export_all_orgs'))
    assert.throws(() => service.assertSystemGlobalJob('report_export_all_orgs'), /缺少租户范围/)
  })

  test('登记项放行，且白名单每条都有说明理由', ({ assert }) => {
    const service = svc()
    const names = Object.keys(SYSTEM_GLOBAL_MAINTENANCE_JOBS)
    assert.isAtLeast(names.length, 1)
    for (const name of names) {
      service.assertSystemGlobalJob(name)
      assert.isNotEmpty(
        SYSTEM_GLOBAL_MAINTENANCE_JOBS[name],
        `${name} 必须写明为何可以无租户 scope 运行`,
      )
    }
  })

  test('原型链属性名不得被误判为已登记（constructor/toString 等）', ({ assert }) => {
    const service = svc()
    for (const name of ['constructor', 'toString', '__proto__']) {
      assert.isFalse(service.isSystemGlobalJob(name))
      assert.throws(() => service.assertSystemGlobalJob(name), /缺少租户范围/)
    }
  })
})
