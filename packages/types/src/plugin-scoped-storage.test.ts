import { describe, expect, it } from 'vitest'
import {
  PLUGIN_STORAGE_ERROR_CODES,
  PLUGIN_STORAGE_LIMITS,
  assertRuntimeStorageAccess,
  buildStorageCleanupHandle,
  computeEntryContentDigest,
  computeStorageDigest,
  deriveStorageNamespaceStatus,
  evaluateRevisionCas,
  evaluateStorageQuota,
  fnv1a32Storage,
  isPluginStorageErrorCode,
  isPluginStorageNamespaceStatus,
  isPluginStorageScope,
  normalizeStorageKey,
  normalizeStoragePagination,
  storageBase64UrlDecode,
  storageBase64UrlEncode,
  storageSecondaryScan,
  storageStableSerialize,
  validateStorageValueDocument,
  verifyStorageCleanupHandle,
} from './plugin-scoped-storage.js'

describe('plugin-scoped-storage lifecycle mapping', () => {
  it('maps install status to namespace status (D4)', () => {
    expect(deriveStorageNamespaceStatus('enabled')).toBe('active')
    expect(deriveStorageNamespaceStatus('installed')).toBe('read-only')
    expect(deriveStorageNamespaceStatus('uninstalled')).toBe('orphaned')
  })

  it('runtime access: active allows all, others deny with specific low-sensitive codes', () => {
    expect(assertRuntimeStorageAccess('active')).toBeNull()
    expect(assertRuntimeStorageAccess('read-only')).toBe('storage-namespace-read-only')
    expect(assertRuntimeStorageAccess('orphaned')).toBe('storage-namespace-orphaned')
    expect(assertRuntimeStorageAccess('pending-deletion')).toBe(
      'storage-namespace-pending-deletion',
    )
  })
})

describe('plugin-scoped-storage key normalization', () => {
  it('accepts normalized lowercase keys and lowercases input', () => {
    expect(normalizeStorageKey('Board-Settings.View')).toEqual({
      ok: true,
      key: 'board-settings.view',
    })
    expect(normalizeStorageKey('a1._-').ok).toBe(true)
  })

  it('rejects invalid keys without leaking details', () => {
    for (const bad of ['', '  ', '.lead', '-lead', '_lead', 'has space', 'UPPER!', 'a..b', 'a/b']) {
      const r = normalizeStorageKey(bad)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reasonCode).toBe('storage-key-invalid')
    }
    const tooLong = normalizeStorageKey('k'.repeat(201))
    expect(tooLong.ok).toBe(false)
  })
})

describe('plugin-scoped-storage canonical document validation', () => {
  it('accepts bounded documents and returns canonical bytes', () => {
    const value = { b: 2, a: [1, 'x', { nested: true }] }
    const r = validateStorageValueDocument(value)
    expect(r.ok).toBe(true)
    // canonical：键排序、去 undefined、确定性
    expect(r.canonicalJson).toBe(storageStableSerialize(value))
    expect(r.byteSize).toBe(new TextEncoder().encode(r.canonicalJson!).length)
    // 序列化确定性：乱序输入同输出
    expect(validateStorageValueDocument({ a: 1, b: 2 }).canonicalJson).toBe(
      validateStorageValueDocument({ b: 2, a: 1 }).canonicalJson,
    )
  })

  it('rejects non-document top level values', () => {
    for (const v of [null, undefined, 42, 'str', [], true]) {
      const r = validateStorageValueDocument(v)
      expect(r.ok).toBe(false)
      expect(r.findings.some((f) => f.code === 'storage-value-invalid')).toBe(true)
    }
  })

  it('enforces depth limit', () => {
    let deep: Record<string, unknown> = { leaf: 1 }
    for (let i = 0; i < PLUGIN_STORAGE_LIMITS.maxDepth + 2; i++) deep = { n: deep }
    const r = validateStorageValueDocument(deep)
    expect(r.ok).toBe(false)
    expect(r.findings[0]?.code).toBe('storage-value-invalid')
  })

  it('enforces field count limit', () => {
    const many: Record<string, number> = {}
    for (let i = 0; i <= PLUGIN_STORAGE_LIMITS.maxFields; i++) many[`f${i}`] = i
    const r = validateStorageValueDocument(many)
    expect(r.ok).toBe(false)
  })

  it('rejects oversized values with storage-value-too-large', () => {
    const big = { blob: 'x'.repeat(PLUGIN_STORAGE_LIMITS.maxValueBytes) }
    const r = validateStorageValueDocument(big)
    expect(r.ok).toBe(false)
    expect(r.findings.some((f) => f.code === 'storage-value-too-large')).toBe(true)
  })

  it('rejects prototype-polluting keys', () => {
    for (const k of ['__proto__', 'constructor', 'prototype']) {
      const r = validateStorageValueDocument({ [k]: { a: 1 } })
      expect(r.ok).toBe(false)
      expect(r.findings.some((f) => f.code === 'storage-value-invalid')).toBe(true)
    }
  })

  it('rejects secret-like keys and credential-style values as blocking findings', () => {
    const byKey = validateStorageValueDocument({ apiToken: 'abc' })
    expect(byKey.ok).toBe(false)
    expect(byKey.findings[0]).toMatchObject({
      code: 'storage-secret-like-content',
      severity: 'blocking',
    })

    const byValue = validateStorageValueDocument({ note: 'Bearer AbcDef123456789012345' })
    expect(byValue.ok).toBe(false)
    expect(byValue.findings[0]?.code).toBe('storage-secret-like-content')

    // 凭据样式必须带模式要求的精确形态（sk_ + ≥20 位字母数字）
    const precise = validateStorageValueDocument({ note: 'sk_ABCDEFGHIJKLMNOPQRSTUV123' })
    expect(precise.ok).toBe(false)
    expect(precise.findings[0]?.code).toBe('storage-secret-like-content')
  })

  it('findings carry field paths but never values', () => {
    const r = validateStorageValueDocument({ meta: { accessToken: 'x' } })
    expect(r.findings[0]?.fieldPath).toBe('value.meta.accessToken')
    expect(JSON.stringify(r.findings)).not.toContain('"x"')
  })
})

describe('plugin-scoped-storage digest & revision CAS', () => {
  it('stable serialize + fnv1a are deterministic', () => {
    expect(fnv1a32Storage('abc')).toBe(fnv1a32Storage('abc'))
    expect(computeStorageDigest(['a', 'b'])).not.toBe(computeStorageDigest(['b', 'a']))
    expect(computeEntryContentDigest('{"a":1}')).toBe(computeEntryContentDigest('{"a":1}'))
  })

  it('CAS: create-only conflicts when entry exists', () => {
    expect(evaluateRevisionCas(null, undefined)).toEqual({ ok: true })
    expect(evaluateRevisionCas(3, undefined)).toEqual({
      ok: false,
      reasonCode: 'storage-revision-conflict',
    })
  })

  it('CAS: stale or mismatched revision rejected', () => {
    expect(evaluateRevisionCas(5, 4)).toEqual({
      ok: false,
      reasonCode: 'storage-revision-conflict',
    })
    expect(evaluateRevisionCas(null, 1)).toEqual({
      ok: false,
      reasonCode: 'storage-revision-conflict',
    })
    expect(evaluateRevisionCas(5, 5)).toEqual({ ok: true })
    expect(evaluateRevisionCas(5, 0)).toEqual({
      ok: false,
      reasonCode: 'storage-revision-conflict',
    })
  })
})

describe('plugin-scoped-storage quota evaluation', () => {
  const ns = { usedBytes: 100, usedEntries: 10, quotaBytes: 1000, quotaEntries: 100 }

  it('allows within limits and warns at >=80% of namespace bytes', () => {
    const ok = evaluateStorageQuota({
      namespace: ns,
      project: null,
      organization: { usedBytes: 0, usedEntries: 0, quotaBytes: 10000, quotaEntries: 1000 },
      deltaBytes: 750,
      deltaEntries: 1,
    })
    expect(ok.ok).toBe(true)
    expect(ok.warnings.length).toBeGreaterThanOrEqual(1)

    const noWarn = evaluateStorageQuota({
      namespace: ns,
      project: null,
      organization: { usedBytes: 0, usedEntries: 0, quotaBytes: 10000, quotaEntries: 1000 },
      deltaBytes: 100,
      deltaEntries: 1,
    })
    expect(noWarn.ok).toBe(true)
    expect(noWarn.warnings.length).toBe(0)
  })

  it('atomically rejects when any layer would exceed byte quota', () => {
    const overNs = evaluateStorageQuota({
      namespace: ns,
      project: null,
      organization: { usedBytes: 0, usedEntries: 0, quotaBytes: 100000, quotaEntries: 100 },
      deltaBytes: 901,
      deltaEntries: 0,
    })
    expect(overNs).toMatchObject({
      ok: false,
      exceeded: 'namespace',
      reasonCode: 'storage-quota-exceeded',
    })

    const overOrg = evaluateStorageQuota({
      namespace: ns,
      project: null,
      organization: { usedBytes: 9500, usedEntries: 0, quotaBytes: 10000, quotaEntries: 100 },
      deltaBytes: 600,
      deltaEntries: 0,
    })
    expect(overOrg).toMatchObject({
      ok: false,
      exceeded: 'organization',
      reasonCode: 'storage-quota-org-exceeded',
    })

    const overProject = evaluateStorageQuota({
      namespace: ns,
      project: { usedBytes: 1900, usedEntries: 0, quotaBytes: 2000, quotaEntries: 100 },
      organization: { usedBytes: 0, usedEntries: 0, quotaBytes: 100000, quotaEntries: 100 },
      deltaBytes: 200,
      deltaEntries: 0,
    })
    expect(overProject).toMatchObject({
      ok: false,
      exceeded: 'project',
      reasonCode: 'storage-quota-project-exceeded',
    })
  })

  it('entry-count limit rejects with storage-entry-limit-reached', () => {
    const r = evaluateStorageQuota({
      namespace: { ...ns, usedEntries: 100 },
      project: null,
      organization: { usedBytes: 0, usedEntries: 0, quotaBytes: 10000, quotaEntries: 1000 },
      deltaBytes: 1,
      deltaEntries: 1,
    })
    expect(r).toMatchObject({
      ok: false,
      exceeded: 'namespace',
      reasonCode: 'storage-entry-limit-reached',
    })
  })
})

describe('plugin-scoped-storage cleanup handle binding', () => {
  const payload = {
    namespaceId: 7,
    organizationId: 1,
    pluginId: 'acme.storage-demo',
    namespaceRevision: 42,
    entriesDigest: 'abcd1234',
    nonce: 'n-1',
    issuedAt: '2026-08-23T00:00:00.000Z',
    expiresAt: '2026-08-23T00:10:00.000Z',
  }

  it('round-trips encode/decode and verifies binding', () => {
    const { handle, digest } = buildStorageCleanupHandle(payload)
    expect(storageBase64UrlDecode(handle)).toBe(storageStableSerialize(payload))
    const verified = verifyStorageCleanupHandle({
      handle,
      expectedDigest: digest,
      referenceTime: '2026-08-23T00:05:00.000Z',
    })
    expect(verified.ok).toBe(true)
  })

  it('expired handle rejected with dedicated code (spec: 过期句柄)', () => {
    const { handle, digest } = buildStorageCleanupHandle(payload)
    const r = verifyStorageCleanupHandle({
      handle,
      expectedDigest: digest,
      referenceTime: '2026-08-23T00:11:00.000Z',
    })
    expect(r).toEqual({ ok: false, reasonCode: 'storage-cleanup-handle-expired' })
  })

  it('tampered digest rejected with binding-mismatch (spec: 重放句柄)', () => {
    const { handle } = buildStorageCleanupHandle(payload)
    const r = verifyStorageCleanupHandle({
      handle,
      expectedDigest: 'deadbeef',
      referenceTime: '2026-08-23T00:05:00.000Z',
    })
    expect(r).toEqual({ ok: false, reasonCode: 'storage-cleanup-binding-mismatch' })
  })

  it('malformed handle rejected without throwing', () => {
    const r = verifyStorageCleanupHandle({
      handle: 'not-a-handle!!!',
      expectedDigest: 'x',
      referenceTime: '2026-08-23T00:05:00.000Z',
    })
    expect(r.ok).toBe(false)
  })

  it('unknown extra fields in payload break digest binding (closed shape)', () => {
    const extended = { ...payload, evil: true }
    // 直接序列化扩展载荷会得到不同 canonical → 与原始 digest 不匹配
    const { digest } = buildStorageCleanupHandle(payload)
    const forged = storageBase64UrlEncode(storageStableSerialize(extended))
    const r = verifyStorageCleanupHandle({
      handle: forged,
      expectedDigest: digest,
      referenceTime: '2026-08-23T00:05:00.000Z',
    })
    expect(r).toEqual({ ok: false, reasonCode: 'storage-cleanup-binding-mismatch' })
  })
})

describe('plugin-scoped-storage secondary scan & pagination & guards', () => {
  it('secondary scan flags sensitive keys/values with bounded paths', () => {
    const r = storageSecondaryScan({
      rows: [{ key: 'api_token', value: 'sk_ABCDEFGHIJKLMNOPQRSTUVWX' }],
      safe: { a: 1 },
    })
    expect(r.violations).toBeGreaterThanOrEqual(1)
    expect(r.fieldPaths.length).toBeLessThanOrEqual(20)
    expect(r.fieldPaths.join('|')).not.toContain('ABCDEFGHIJKLMNOP')
  })

  it('pagination normalization bounds inputs', () => {
    expect(normalizeStoragePagination(undefined, undefined)).toEqual({
      ok: true,
      page: 1,
      perPage: 50,
    })
    expect(normalizeStoragePagination('3', '25')).toEqual({ ok: true, page: 3, perPage: 25 })
    expect(normalizeStoragePagination(0)?.ok).toBe(false)
    expect(normalizeStoragePagination(1, 1000)?.ok).toBe(false)
    expect(normalizeStoragePagination(-1)?.ok).toBe(false)
    expect(normalizeStoragePagination(1.5)?.ok).toBe(false)
  })

  it('type guards narrow closed unions', () => {
    expect(isPluginStorageScope('project')).toBe(true)
    expect(isPluginStorageScope('global')).toBe(false)
    expect(isPluginStorageErrorCode('storage-revision-conflict')).toBe(true)
    expect(isPluginStorageErrorCode('nope')).toBe(false)
    expect(isPluginStorageNamespaceStatus('orphaned')).toBe(true)
    expect(isPluginStorageNamespaceStatus('archived')).toBe(false)
    expect(PLUGIN_STORAGE_ERROR_CODES.length).toBeGreaterThan(20)
  })
})
