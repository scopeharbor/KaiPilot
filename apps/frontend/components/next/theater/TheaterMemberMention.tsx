'use client'

import * as React from 'react'
import { AtSign } from 'lucide-react'
import type { OrganizationMember } from '@/lib/api-client'
import { useOrganizationMembers } from '@/hooks/use-organization-members'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'

/** 光标前的「@片段」：返回片段起点与查询词；不在 @ 片段里返回 null。 */
export function mentionQueryAt(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const match = /@([^\s@，。、,;；]*)$/u.exec(before)
  if (!match) return null
  return { start: before.length - match[0].length, query: match[1] ?? '' }
}

export function memberHandle(member: OrganizationMember): string {
  const name = member.user?.fullName?.trim()
  if (name) return name.replace(/\s+/g, '')
  return (member.user?.email ?? `user${member.userId}`).split('@')[0] ?? `user${member.userId}`
}

interface TheaterMemberMentionProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  value: string
  caret: number
  onInsert: (next: string, caret: number) => void
}

/**
 * 输入框 @ 组织成员（D：成员入口一）。选中后文本里写「@姓名」，同时把成员 id 记入 store；
 * 发给模型前统一换成代号「成员#id」，姓名不进模型。
 */
export function TheaterMemberMention({
  textareaRef,
  value,
  caret,
  onInsert,
}: TheaterMemberMentionProps) {
  const organizationId = useAiProjectDraftStore((state) => state.organizationId)
  const mention = mentionQueryAt(value, caret)
  const [active, setActive] = React.useState(0)
  const members = useOrganizationMembers(organizationId, mention !== null)

  const candidates = React.useMemo(() => {
    if (!mention) return []
    const query = mention.query.toLowerCase()
    return members
      .filter((member) => member.user?.isActive !== false)
      .filter((member) => {
        if (!query) return true
        const name = member.user?.fullName?.toLowerCase() ?? ''
        const email = member.user?.email?.toLowerCase() ?? ''
        return name.includes(query) || email.startsWith(query)
      })
      .slice(0, 8)
  }, [members, mention])

  React.useEffect(() => setActive(0), [mention?.query])

  const choose = React.useCallback(
    (member: OrganizationMember) => {
      if (!mention) return
      const handle = memberHandle(member)
      const inserted = `@${handle} `
      const next = value.slice(0, mention.start) + inserted + value.slice(caret)
      useAiProjectDraftStore.getState().addMentionedMember({
        userId: member.userId,
        handle,
        name: member.user?.fullName?.trim() || handle,
        role: null,
      })
      onInsert(next, mention.start + inserted.length)
    },
    [mention, value, caret, onInsert],
  )

  // 键盘选择：↑↓ 移动，Enter / Tab 选中，Esc 关闭（由 textarea 的 keydown 转发）。
  React.useEffect(() => {
    const element = textareaRef.current
    if (!element || candidates.length === 0) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setActive(
          (index) =>
            (index + (event.key === 'ArrowDown' ? 1 : -1) + candidates.length) % candidates.length,
        )
      } else if (
        (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) ||
        event.key === 'Tab'
      ) {
        event.preventDefault()
        const picked = candidates[active]
        if (picked) choose(picked)
      }
    }
    element.addEventListener('keydown', onKeyDown)
    return () => element.removeEventListener('keydown', onKeyDown)
  }, [textareaRef, candidates, active, choose])

  if (!mention || candidates.length === 0) return null

  return (
    <ul
      role="listbox"
      aria-label="选择组织成员"
      data-member-mention
      className="mt-2 max-h-56 overflow-auto rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-1)] py-1 text-sm shadow-sm"
    >
      {candidates.map((member, index) => (
        <li key={member.userId} role="option" aria-selected={index === active}>
          <button
            type="button"
            onMouseDown={(event) => {
              event.preventDefault()
              choose(member)
            }}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${
              index === active ? 'bg-[var(--nx-accent)]/15' : 'hover:bg-[var(--nx-accent)]/10'
            }`}
          >
            <AtSign className="h-3.5 w-3.5 text-[var(--nx-accent)]" aria-hidden />
            <span className="text-[var(--nx-text-primary)]">
              {member.user?.fullName || memberHandle(member)}
            </span>
            <span className="ml-auto text-xs text-[var(--nx-text-muted)]">
              {member.user?.email}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
