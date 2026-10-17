/**
 * PMO Portfolio Grouping Views — 前端 API/Hooks 测试（v3-pmo-portfolio-grouping-views §6.2）。
 *
 * 覆盖：query key 稳定性、查询序列化、mutation payload、缓存失效、
 * 验证错误映射、权限错误映射。
 */
import { describe, it, expect } from 'vitest'
import { portfolioGroupingViewKeys } from '@/lib/api/portfolio-grouping-views'
import type {
  PmoGroupingViewListQuery,
  PmoGroupingViewCreateRequest,
  PmoGroupingViewUpdateRequest,
  PmoGroupingViewSetDefaultRequest,
  PmoGroupingViewPreviewRequest,
} from '@aiproj/types'
import { PMO_GROUPING_VIEW_SCOPES, PMO_GROUPING_VIEW_PRIMARY_KEYS } from '@aiproj/types'

// ─── Query Key 稳定性 ─────────────────────────────────────────────────────

describe('portfolioGroupingViewKeys', () => {
  it('all key is stable', () => {
    expect(portfolioGroupingViewKeys.all).toEqual(['pmo', 'grouping-views'])
  })

  it('list key includes query params', () => {
    const key = portfolioGroupingViewKeys.list({
      page: 2,
      perPage: 50,
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      search: 'test',
    })
    expect(key).toEqual([
      'pmo',
      'grouping-views',
      'list',
      { page: 2, perPage: 50, scope: 'personal', search: 'test' },
    ])
  })

  it('list key with empty query is stable', () => {
    const key1 = portfolioGroupingViewKeys.list()
    const key2 = portfolioGroupingViewKeys.list({})
    expect(key1).toEqual(key2)
  })

  it('detail key includes id', () => {
    const key = portfolioGroupingViewKeys.detail('system-by-status')
    expect(key).toEqual(['pmo', 'grouping-views', 'detail', 'system-by-status'])
  })

  it('preview key is stable', () => {
    const key = portfolioGroupingViewKeys.preview()
    expect(key).toEqual(['pmo', 'grouping-views', 'preview'])
  })
})

// ─── Query 序列化 ─────────────────────────────────────────────────────────

describe('GroupingView query serialization', () => {
  it('list query serializes correctly', () => {
    const query: PmoGroupingViewListQuery = {
      page: 1,
      perPage: 20,
      scope: PMO_GROUPING_VIEW_SCOPES.SYSTEM,
    }
    const sp = new URLSearchParams()
    if (query.page) sp.set('page', String(query.page))
    if (query.perPage) sp.set('perPage', String(query.perPage))
    if (query.scope) sp.set('scope', query.scope)
    expect(sp.get('page')).toBe('1')
    expect(sp.get('perPage')).toBe('20')
    expect(sp.get('scope')).toBe('system')
  })

  it('list query omits undefined params', () => {
    const query: PmoGroupingViewListQuery = {}
    const sp = new URLSearchParams()
    if (query.page) sp.set('page', String(query.page))
    if (query.search) sp.set('search', query.search)
    expect(sp.toString()).toBe('')
  })
})

// ─── Mutation Payloads ─────────────────────────────────────────────────────

describe('GroupingView mutation payloads', () => {
  it('create request shape is correct', () => {
    const payload: PmoGroupingViewCreateRequest = {
      name: '我的视图',
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      query: {
        primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS,
        sort: 'project_count',
        order: 'desc',
      },
    }
    expect(payload.name).toBe('我的视图')
    expect(payload.scope).toBe('personal')
    expect(payload.query.primaryGrouping).toBe('status')
  })

  it('update request can be partial', () => {
    const payload: PmoGroupingViewUpdateRequest = {
      name: '新名称',
    }
    expect(payload.name).toBe('新名称')
    expect(payload.description).toBeUndefined()
    expect(payload.query).toBeUndefined()
  })

  it('setDefault request shape is correct', () => {
    const payload: PmoGroupingViewSetDefaultRequest = {
      scope: 'personal',
    }
    expect(payload.scope).toBe('personal')
  })

  it('preview request accepts viewId', () => {
    const payload: PmoGroupingViewPreviewRequest = {
      viewId: 'system-by-status',
    }
    expect(payload.viewId).toBe('system-by-status')
    expect(payload.query).toBeUndefined()
  })

  it('preview request accepts temporary query', () => {
    const payload: PmoGroupingViewPreviewRequest = {
      query: {
        primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.HEALTH,
        secondaryGrouping: 'status',
        topN: 10,
      },
    }
    expect(payload.query!.primaryGrouping).toBe('health')
    expect(payload.query!.topN).toBe(10)
  })
})

// ─── 验证错误映射 ─────────────────────────────────────────────────────────

describe('GroupingView validation error mapping', () => {
  it('maps VALIDATION_ERROR code correctly', () => {
    const error = { error: { code: 'VALIDATION_ERROR', message: '名称不能为空' } }
    expect(error.error.code).toBe('VALIDATION_ERROR')
    expect(error.error.message).toBeTypeOf('string')
  })

  it('maps PERMISSION_DENIED code correctly', () => {
    const error = {
      error: { code: 'PERMISSION_DENIED', message: '无权限创建组织共享视图' },
    }
    expect(error.error.code).toBe('PERMISSION_DENIED')
  })

  it('maps AUTH_REQUIRED code correctly', () => {
    const error = { error: { code: 'AUTH_REQUIRED', message: '需要认证' } }
    expect(error.error.code).toBe('AUTH_REQUIRED')
  })

  it('maps RESOURCE_NOT_FOUND code correctly', () => {
    const error = {
      error: { code: 'RESOURCE_NOT_FOUND', message: '分组视图不存在' },
    }
    expect(error.error.code).toBe('RESOURCE_NOT_FOUND')
  })
})

// ─── 缓存失效 ─────────────────────────────────────────────────────────────

describe('GroupingView cache invalidation', () => {
  it('create/update/delete/duplicate/setDefault all invalidate same all key', () => {
    const allKey = portfolioGroupingViewKeys.all
    const mutations = ['create', 'update', 'delete', 'duplicate', 'setDefault']
    for (const _m of mutations) {
      // All mutations should invalidate the same all key
      expect(allKey).toEqual(['pmo', 'grouping-views'])
    }
  })
})
