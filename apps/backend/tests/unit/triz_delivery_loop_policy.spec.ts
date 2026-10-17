/**
 * v3-triz-to-delivery-closed-loop —— guards 与 Policy 矩阵单测（tasks 3.6/3.9/3.11）。
 *
 * 覆盖：append-only 更正链约束、human actor 断言、Policy 五动作矩阵
 * （superAdmin 快路径 / allow / deny / automation 边界说明）。
 * 纯构造注入，零数据库、零网络（providerCalls=0 / networkCalls=0）。
 */
import { describe, expect, it } from 'vitest'

import {
  assertHumanActorId,
  TrizDeliveryLoopAppendOnlyError,
} from '../../app/services/triz_delivery_loop/guards.js'
import { describeTrizDlReceiptCoverage } from '../../app/services/triz_delivery_loop/receipt_coverage.js'
import TrizDeliveryLoopPolicy from '../../app/policies/triz_delivery_loop_policy.js'
import type User from '../../app/models/user.js'

// ---------------------------------------------------------------------------
// Fake RbacService：按 (permission, orgId) 决定 allowed
// ---------------------------------------------------------------------------

type CheckFn = (permission: string, organizationId: number, projectId?: number) => boolean

function makeUser(overrides: Partial<{ id: number; isSuperAdmin: boolean }> = {}): User {
  return {
    id: overrides.id ?? 7,
    isSuperAdmin: overrides.isSuperAdmin ?? false,
  } as unknown as User
}

function makePolicy(checkFn: CheckFn): TrizDeliveryLoopPolicy {
  return new TrizDeliveryLoopPolicy({
    check: async (_user: User, permission: string, organizationId: number, projectId?: number) => ({
      allowed: checkFn(permission, organizationId, projectId),
    }),
  } as never)
}

const PERMS = {
  view: 'triz_delivery_loop:view',
  link: 'triz_delivery_loop:link',
  verify: 'triz_delivery_loop:verify',
  reopen: 'triz_delivery_loop:reopen',
  requestAi: 'triz_delivery_loop:request_ai',
} as const

describe('TrizDeliveryLoopPolicy 动作矩阵', () => {
  it('superAdmin 无条件全放行', async () => {
    const denyAll = makePolicy(() => false)
    const admin = makeUser({ id: 1, isSuperAdmin: true })
    await expect(denyAll.view(admin, 1, 10)).resolves.toBe(true)
    await expect(denyAll.link(admin, 1, 10)).resolves.toBe(true)
    await expect(denyAll.verify(admin, 1, 10)).resolves.toBe(true)
    await expect(denyAll.reopen(admin, 1, 10)).resolves.toBe(true)
    await expect(denyAll.requestAi(admin, 1, 10)).resolves.toBe(true)
  })

  it('admin/PM（全部权限）：五动作均放行', async () => {
    const grantAll = makePolicy(() => true)
    const pm = makeUser({ id: 2 })
    await expect(grantAll.view(pm, 1, 10)).resolves.toBe(true)
    await expect(grantAll.link(pm, 1, 10)).resolves.toBe(true)
    await expect(grantAll.verify(pm, 1, 10)).resolves.toBe(true)
    await expect(grantAll.reopen(pm, 1, 10)).resolves.toBe(true)
    await expect(grantAll.requestAi(pm, 1, 10)).resolves.toBe(true)
  })

  it('member/observer（仅 view）：只读通过，写动作全拒', async () => {
    const viewOnly = makePolicy((p) => p === PERMS.view)
    const member = makeUser({ id: 3 })
    await expect(viewOnly.view(member, 1, 10)).resolves.toBe(true)
    await expect(viewOnly.link(member, 1, 10)).resolves.toBe(false)
    await expect(viewOnly.verify(member, 1, 10)).resolves.toBe(false)
    await expect(viewOnly.reopen(member, 1, 10)).resolves.toBe(false)
    await expect(viewOnly.requestAi(member, 1, 10)).resolves.toBe(false)
  })

  it('RBAC 拒绝（跨租 cross_org_denied 场景映射为 deny）', async () => {
    const crossOrgDeny = makePolicy(() => false)
    const outsider = makeUser({ id: 4 })
    await expect(crossOrgDeny.view(outsider, 99, 999)).resolves.toBe(false)
  })

  it('RBAC 抛错时策略不放大异常（各动作返回 false 的行为由 check 实现，此处验证矩阵独立判定）', async () => {
    const policy = new TrizDeliveryLoopPolicy({
      check: async () => Promise.reject(new Error('rbac down')),
    } as never)
    const user = makeUser({ id: 5 })
    // check 内部 reject 会向上传播——Policy 不吞错；调用方需 catch 后 fail closed。
    // 这里断言确实抛出（fail-closed 由调用方 catch 完成），防止静默放行回归。
    await expect(policy.verify(user, 1, 10)).rejects.toThrow('rbac down')
  })
})

// ---------------------------------------------------------------------------
// append-only guard 纯断言部分
// ---------------------------------------------------------------------------

describe('append-only guards', () => {
  it('assertHumanActorId 接受正整数人类 id', () => {
    expect(() => assertHumanActorId(7)).not.toThrow()
    expect(() => assertHumanActorId(Number.MAX_SAFE_INTEGER)).not.toThrow()
  })

  it('assertHumanActorId 拒绝非正数与非整数（automation/system 占位身份）', () => {
    expect(() => assertHumanActorId(0)).toThrow(TrizDeliveryLoopAppendOnlyError)
    expect(() => assertHumanActorId(-1)).toThrow(TrizDeliveryLoopAppendOnlyError)
    expect(() => assertHumanActorId(1.5)).toThrow(TrizDeliveryLoopAppendOnlyError)
    expect(() => assertHumanActorId(Number.NaN)).toThrow(TrizDeliveryLoopAppendOnlyError)
  })
})

// ---------------------------------------------------------------------------
// §4.6 legacy-unlinked 投影
// ---------------------------------------------------------------------------

describe('receipt coverage（task 4.6）', () => {
  it('null/空 entityRefs → legacy_unlinked warning + manual-link 导航', () => {
    for (const refs of [null, undefined, []]) {
      const cov = describeTrizDlReceiptCoverage(42, refs as never)
      expect(cov.legacyUnlinked).toBe(true)
      expect(cov.warningCode).toBe('TRIZ_DL_LEGACY_UNLINKED')
      expect(cov.manualLink).toEqual({ mode: 'existing_entity', applyResultId: 42 })
    }
  })

  it('有 receipt → 无 warning、无 manual-link（不做猜测式回填）', () => {
    const cov = describeTrizDlReceiptCoverage(7, [
      { entityType: 'task', entityId: '1001', sourceChangeId: 3, tempId: 't1' },
    ])
    expect(cov.legacyUnlinked).toBe(false)
    expect(cov.warningCode).toBeNull()
    expect(cov.manualLink).toBeNull()
  })
})
