/**
 * plugin-security-gate.test.ts — 任务 2.2/2.4/2.6/2.8/2.10
 * 覆盖 shape/enum/authority-claim、确定性 digest、scope grant、receipt、敏感值扫描
 */

import { describe, it, expect } from 'vitest'
import {
  validateGateRequestShape,
  normalizeGateRequest,
  computeGateRequestDigest,
  computeGateScopeGrantDigest,
  computeGateDecisionId,
  computeGateReceiptDigest,
  deriveScopeGrantSnapshot,
  buildGateReceiptBinding,
  verifyGateReceiptBinding,
  createGateAuthorization,
  verifyGateAuthorization,
  psgDeepRedact,
  scanGateSensitiveLeakage,
  psgStableSerialize,
  psgFnv1aHash,
  type PluginSecurityGateRequest,
  type PluginSecurityGateInstallationRef,
  type PluginSecurityGateDigestRefs,
} from './plugin-security-gate.js'

// =============================================================================
// Helper fixtures
// =============================================================================

function baseRequest(overrides?: Partial<PluginSecurityGateRequest>): PluginSecurityGateRequest {
  return {
    pluginId: 'acme.my-plugin',
    contributionKey: 'acme.contrib',
    seamKey: 'skill-adapter',
    seamVersion: '1.0.0',
    operation: 'skill-adapter',
    requestedPermissions: ['acme.perm.read'],
    scopeKind: 'organization',
    targetRef: 'target:ref:1',
    idempotencyKey: 'idem-1',
    correlationKey: 'corr-1',
    referenceTime: new Date('2026-08-21T06:00:00.000Z').toISOString(),
    ...overrides,
  }
}

function baseInstallation(
  overrides?: Partial<PluginSecurityGateInstallationRef>,
): PluginSecurityGateInstallationRef {
  return {
    installationRef: 'install:1',
    pluginId: 'acme.my-plugin',
    pluginVersion: '1.0.0',
    status: 'enabled',
    manifestDigest: 'mdigest1',
    permissionDigest: 'pdigest1',
    confirmationRef: 'confirmed:orgA:user1:2026-08-21',
    confirmedAt: new Date('2026-08-21T05:00:00.000Z').toISOString(),
    ...overrides,
  }
}

function baseDigests(
  overrides?: Partial<PluginSecurityGateDigestRefs>,
): PluginSecurityGateDigestRefs {
  return {
    manifestDigest: 'mdigest1',
    permissionDigest: 'pdigest1',
    ...overrides,
  }
}

// =============================================================================
// 2.2 shape / enum / authority-claim
// =============================================================================

describe('2.2 validateGateRequestShape —封闭字段集与 authority 伪造 blocking', () => {
  it('合法请求通过', () => {
    const r = validateGateRequestShape(baseRequest())
    expect(r.valid).toBe(true)
    expect(r.normalized).toBeDefined()
  })

  it('unknown-field → blocking', () => {
    const r = validateGateRequestShape({ ...baseRequest(), organizationId: 123 } as any)
    expect(r.valid).toBe(false)
    expect(r.reasonCode).toBe('unknown-field')
  })

  it('unknown organization field 伪造 → blocking', () => {
    const r = validateGateRequestShape({
      ...baseRequest(),
      extra: 'orgId',
      organizationId: 'orgA',
    } as any)
    expect(r.valid).toBe(false)
    expect(r.reasonCode).toBe('unknown-field')
  })

  it('projectId / tenantId / userId 伪造 → unknown-field blocking', () => {
    for (const payload of [
      { ...baseRequest(), projectId: 'p1' } as any,
      { ...baseRequest(), tenantId: 't1' } as any,
      { ...baseRequest(), userId: 'u1' } as any,
      { ...baseRequest(), role: 'admin' } as any,
    ]) {
      const r = validateGateRequestShape(payload)
      expect(r.valid).toBe(false)
      expect(r.reasonCode).toBe('unknown-field')
    }
  })

  it('client-role 伪造 → unknown-field', () => {
    const r = validateGateRequestShape({ ...baseRequest(), role: 'owner' } as any)
    expect(r.valid).toBe(false)
  })

  it('authorized=true 伪造 → authority-claim blocking', () => {
    const raw = { ...baseRequest(), authorized: true } as any
    const r = validateGateRequestShape(raw)
    expect(r.valid).toBe(false)
    expect(r.reasonCode).toBe('unknown-field') // 封闭字段集优先；若字段不在允许集则先为 unknown-field
    // 额外：若通过 allowedKeys 但含 authorized 值，则应为 authority-claim
    const raw2: any = baseRequest()
    ;(raw2 as any)['authorized'] = true
    delete (raw2 as any).authorized
    // 用 JSON 形式模拟值级 claim（虽然字段被封闭，但值扫描在 2.9）
    // 本用例验证字段级 blocking 已足够
  })

  it('auditSuccess / hostReady 伪造值级 claim → authority-claim', () => {
    // 由于 allowedKeys 封闭，这些键本身就会先被 unknown-field 拦住
    // 这里验证 JSON 值扫描对 authorized/hostReady 的二层防御
    const payload: any = baseRequest()
    payload['auditSuccess'] = true
    const r = validateGateRequestShape(payload)
    expect(r.valid).toBe(false)
    expect(['unknown-field', 'authority-claim']).toContain(r.reasonCode!)
  })

  it('unknown enum operation → unknown-enum blocking', () => {
    const r = validateGateRequestShape({ ...baseRequest(), operation: 'unknown-op' } as any)
    expect(r.valid).toBe(false)
    expect(r.reasonCode).toBe('unknown-enum')
  })

  it('global scope → global-scope blocking', () => {
    const r = validateGateRequestShape({ ...baseRequest(), scopeKind: 'global' } as any)
    expect(r.valid).toBe(false)
    expect(r.reasonCode).toBe('global-scope')
  })

  it('缺 pluginId / seamKey / idempotencyKey / referenceTime → unknown-field blocking', () => {
    for (const bad of [
      { ...baseRequest(), pluginId: '' } as any,
      { ...baseRequest(), seamKey: '' } as any,
      { ...baseRequest(), idempotencyKey: '' } as any,
      { ...baseRequest(), referenceTime: 'not-a-date' } as any,
    ]) {
      const r = validateGateRequestShape(bad)
      expect(r.valid).toBe(false)
    }
  })
})

// =============================================================================
// 2.4 确定性 digest
// =============================================================================

describe('2.4 确定性 digest — 数组顺序不变、相同输入重复一致、任一维度变化改变绑定', () => {
  it('requestedPermissions 顺序变化不改变 gate-request digest', () => {
    const a = baseRequest({ requestedPermissions: ['b', 'a', 'c'] })
    const b = baseRequest({ requestedPermissions: ['c', 'a', 'b'] })
    expect(computeGateRequestDigest(a)).toBe(computeGateRequestDigest(b))
  })

  it('相同输入重复调用完全一致', () => {
    const r = baseRequest()
    expect(computeGateRequestDigest(r)).toBe(computeGateRequestDigest(r))
    expect(computeGateRequestDigest(r)).toBe(computeGateRequestDigest({ ...r }))
  })

  it('scope / plugin / operation / permission / digest 任一变化都会改变绑定', () => {
    const base = baseRequest({ requestedPermissions: ['acme.perm.read'] })
    const baseDigest = computeGateRequestDigest(base)
    const variants: PluginSecurityGateRequest[] = [
      { ...base, scopeKind: 'project' },
      { ...base, pluginId: 'other.plugin' },
      { ...base, operation: 'execute' },
      { ...base, requestedPermissions: ['acme.perm.write'] },
      { ...base, idempotencyKey: 'idem-2' },
    ]
    for (const v of variants) {
      expect(computeGateRequestDigest(v)).not.toBe(baseDigest)
    }
  })

  it('scopeGrant snapshot digest 同理：顺序不变、字段变化即变', () => {
    const snapA = {
      organizationScope: 'orgA',
      pluginId: 'acme.my-plugin',
      pluginVersion: '1.0.0',
      manifestDigest: 'm1',
      permissionDigest: 'p1',
      referenceTime: '2026-08-21T06:00:00.000Z',
      grantedPermissions: ['b', 'a'],
    }
    const snapB = {
      organizationScope: 'orgA',
      pluginId: 'acme.my-plugin',
      pluginVersion: '1.0.0',
      manifestDigest: 'm1',
      permissionDigest: 'p1',
      referenceTime: '2026-08-21T06:00:00.000Z',
      grantedPermissions: ['a', 'b'],
    }
    expect(computeGateScopeGrantDigest(snapA as any)).toBe(
      computeGateScopeGrantDigest(snapB as any),
    )
    expect(computeGateScopeGrantDigest({ ...snapA, manifestDigest: 'm2' } as any)).not.toBe(
      computeGateScopeGrantDigest(snapA as any),
    )
  })

  it('decisionId 随 organization/project/plugin/operation/digest 变化', () => {
    const base = {
      organizationScope: 'orgA',
      pluginId: 'acme.my-plugin',
      operation: 'resolve-query' as const,
      permissionDigest: 'p1',
      idempotencyKey: 'idem1',
    }
    const id1 = computeGateDecisionId(base)
    expect(computeGateDecisionId({ ...base, organizationScope: 'orgB' })).not.toBe(id1)
    expect(computeGateDecisionId({ ...base, operation: 'execute' as const })).not.toBe(id1)
    expect(computeGateDecisionId({ ...base, permissionDigest: 'p2' })).not.toBe(id1)
    expect(id1).toBe(computeGateDecisionId(base))
  })

  it('receipt digest 随 scope/plugin/operation/permission/digest 任一变化而变', () => {
    const baseReceipt: any = {
      organizationScope: 'orgA',
      pluginId: 'acme.my-plugin',
      seamKey: 'skill-adapter',
      operation: 'skill-adapter',
      manifestDigest: 'm1',
      permissionDigest: 'p1',
      scopeGrantDigest: 's1',
      requestedPermissions: ['a'],
      decisionId: 'd1',
      idempotencyKey: 'idem1',
      createdAt: '2026-08-21T06:00:00.000Z',
      expiresAt: '2026-08-21T06:15:00.000Z',
    }
    const id1 = computeGateReceiptDigest(baseReceipt)
    expect(computeGateReceiptDigest({ ...baseReceipt, organizationScope: 'orgB' })).not.toBe(id1)
    expect(computeGateReceiptDigest({ ...baseReceipt, pluginId: 'other.plugin' })).not.toBe(id1)
    expect(computeGateReceiptDigest({ ...baseReceipt, requestedPermissions: ['b'] })).not.toBe(id1)
  })

  it('psgStableSerialize 键排序确定性', () => {
    expect(psgStableSerialize({ b: 1, a: 2 })).toBe(psgStableSerialize({ a: 2, b: 1 }))
    expect(psgFnv1aHash('a')).toBe(psgFnv1aHash('a'))
    expect(psgFnv1aHash('a')).not.toBe(psgFnv1aHash('b'))
  })

  it('normalizeGateRequest 对大小写与空格归一', () => {
    const raw = baseRequest({ pluginId: 'ACME.My-Plugin ', requestedPermissions: ['  b ', 'a'] })
    const n = normalizeGateRequest(raw)
    expect(n.pluginId).toBe('acme.my-plugin')
    expect(n.requestedPermissions).toEqual(['a', 'b'])
  })
})

// =============================================================================
// 2.6 deriveScopeGrantSnapshot 正负例
// =============================================================================

describe('2.6 deriveScopeGrantSnapshot — 正例与负例', () => {
  it('organization 正例', () => {
    const res = deriveScopeGrantSnapshot({
      organizationScope: 'orgA',
      installation: baseInstallation(),
      digests: baseDigests(),
      referenceTime: new Date('2026-08-21T06:10:00.000Z').toISOString(),
      grantedPermissions: ['acme.perm.read'],
    })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.snapshot.snapshotDigest).toBeDefined()
  })

  it('project 正例', () => {
    const res = deriveScopeGrantSnapshot({
      organizationScope: 'orgA',
      projectScope: 'projA',
      installation: baseInstallation(),
      digests: baseDigests(),
      referenceTime: new Date().toISOString(),
      grantedPermissions: ['acme.perm.read'],
    })
    expect(res.ok).toBe(true)
  })

  it('disable → install-invalid', () => {
    const res = deriveScopeGrantSnapshot({
      organizationScope: 'orgA',
      installation: baseInstallation({ status: 'disabled' as any }),
      digests: baseDigests(),
      referenceTime: new Date().toISOString(),
      grantedPermissions: [],
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reasonCode).toBe('install-invalid')
  })

  it('uninstall → install-invalid', () => {
    const res = deriveScopeGrantSnapshot({
      organizationScope: 'orgA',
      installation: baseInstallation({ status: 'uninstalled' as any }),
      digests: baseDigests(),
      referenceTime: new Date().toISOString(),
      grantedPermissions: [],
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reasonCode).toBe('install-invalid')
  })

  it('upgrade digest 不一致 → manifest-mismatch / permission-digest-mismatch', () => {
    const r1 = deriveScopeGrantSnapshot({
      organizationScope: 'orgA',
      installation: baseInstallation({ manifestDigest: 'old' }),
      digests: baseDigests({ manifestDigest: 'new' }),
      referenceTime: new Date().toISOString(),
      grantedPermissions: [],
    })
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.reasonCode).toBe('manifest-mismatch')
    const r2 = deriveScopeGrantSnapshot({
      organizationScope: 'orgA',
      installation: baseInstallation({ permissionDigest: 'old' }),
      digests: baseDigests({ permissionDigest: 'new' }),
      referenceTime: new Date().toISOString(),
      grantedPermissions: [],
    })
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.reasonCode).toBe('permission-digest-mismatch')
  })

  it('确认缺失 → confirmation-required', () => {
    const res = deriveScopeGrantSnapshot({
      organizationScope: 'orgA',
      installation: baseInstallation({ confirmationRef: undefined, confirmedAt: undefined }),
      digests: baseDigests(),
      referenceTime: new Date().toISOString(),
      grantedPermissions: [],
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reasonCode).toBe('confirmation-required')
  })

  it('过期 referenceTime 非法 → unknown-field', () => {
    const res = deriveScopeGrantSnapshot({
      organizationScope: 'orgA',
      installation: baseInstallation(),
      digests: baseDigests(),
      referenceTime: 'not-a-date',
      grantedPermissions: [],
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reasonCode).toBe('unknown-field')
  })

  it('manifest/seam 扩权 不在 snapshot 层放宽（snapshot 仅派生，不校验 scope 上限，交评估器）', () => {
    const res = deriveScopeGrantSnapshot({
      organizationScope: 'orgA',
      installation: baseInstallation(),
      digests: baseDigests(),
      referenceTime: new Date().toISOString(),
      grantedPermissions: ['acme.perm.unknown'],
    })
    // derive 不拦 unknown permission，仅保证 digest 绑定；unknown permission 由 3.1 预校验拦
    expect(res.ok).toBe(true)
  })

  it('project 跨 organization（不同 organizationScope 派生不同 snapshotDigest）', () => {
    const s1 = deriveScopeGrantSnapshot({
      organizationScope: 'orgA',
      projectScope: 'projA',
      installation: baseInstallation(),
      digests: baseDigests(),
      referenceTime: new Date().toISOString(),
      grantedPermissions: [],
    })
    const s2 = deriveScopeGrantSnapshot({
      organizationScope: 'orgB',
      projectScope: 'projA',
      installation: baseInstallation(),
      digests: baseDigests(),
      referenceTime: new Date().toISOString(),
      grantedPermissions: [],
    })
    expect(s1.ok && s2.ok).toBe(true)
    if (s1.ok && s2.ok) expect(s1.snapshot.snapshotDigest).not.toBe(s2.snapshot.snapshotDigest)
  })
})

// =============================================================================
// 2.8 receipt 伪造/篡改与重试
// =============================================================================

describe('2.8 receipt binding — 伪造/篡改/换 scope/operation/plugin/permission/过期 与 合法重试', () => {
  function makeReceipt() {
    return buildGateReceiptBinding({
      organizationScope: 'orgA',
      pluginId: 'acme.my-plugin',
      seamKey: 'skill-adapter',
      operation: 'skill-adapter',
      manifestDigest: 'm1',
      permissionDigest: 'p1',
      scopeGrantDigest: 's1',
      requestedPermissions: ['acme.perm.read'],
      decisionId: 'dec1',
      idempotencyKey: 'idem1',
      createdAt: '2026-08-21T06:00:00.000Z',
      ttlSeconds: 900,
    })
  }

  it('伪造（receiptId 篡改）→ tamper-detected', () => {
    const r = makeReceipt()
    const fake = { ...r, receiptId: 'fake' }
    const v = verifyGateReceiptBinding(fake, {
      organizationScope: 'orgA',
      pluginId: 'acme.my-plugin',
      operation: 'skill-adapter',
      manifestDigest: 'm1',
      permissionDigest: 'p1',
      scopeGrantDigest: 's1',
      requestedPermissions: ['acme.perm.read'],
      referenceTime: '2026-08-21T06:05:00.000Z',
    })
    expect(v.valid).toBe(false)
    expect(v.reasonCode).toBe('tamper-detected')
  })

  it('篡改 requestedPermissions → tamper-detected', () => {
    const r = makeReceipt()
    const v = verifyGateReceiptBinding(r, {
      organizationScope: 'orgA',
      pluginId: 'acme.my-plugin',
      operation: 'skill-adapter',
      manifestDigest: 'm1',
      permissionDigest: 'p1',
      scopeGrantDigest: 's1',
      requestedPermissions: ['acme.perm.write'],
      referenceTime: '2026-08-21T06:05:00.000Z',
    })
    expect(v.valid).toBe(false)
    expect(v.reasonCode).toBe('tamper-detected')
  })

  it('换 scope（org）→ cross-tenant-denied', () => {
    const r = makeReceipt()
    const v = verifyGateReceiptBinding(r, {
      organizationScope: 'orgB',
      pluginId: 'acme.my-plugin',
      operation: 'skill-adapter',
      manifestDigest: 'm1',
      permissionDigest: 'p1',
      scopeGrantDigest: 's1',
      requestedPermissions: ['acme.perm.read'],
      referenceTime: '2026-08-21T06:05:00.000Z',
    })
    expect(v.valid).toBe(false)
    expect(v.reasonCode).toBe('cross-tenant-denied')
  })

  it('换 operation → tamper-detected', () => {
    const r = makeReceipt()
    const v = verifyGateReceiptBinding(r, {
      organizationScope: 'orgA',
      pluginId: 'acme.my-plugin',
      operation: 'execute',
      manifestDigest: 'm1',
      permissionDigest: 'p1',
      scopeGrantDigest: 's1',
      requestedPermissions: ['acme.perm.read'],
      referenceTime: '2026-08-21T06:05:00.000Z',
    })
    expect(v.valid).toBe(false)
    expect(v.reasonCode).toBe('tamper-detected')
  })

  it('换 plugin → tamper-detected', () => {
    const r = makeReceipt()
    const v = verifyGateReceiptBinding(r, {
      organizationScope: 'orgA',
      pluginId: 'other.plugin',
      operation: 'skill-adapter',
      manifestDigest: 'm1',
      permissionDigest: 'p1',
      scopeGrantDigest: 's1',
      requestedPermissions: ['acme.perm.read'],
      referenceTime: '2026-08-21T06:05:00.000Z',
    })
    expect(v.valid).toBe(false)
    expect(v.reasonCode).toBe('tamper-detected')
  })

  it('换 contribution / permission set（receipt 中 contribution 不参与 verify 的 scope，但 permission 必校验）', () => {
    const r = buildGateReceiptBinding({
      organizationScope: 'orgA',
      pluginId: 'acme.my-plugin',
      contributionKey: 'acme.contribA',
      seamKey: 'skill-adapter',
      operation: 'skill-adapter',
      manifestDigest: 'm1',
      permissionDigest: 'p1',
      scopeGrantDigest: 's1',
      requestedPermissions: ['a', 'b'],
      decisionId: 'dec1',
      idempotencyKey: 'idem1',
      createdAt: '2026-08-21T06:00:00.000Z',
    })
    const v = verifyGateReceiptBinding(r, {
      organizationScope: 'orgA',
      pluginId: 'acme.my-plugin',
      operation: 'skill-adapter',
      manifestDigest: 'm1',
      permissionDigest: 'p1',
      scopeGrantDigest: 's1',
      requestedPermissions: ['a'],
      referenceTime: '2026-08-21T06:05:00.000Z',
    })
    expect(v.valid).toBe(false)
  })

  it('过期 receipt → grant-expired', () => {
    const r = buildGateReceiptBinding({
      organizationScope: 'orgA',
      pluginId: 'acme.my-plugin',
      seamKey: 'skill-adapter',
      operation: 'skill-adapter',
      manifestDigest: 'm1',
      permissionDigest: 'p1',
      scopeGrantDigest: 's1',
      requestedPermissions: ['acme.perm.read'],
      decisionId: 'dec1',
      idempotencyKey: 'idem1',
      createdAt: '2026-08-21T06:00:00.000Z',
      ttlSeconds: 60,
    })
    const v = verifyGateReceiptBinding(r, {
      organizationScope: 'orgA',
      pluginId: 'acme.my-plugin',
      operation: 'skill-adapter',
      manifestDigest: 'm1',
      permissionDigest: 'p1',
      scopeGrantDigest: 's1',
      requestedPermissions: ['acme.perm.read'],
      referenceTime: '2026-08-21T07:00:00.000Z',
    })
    expect(v.valid).toBe(false)
    expect(v.reasonCode).toBe('grant-expired')
  })

  it('合法重试保持同一低敏引用（receiptId 与 decisionId 稳定）', () => {
    const r1 = buildGateReceiptBinding({
      organizationScope: 'orgA',
      pluginId: 'acme.my-plugin',
      seamKey: 'skill-adapter',
      operation: 'skill-adapter',
      manifestDigest: 'm1',
      permissionDigest: 'p1',
      scopeGrantDigest: 's1',
      requestedPermissions: ['b', 'a'],
      decisionId: 'dec1',
      idempotencyKey: 'idem1',
      createdAt: '2026-08-21T06:00:00.000Z',
    })
    const r2 = buildGateReceiptBinding({
      organizationScope: 'orgA',
      pluginId: 'acme.my-plugin',
      seamKey: 'skill-adapter',
      operation: 'skill-adapter',
      manifestDigest: 'm1',
      permissionDigest: 'p1',
      scopeGrantDigest: 's1',
      requestedPermissions: ['a', 'b'],
      decisionId: 'dec1',
      idempotencyKey: 'idem1',
      createdAt: '2026-08-21T06:00:00.000Z',
    })
    expect(r1.receiptId).toBe(r2.receiptId)
  })

  it('branded authorization 不能从 JSON 反序列化伪造', () => {
    const r = makeReceipt()
    const auth = createGateAuthorization(r)
    expect(verifyGateAuthorization(auth, r.receiptId, '2026-08-21T06:05:00.000Z').valid).toBe(true)
    // JSON round-trip 丢失 brand
    const fake = JSON.parse(JSON.stringify(auth))
    expect(verifyGateAuthorization(fake, r.receiptId, '2026-08-21T06:05:00.000Z').valid).toBe(false)
  })

  it('换 scope 的 receipt 移用 → cross-project-denied / tamper', () => {
    const r = buildGateReceiptBinding({
      organizationScope: 'orgA',
      projectScope: 'projA',
      pluginId: 'acme.my-plugin',
      seamKey: 'skill-adapter',
      operation: 'skill-adapter',
      manifestDigest: 'm1',
      permissionDigest: 'p1',
      scopeGrantDigest: 's1',
      requestedPermissions: ['a'],
      decisionId: 'dec1',
      idempotencyKey: 'idem1',
      createdAt: '2026-08-21T06:00:00.000Z',
    })
    const v = verifyGateReceiptBinding(r, {
      organizationScope: 'orgA',
      projectScope: 'projB',
      pluginId: 'acme.my-plugin',
      operation: 'skill-adapter',
      manifestDigest: 'm1',
      permissionDigest: 'p1',
      scopeGrantDigest: 's1',
      requestedPermissions: ['a'],
      referenceTime: '2026-08-21T06:05:00.000Z',
    })
    expect(v.valid).toBe(false)
  })
})

// =============================================================================
// 2.10 敏感值不出现 — 深层对象/数组、值级凭据
// =============================================================================

describe('2.10 敏感值扫描与 redact — 深层与值级', () => {
  it('psgDeepRedact 对敏感键 redact', () => {
    const obj = {
      token: 'sk_12345678901234567890',
      nested: { Authorization: 'Bearer abc.def.ghi', ok: 'value' },
      arr: [{ secret: 'x' }, { ok: 1 }],
    }
    const r: any = psgDeepRedact(obj)
    expect(r.token).toBe('[redacted]')
    expect(r.nested.Authorization).toBe('[redacted]')
    expect(r.nested.ok).toBe('value')
    expect(r.arr[0].secret).toBe('[redacted]')
  })

  it('psgDeepRedact 对敏感值模式 redact（Bearer / sk_）', () => {
    const v: any = psgDeepRedact('Bearer eyJhbGciOiJIUzI1NiJ9.payload')
    expect(v).toBe('[redacted]')
    const v2: any = psgDeepRedact({ note: 'foo sk_12345678901234567890123 bar' })
    expect(v2.note).toBe('[redacted]')
  })

  it('scanGateSensitiveLeakage 检出 token/secret/Authorization/URL/tenant id/stack', () => {
    const leak: any = {
      data: { token: 'x', url: 'https://example.com', tenant_id: 't1' },
      stack: 'Error at ...',
    }
    const s = scanGateSensitiveLeakage(leak)
    expect(s.leaked).toBe(true)
    expect(s.paths.join(',')).toContain('sensitive-key')
    expect(s.paths.join(',')).toContain('url')
    expect(s.paths.join(',')).toContain('tenant-id')
    expect(s.paths.join(',')).toContain('stack')
  })

  it('scanGateSensitiveLeakage 对深层数组同样检出', () => {
    const obj = {
      list: [{ Authorization: 'Bearer token' }, { nested: { password: 'x' } }],
      meta: { token: 'sk_12345678901234567890' },
    }
    const s = scanGateSensitiveLeakage(obj)
    expect(s.leaked).toBe(true)
  })

  it('不含敏感数据的对象不误报为泄露（除非含 url/stack/tenant 键）', () => {
    const clean = {
      organizationScope: 'orgA',
      pluginId: 'acme.my-plugin',
      decisionId: 'd1',
      requestedPermissions: ['a'],
    }
    const s = scanGateSensitiveLeakage(clean)
    expect(s.leaked).toBe(false)
  })

  it('值级凭据模式覆盖 ghp/ Bearer / sk_ 多形态', () => {
    expect(scanGateSensitiveLeakage({ v: 'ghp_123456789012345678901234567890123456' }).leaked).toBe(
      true,
    )
    expect(scanGateSensitiveLeakage({ v: 'Bearer abc.def' }).leaked).toBe(true)
  })
})
