import { afterEach, describe, expect, test, vi } from 'vitest'
import { searchApi, searchKeys } from '@/lib/api/search'
import type { SearchResponse } from '@/lib/api/search'
import type { SearchResultItem } from '@aiproj/types'

function makeSearchResult(overrides: Partial<SearchResultItem> = {}): SearchResultItem {
  return {
    entityType: 'task',
    entityId: 1,
    projectId: null,
    title: '测试任务',
    summary: '这是一个测试任务描述',
    matchedFields: ['name'],
    updatedAt: new Date().toISOString(),
    target: '/projects/1/tasks/1',
    source: 'task',
    score: 10,
    status: null,
    ...overrides,
  }
}

describe('lib/api/search', () => {
  afterEach(() => vi.restoreAllMocks())

  describe('searchApi.search', () => {
    test('发送 POST 请求到 /search', async () => {
      const payload: SearchResponse = {
        data: [makeSearchResult()],
        meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      }
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => payload,
          headers: new Headers({ 'content-type': 'application/json' }),
        } as Response),
      )

      await searchApi.search({ keyword: 'test' })

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.stringContaining('/search'),
        expect.objectContaining({ method: 'POST' }),
      )
    })

    test('返回 SearchResponse 结构', async () => {
      const payload: SearchResponse = {
        data: [makeSearchResult()],
        meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      }
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => payload,
          headers: new Headers({ 'content-type': 'application/json' }),
        } as Response),
      )

      const result: SearchResponse = await searchApi.search({ keyword: 'test' })
      expect(result.data).toHaveLength(1)
      expect(result.meta.total).toBe(1)
      expect(result.data[0]!.title).toBe('测试任务')
    })
  })

  describe('searchApi.suggestions', () => {
    test('发送 GET 请求到 /search/suggestions', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ data: [] }),
          headers: new Headers({ 'content-type': 'application/json' }),
        } as Response),
      )

      await searchApi.suggestions('test', 5)

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.stringContaining('/search/suggestions?q=test&limit=5'),
        expect.anything(),
      )
    })
  })

  describe('searchKeys', () => {
    test('results key includes filters', () => {
      const filters = { keyword: 'test' }
      const key = searchKeys.results(filters)
      expect(key).toEqual(['search', 'results', filters])
    })

    test('suggestions key includes query string', () => {
      const key = searchKeys.suggestions('hello')
      expect(key).toEqual(['search', 'suggestions', 'hello'])
    })
  })
})
