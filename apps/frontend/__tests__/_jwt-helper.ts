/** 构造一个仅供前端解码测试用的假 JWT（不签名）。 */
export function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.signature`
}

/** 生成含指定权限、未过期的 access token。 */
export function accessTokenWith(
  permissions: string[],
  extra: Record<string, unknown> = {},
): string {
  const now = Math.floor(Date.now() / 1000)
  return makeJwt({
    sub: 1,
    organizationId: null,
    roleVersion: 0,
    permissions,
    iat: now,
    exp: now + 900,
    ...extra,
  })
}
