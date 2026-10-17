// v3-multitenant-api §7.4 —— 前端租户 cache namespace / org-switch purge 单测。
// 覆盖：从服务端 decision metadata 派生 cache scope、low-sensitive fail-closed、
// query key 含租户 hash 前缀（跨租户不复用）、组织切换按租户 hash 前缀 purge。
import { describe, expect, test, vi } from 'vitest'
import {
  tenantCacheScope,
  tenantQueryKey,
  purgeTenantScopedCaches,
} from '@/lib/api/tenant-cache-namespace'

const SERVER_META = {
  requestId: 'r-1',
  tenantScopeHash: 'aaaaaaaaaaaaaaaa',
  cacheNamespace: 'map:cache:aaaaaaaaaaaaaaaa',
  scopeMode: 'tenant',
  decision: 'allow',
  reasonCode: 'OK',
  warnings: [],
}

describe('前端租户 cache namespace（spec: Query key includes server tenant namespace）', () => {
  test('从服务端 decision metadata 派生租户 scope', () => {
    const scope = tenantCacheScope(SERVER_META)
    expect(scope).not.toBeNull()
    expect(scope?.tenantScopeHash).toBe('aaaaaaaaaaaaaaaa')
    expect(scope?.cacheNamespace).toContain('aaaaaaaaaaaaaaaa')
  })

  test('含 forbidden fields 的伪低敏 metadata -> null（fail closed）', () => {
    const dirty = { ...SERVER_META, provider_payload: { raw: 'x' } }
    expect(tenantCacheScope(dirty)).toBeNull()
  })

  test('缺 cacheNamespace/scopeHash -> null', () => {
    expect(tenantCacheScope({ decision: 'allow' })).toBeNull()
    expect(tenantCacheScope(null)).toBeNull()
  })

  test('query key 含租户命名空间，跨租户不复用', () => {
    const a = tenantQueryKey(
      {
        tenantScopeHash: 'aaaaaaaaaaaaaaaa',
        cacheNamespace: 'map:cache:aaaaaaaaaaaaaaaa',
        scopeMode: 'tenant',
      },
      ['projects', 'list'],
    )
    const b = tenantQueryKey(
      {
        tenantScopeHash: 'bbbbbbbbbbbbbbbb',
        cacheNamespace: 'map:cache:bbbbbbbbbbbbbbbb',
        scopeMode: 'tenant',
      },
      ['projects', 'list'],
    )
    expect(a).not.toEqual(b)
    expect(a[0]).toBe('aaaaaaaaaaaaaaaa')
  })
})

describe('租户派生缓存 org-switch purge（spec：Organization switch purges tenant-derived cache）', () => {
  test('purge 以租户 hash 为根移除', () => {
    const removeQueries = vi.fn()
    const qc = { removeQueries }
    purgeTenantScopedCaches(qc, 'aaaaaaaaaaaaaaaa')
    expect(removeQueries).toHaveBeenCalledWith({ queryKey: ['aaaaaaaaaaaaaaaa'] })
  })
})
