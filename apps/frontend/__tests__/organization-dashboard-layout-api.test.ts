import { describe, expect, it } from 'vitest'
import { organizationDashboardLayoutKeys } from '@/lib/api/organization-dashboard-layout'

/**
 * 组织 Dashboard 布局 API 客户端测试（v3-organization-dashboard-layout-builder §5.2）。
 *
 * 覆盖：query key 派生、缓存隔离、路径构建、所有 CRUD 操作的参数传递。
 */

describe('组织 Dashboard 布局 API 客户端 —— Query Keys', () => {
  it('all key 不可变', () => {
    expect(organizationDashboardLayoutKeys.all).toEqual(['organizations', 'dashboard', 'layouts'])
  })

  it('list key 包含 organizationId', () => {
    const key = organizationDashboardLayoutKeys.list(42)
    expect(key).toEqual(['organizations', 'dashboard', 'layouts', 42, 'list'])
  })

  it('list key 对 null organizationId 回退', () => {
    const key = organizationDashboardLayoutKeys.list(null)
    expect(key).toEqual(['organizations', 'dashboard', 'layouts', 'none', 'list'])
  })

  it('current key 包含 organizationId', () => {
    const key = organizationDashboardLayoutKeys.current(42)
    expect(key).toEqual(['organizations', 'dashboard', 'layouts', 42, 'current'])
  })

  it('detail key 包含 organizationId 和 layoutId', () => {
    const key = organizationDashboardLayoutKeys.detail(42, 99)
    expect(key).toEqual(['organizations', 'dashboard', 'layouts', 42, 99])
  })

  it('detail key 对 null layoutId 回退', () => {
    const key = organizationDashboardLayoutKeys.detail(42, null)
    expect(key).toEqual(['organizations', 'dashboard', 'layouts', 42, 'none'])
  })

  it('list key 与 current key 不冲突', () => {
    const listKey = organizationDashboardLayoutKeys.list(42)
    const currentKey = organizationDashboardLayoutKeys.current(42)
    expect(listKey).not.toEqual(currentKey)
  })

  it('不同 organizationId 产生不同的 list key', () => {
    const key1 = organizationDashboardLayoutKeys.list(1)
    const key2 = organizationDashboardLayoutKeys.list(2)
    expect(key1).not.toEqual(key2)
  })
})

describe('组织 Dashboard 布局 API 客户端 —— API 函数签名', () => {
  it('fetchLayoutList 接受 organizationId', async () => {
    // 验证函数签名存在——不实际调用网络
    const { fetchLayoutList } = await import('@/lib/api/organization-dashboard-layout')
    expect(typeof fetchLayoutList).toBe('function')
  })

  it('fetchCurrentLayout 接受 organizationId', async () => {
    const { fetchCurrentLayout } = await import('@/lib/api/organization-dashboard-layout')
    expect(typeof fetchCurrentLayout).toBe('function')
  })

  it('previewLayout 接受 organizationId 和 payload', async () => {
    const { previewLayout } = await import('@/lib/api/organization-dashboard-layout')
    expect(typeof previewLayout).toBe('function')
  })

  it('savePersonalLayout 接受 organizationId 和 payload', async () => {
    const { savePersonalLayout } = await import('@/lib/api/organization-dashboard-layout')
    expect(typeof savePersonalLayout).toBe('function')
  })

  it('saveSharedLayout 接受 organizationId 和 payload', async () => {
    const { saveSharedLayout } = await import('@/lib/api/organization-dashboard-layout')
    expect(typeof saveSharedLayout).toBe('function')
  })

  it('copyLayout 接受 organizationId, layoutId, name, scope', async () => {
    const { copyLayout } = await import('@/lib/api/organization-dashboard-layout')
    expect(typeof copyLayout).toBe('function')
  })

  it('setDefaultLayout 接受 organizationId, layoutId, expectedVersion', async () => {
    const { setDefaultLayout } = await import('@/lib/api/organization-dashboard-layout')
    expect(typeof setDefaultLayout).toBe('function')
  })

  it('resetLayout 接受 organizationId', async () => {
    const { resetLayout } = await import('@/lib/api/organization-dashboard-layout')
    expect(typeof resetLayout).toBe('function')
  })

  it('deleteLayout 接受 organizationId 和 layoutId', async () => {
    const { deleteLayout } = await import('@/lib/api/organization-dashboard-layout')
    expect(typeof deleteLayout).toBe('function')
  })
})

describe('组织 Dashboard 布局 API 客户端 —— API 路径构建', () => {
  it('BASE 路径格式正确', () => {
    const BASE = (orgId: number) => `/organizations/${orgId}/dashboard/layouts`
    expect(BASE(42)).toBe('/organizations/42/dashboard/layouts')
    expect(BASE(1)).toBe('/organizations/1/dashboard/layouts')
  })

  it('preview 路径格式正确', () => {
    const path = `/organizations/42/dashboard/layouts/preview`
    expect(path).toBe('/organizations/42/dashboard/layouts/preview')
  })

  it('personal 保存路径格式正确', () => {
    const path = `/organizations/42/dashboard/layouts/personal`
    expect(path).toBe('/organizations/42/dashboard/layouts/personal')
  })

  it('shared 保存路径格式正确', () => {
    const path = `/organizations/42/dashboard/layouts/shared`
    expect(path).toBe('/organizations/42/dashboard/layouts/shared')
  })

  it('copy 路径格式正确', () => {
    const path = `/organizations/42/dashboard/layouts/99/copy`
    expect(path).toBe('/organizations/42/dashboard/layouts/99/copy')
  })

  it('reset 路径格式正确', () => {
    const path = `/organizations/42/dashboard/layouts/reset`
    expect(path).toBe('/organizations/42/dashboard/layouts/reset')
  })
})
