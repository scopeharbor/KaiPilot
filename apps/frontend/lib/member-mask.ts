/**
 * 成员姓名与模型代号互转：发给模型前把「@姓名」换成「成员#id」，界面展示时再换回真实姓名。
 * 姓名只在本系统内出现，不进入任何模型调用。
 */

export interface MentionedMember {
  userId: number
  /** @ 后的原文（通常是姓名或邮箱前缀）。 */
  handle: string
  /** 展示用姓名。 */
  name: string
  role: string | null
}

const MEMBER_CODE = /成员#(\d+)/gu

export function maskMentions(text: string, members: readonly MentionedMember[]): string {
  let next = text
  // 长 handle 优先，避免「@张三丰」被「@张三」截断。
  for (const member of [...members].sort((a, b) => b.handle.length - a.handle.length)) {
    next = next.split(`@${member.handle}`).join(`成员#${member.userId}`)
  }
  return next
}

export function unmaskMembers(
  text: string,
  lookup: (userId: number) => string | null | undefined,
): string {
  return text.replace(MEMBER_CODE, (whole, id: string) => {
    const name = lookup(Number(id))
    return name ? `@${name}` : whole
  })
}

/** 对项目理解里的所有文本做同一种替换（展示时代号 → 姓名，确认时姓名 → 代号）。 */
export function mapUnderstandingText<T extends object>(
  value: T,
  transform: (text: string) => string,
): T {
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return transform(node)
    if (Array.isArray(node)) return node.map(walk)
    if (node && typeof node === 'object') {
      return Object.fromEntries(
        Object.entries(node as Record<string, unknown>).map(([key, item]) => [
          key,
          key === 'id' || key === 'dependsOn' || key === 'version' ? item : walk(item),
        ]),
      )
    }
    return node
  }
  return walk(value) as T
}
