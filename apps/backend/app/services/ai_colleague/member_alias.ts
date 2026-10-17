// 成员代号（交给模型的成员标识）：〔成员·7KQ2M9XD〕。
//
// - 8 位 Crockford Base32，由服务端密钥（APP_KEY）对「组织 ID + 用户 ID」做 HMAC-SHA256 得出：
//   同一组织内同一个人代号稳定（对话前后一致），不同组织不同；从代号推不出用户 ID，
//   也不会像纯数字编号那样与正文里的数字、普通词混淆；
// - 只有服务端能把代号还原成人（按已授权项目的成员逐个计算比对），界面展示时换回真实姓名。
// 不在模块加载时读取 env（纯单元测试也能用）；密钥缺失时退化为固定盐，仍可工作但不具保密性。
import { createHmac } from 'node:crypto'

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** 匹配代号并捕获 8 位编码。 */
export const MEMBER_ALIAS_PATTERN = '〔成员·([0-9A-HJKMNP-TV-Z]{8})〕'

export function memberAliasRegExp(): RegExp {
  return new RegExp(MEMBER_ALIAS_PATTERN, 'g')
}

export function memberAliasCode(
  organizationId: number,
  userId: number,
  key: string = process.env.APP_KEY ?? 'aiproj-member-alias',
): string {
  const digest = createHmac('sha256', key)
    .update(`member-alias:v1:${organizationId}:${userId}`)
    .digest()
  // 取前 40 位 → 8 个 Base32 字符
  let bits = 0n
  for (let i = 0; i < 5; i++) bits = (bits << 8n) | BigInt(digest[i]!)
  let code = ''
  for (let i = 7; i >= 0; i--) code += CROCKFORD[Number((bits >> BigInt(i * 5)) & 31n)]
  return code
}

export function memberAlias(organizationId: number, userId: number): string {
  return `〔成员·${memberAliasCode(organizationId, userId)}〕`
}

/** 文字里出现的代号编码（去重，保持出现顺序）。 */
export function extractAliasCodes(text: string): string[] {
  const codes: string[] = []
  for (const match of text.matchAll(memberAliasRegExp())) {
    if (!codes.includes(match[1]!)) codes.push(match[1]!)
  }
  return codes
}

/** 代号换回姓名（界面展示用）；不认识的代号显示为「某成员」。 */
export function resolveAliasesToNames(
  text: string,
  namesByCode: ReadonlyMap<string, string>,
): string {
  return text.replace(
    memberAliasRegExp(),
    (_match, code: string) => namesByCode.get(code) ?? '某成员',
  )
}
