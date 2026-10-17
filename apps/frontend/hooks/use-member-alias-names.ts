'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { aiToolsApi } from '@/lib/api/ai-tools'

/**
 * 成员代号〔成员·7KQ2M9XD〕：模型只看得到代号（由服务端按组织与用户算出，推不出用户 ID），
 * 界面展示时换回真实姓名。
 */
export const MEMBER_ALIAS_PATTERN = '〔成员·([0-9A-HJKMNP-TV-Z]{8})〕'

export function hasMemberAlias(text: string): boolean {
  return new RegExp(MEMBER_ALIAS_PATTERN).test(text)
}

/** 文字里的代号编码（去重、排序，便于做缓存键）。 */
export function extractMemberAliasCodes(text: string): string[] {
  const codes = new Set<string>()
  for (const match of text.matchAll(new RegExp(MEMBER_ALIAS_PATTERN, 'g'))) codes.add(match[1]!)
  return [...codes].sort()
}

/** 代号换回姓名；解析不到的显示为「某成员」。 */
export function resolveMemberAliases(content: string, names: ReadonlyMap<string, string>): string {
  return content.replace(
    new RegExp(MEMBER_ALIAS_PATTERN, 'g'),
    (_match, code: string) => names.get(code) ?? '某成员',
  )
}

/**
 * 把文字里出现的成员代号解析成真实姓名（只给界面展示）。
 * 后端只解析与当前用户同在某个有权限项目里的成员。
 */
export function useMemberAliasNames(text: string): ReadonlyMap<string, string> {
  const codes = extractMemberAliasCodes(text)
  const query = useQuery({
    queryKey: ['ai', 'member-alias-names', codes.join(',')],
    queryFn: () => aiToolsApi.memberNames(codes),
    enabled: codes.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  })
  return React.useMemo(() => new Map(Object.entries(query.data ?? {})), [query.data])
}
