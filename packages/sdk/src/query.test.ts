import { describe, expect, test } from 'vitest'
import { toQueryString } from './query.js'

describe('v2-5-typescript-sdk-core deterministic query serialization', () => {
  test('omits undefined and null values', () => {
    expect(toQueryString({ a: 1, b: undefined, c: null })).toBe('?a=1')
  })

  test('serializes booleans as literal true/false', () => {
    expect(toQueryString({ includeArchived: true, active: false })).toBe(
      '?includeArchived=true&active=false',
    )
  })

  test('serializes numbers', () => {
    expect(toQueryString({ page: 2, perPage: 50 })).toBe('?page=2&perPage=50')
  })

  test('expands arrays as repeated keys', () => {
    const qs = toQueryString({ include: ['a', 'b'] as ReadonlyArray<string> })
    expect(qs).toBe('?include=a&include=b')
  })

  test('omits undefined/null items inside arrays', () => {
    const qs = toQueryString({
      include: ['a', undefined, 'b'] as ReadonlyArray<string | undefined>,
    })
    expect(qs).toBe('?include=a&include=b')
  })

  test('preserves sort string (URL-encoded per URLSearchParams)', () => {
    // URLSearchParams 将 '+' 编码为 %2B，与前端 api-client 的 URLSearchParams 构造一致。
    expect(toQueryString({ sort: '-createdAt,+name' })).toBe('?sort=-createdAt%2C%2Bname')
  })

  test('returns empty string for empty/wholly-omitted params', () => {
    expect(toQueryString({})).toBe('')
    expect(toQueryString({ a: undefined, b: null })).toBe('')
  })

  test('combines pagination + filter + array deterministically', () => {
    const qs = toQueryString({
      status: 'active',
      page: 1,
      perPage: 20,
      include: ['assignee', 'reviewer'] as ReadonlyArray<string>,
    })
    // URLSearchParams 按 set/append 顺序，键顺序 = 插入顺序
    expect(qs).toBe('?status=active&page=1&perPage=20&include=assignee&include=reviewer')
  })
})
