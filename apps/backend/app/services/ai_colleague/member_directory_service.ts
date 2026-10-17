// AI 同事 —— 成员代号目录。
//
// 隐私约定：交给模型的成员一律是〔成员·7KQ2M9XD〕代号（见 member_alias.ts），不外发姓名；
// 界面展示时再换回真实姓名。
// - `pseudonymize`：把用户原话里的成员姓名 / 邮箱前缀替换成代号（服务端做，模型看不到名字）；
//   重名时替换成「〔成员·A〕或〔成员·B〕」，由模型追问；
// - `resolveNames`：代号 → 姓名，只给界面用；只解析与调用者同在某个已授权项目里的成员。
import db from '@adonisjs/lucid/services/db'
import { memberAliasCode } from './member_alias.js'

export interface DirectoryMember {
  userId: number
  /** 该成员在本组织的代号编码（8 位）。 */
  aliasCode: string
  name: string
  email: string | null
  /** 该成员在职的项目（限定在已授权项目内）。 */
  projectIds: number[]
}

export {
  extractAliasCodes,
  memberAlias,
  memberAliasCode,
  resolveAliasesToNames,
} from './member_alias.js'

const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g
const escapeRe = (value: string) => value.replace(ESCAPE_RE, '\\$&')
/** 去姓的名字只在这些词后面才算在叫人（避免「项目建设」被「张建设」的「建设」误伤）。 */
const CALL_PREFIX = '(?:给|交给|让|找|跟|和|由|@)'

interface CallName {
  text: string
  /** anywhere=任意位置；afterCall=只在称呼词后；word=ASCII 完整单词。 */
  mode: 'anywhere' | 'afterCall' | 'word'
}

/** 一个成员可被叫出的称呼：全名；三字中文名的名（限称呼词后）；没填姓名时的邮箱前缀（完整单词）。 */
function callNames(member: DirectoryMember): CallName[] {
  const names: CallName[] = []
  const full = member.name.trim()
  const isEmailName = member.email !== null && full === member.email
  if (!isEmailName && full.length >= 2) {
    names.push({ text: full, mode: /^[ -~]+$/.test(full) ? 'word' : 'anywhere' })
    if (/^[\u4e00-\u9fa5]{3}$/.test(full)) names.push({ text: full.slice(1), mode: 'afterCall' })
  }
  const local = member.email?.split('@')[0]?.trim()
  if (isEmailName && local && local.length >= 3) names.push({ text: local, mode: 'word' })
  if (member.email) names.push({ text: member.email, mode: 'word' })
  return names
}

/**
 * 把原话里的成员称呼替换成代号（最长称呼优先，避免「王小明」被「小明」先吃掉）。
 * 同一称呼对应多名成员 → 替换成「〔成员·A〕或〔成员·B〕」交给模型追问。
 */
export function pseudonymizeText(text: string, members: readonly DirectoryMember[]): string {
  const byKey = new Map<string, { name: CallName; ids: Set<number> }>()
  for (const member of members) {
    for (const name of callNames(member)) {
      const key = `${name.mode}:${name.text.toLowerCase()}`
      const entry = byKey.get(key) ?? { name, ids: new Set<number>() }
      entry.ids.add(member.userId)
      byKey.set(key, entry)
    }
  }
  const aliasByUser = new Map(members.map((member) => [member.userId, member.aliasCode]))
  const entries = [...byKey.values()].sort((a, b) => b.name.text.length - a.name.text.length)
  let result = text
  for (const { name, ids } of entries) {
    const alias = [...ids].map((id) => `〔成员·${aliasByUser.get(id) ?? ''}〕`).join('或')
    const body = escapeRe(name.text)
    const pattern =
      name.mode === 'afterCall'
        ? new RegExp(`(${CALL_PREFIX})${body}`, 'g')
        : name.mode === 'word'
          ? new RegExp(`(?<![A-Za-z0-9_.@-])${body}(?![A-Za-z0-9_@-])`, 'gi')
          : new RegExp(body, 'g')
    result = result.replace(pattern, (_match, prefix?: string) =>
      name.mode === 'afterCall' ? `${prefix ?? ''}${alias}` : alias,
    )
  }
  return result
}

export default class MemberDirectoryService {
  /** 已授权项目里的在职成员（含调用者自己）。 */
  async listMembers(
    organizationId: number,
    allowedProjectIds: readonly number[],
  ): Promise<DirectoryMember[]> {
    if (allowedProjectIds.length === 0) return []
    const rows = (await db
      .from('project_members')
      .join('users', 'users.id', 'project_members.user_id')
      .join('projects', 'projects.id', 'project_members.project_id')
      .whereIn('project_members.project_id', [...allowedProjectIds])
      .where('project_members.is_active', true)
      .where('projects.organization_id', organizationId)
      .whereNull('projects.deleted_at')
      .select('users.id', 'users.full_name', 'users.email', 'project_members.project_id')
      .limit(2000)) as Record<string, unknown>[]
    const byUser = new Map<number, DirectoryMember>()
    for (const row of rows) {
      const userId = Number(row.id)
      const entry = byUser.get(userId) ?? {
        userId,
        aliasCode: memberAliasCode(organizationId, userId),
        name:
          (typeof row.full_name === 'string' && row.full_name.trim()) ||
          (typeof row.email === 'string' ? row.email : `成员 ${userId}`),
        email: typeof row.email === 'string' ? row.email : null,
        projectIds: [],
      }
      const projectId = Number(row.project_id)
      if (!entry.projectIds.includes(projectId)) entry.projectIds.push(projectId)
      byUser.set(userId, entry)
    }
    return [...byUser.values()]
  }

  /** 代号编码 → 姓名（界面用）；只解析同在已授权项目里的成员。 */
  async resolveNames(
    organizationId: number,
    allowedProjectIds: readonly number[],
    codes: readonly string[],
  ): Promise<Record<string, string>> {
    const wanted = new Set(codes)
    if (wanted.size === 0) return {}
    const members = await this.listMembers(organizationId, allowedProjectIds)
    const names: Record<string, string> = {}
    for (const member of members) {
      if (wanted.has(member.aliasCode)) names[member.aliasCode] = member.name
    }
    return names
  }

  /** 代号 → 用户 ID（服务端内部用，如指派时还原目标成员）。 */
  static userIdByAlias(members: readonly DirectoryMember[], alias: string): number | null {
    const code = /([0-9A-HJKMNP-TV-Z]{8})/.exec(alias)?.[1]
    return members.find((member) => member.aliasCode === code)?.userId ?? null
  }
}
