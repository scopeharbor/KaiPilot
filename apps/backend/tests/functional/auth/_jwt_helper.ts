/**
 * 测试用 JWT payload 解码（**不验签**，仅供断言 claims 结构）。
 *
 * 刻意不复用生产的 `TokenService.verifyAccessToken`：那条路径带过期/签名校验，
 * 会把「claims 形状」的断言与「token 是否仍有效」耦合在一起。
 */
export function decodeJwtForTest(token: string): Record<string, unknown> {
  const segment = token.split('.')[1]
  if (!segment) throw new Error('不是合法的 JWT')
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>
}
