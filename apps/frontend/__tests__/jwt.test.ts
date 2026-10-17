import { describe, expect, test } from 'vitest'
import { decodeAccessToken, isTokenExpired } from '@/lib/jwt'
import { accessTokenWith, makeJwt } from './_jwt-helper'

describe('lib/jwt', () => {
  test('解析 access token 的权限声明', () => {
    const token = accessTokenWith(['task:view', 'project:view'])
    const claims = decodeAccessToken(token)
    expect(claims).not.toBeNull()
    expect(claims!.permissions).toEqual(['task:view', 'project:view'])
    expect(claims!.sub).toBe(1)
  })

  test('非法 token 返回 null，不抛错', () => {
    expect(decodeAccessToken('not-a-jwt')).toBeNull()
    expect(decodeAccessToken('a.b')).toBeNull()
    expect(decodeAccessToken('a.@@@.c')).toBeNull()
  })

  test('过期判定：无 exp 视为过期', () => {
    const token = makeJwt({ sub: 1, permissions: [] })
    expect(isTokenExpired(token)).toBe(true)
  })

  test('过期判定：未来 exp 未过期，过去 exp 已过期', () => {
    const now = Math.floor(Date.now() / 1000)
    expect(isTokenExpired(makeJwt({ exp: now + 900 }))).toBe(false)
    expect(isTokenExpired(makeJwt({ exp: now - 10 }))).toBe(true)
  })
})
